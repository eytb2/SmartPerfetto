/**
 * Conclusion Generator
 *
 * Generates analysis conclusions from accumulated findings and hypotheses.
 * Uses LLM for intelligent root-cause synthesis, with markdown fallback.
 */

import { Intent, Finding } from '../types';
import { SharedAgentContext } from '../types/agentProtocol';
import { ModelRouter } from './modelRouter';
import { ProgressEmitter } from './orchestratorTypes';

export interface ConclusionGenerationOptions {
  /**
   * Number of previous turns in this session (0-based).
   * Example: 0 means this is the first user query of the session.
   */
  turnCount?: number;
  /**
   * Optional multi-turn context summary (compact, prompt-friendly).
   */
  historyContext?: string;
}

/**
 * Format a finding with its evidence data for LLM consumption.
 * Includes title, description, and key data entries from details.
 *
 * Key design decisions:
 * - Priority fields (root_cause, primary_cause, cause_type) are preserved fully
 * - Other details are truncated to manage token usage
 * - Evidence is preserved with reasonable limits
 */
function formatFindingWithEvidence(f: Finding): string {
  let result = `- [${f.severity}] ${f.title}`;
  if (f.description) {
    result += `\n  描述: ${f.description}`;
  }

  if (f.details && typeof f.details === 'object' && Object.keys(f.details).length > 0) {
    // Priority fields that should be preserved in full
    const priorityFields = ['root_cause', 'primary_cause', 'cause_type', 'confidence', 'jank_type'];
    const details = f.details as Record<string, any>;

    // First, output priority fields without truncation
    const priorityEntries: string[] = [];
    for (const field of priorityFields) {
      if (details[field] !== undefined) {
        const val = typeof details[field] === 'object'
          ? JSON.stringify(details[field]).slice(0, 200) // Allow more for structured data
          : String(details[field]);
        priorityEntries.push(`${field}: ${val}`);
      }
    }

    // Then, output other fields with truncation (up to 12 fields, 150 chars each)
    const otherEntries = Object.entries(details)
      .filter(([k]) => !priorityFields.includes(k))
      .slice(0, 12)
      .map(([k, v]) => {
        const val = typeof v === 'object' ? JSON.stringify(v).slice(0, 150) : String(v);
        return `${k}: ${val}`;
      });

    const allEntries = [...priorityEntries, ...otherEntries];
    if (allEntries.length > 0) {
      result += `\n  数据: { ${allEntries.join(', ')} }`;
    }
  }

  // Preserve evidence with reasonable limits (8 items, 200 chars each)
  if (f.evidence && Array.isArray(f.evidence) && f.evidence.length > 0) {
    const evidenceStr = f.evidence.slice(0, 8).map(e =>
      typeof e === 'object' ? JSON.stringify(e).slice(0, 200) : String(e)
    ).join('; ');
    result += `\n  证据: ${evidenceStr}`;
  }

  return result;
}

/**
 * Generate an AI-powered conclusion from analysis results.
 * Falls back to a simple markdown summary if LLM fails.
 */
export async function generateConclusion(
  sharedContext: SharedAgentContext,
  allFindings: Finding[],
  intent: Intent,
  modelRouter: ModelRouter,
  emitter: ProgressEmitter,
  stopReason?: string,
  options: ConclusionGenerationOptions = {}
): Promise<string> {
  const confirmedHypotheses = Array.from(sharedContext.hypotheses.values())
    .filter(h => h.status === 'confirmed' || h.confidence >= 0.85);

  const turnCount = Number.isFinite(options.turnCount) ? Number(options.turnCount) : 0;
  const historyContext = options.historyContext || '';

  // Dialogue mode: from the 2nd turn onward, switch to an iterative, question-driven style
  // to minimize repeated long-form conclusions and drive user-aligned next steps.
  const useDialogueMode = turnCount >= 1;

  const prompt = useDialogueMode
    ? buildDialogueModePrompt({
      turnCount,
      historyContext,
      intent,
      stopReason,
      confirmedHypotheses: confirmedHypotheses.map(h => ({
        description: h.description,
        confidence: h.confidence,
        status: h.status,
      })),
      findings: allFindings,
    })
    : `基于以下分析结果生成诊断结论：

用户目标: ${intent.primaryGoal}
${stopReason ? `提前终止原因: ${stopReason}` : ''}

已确认的假设:
${confirmedHypotheses.map(h => `- ${h.description} (confidence: ${h.confidence.toFixed(2)})`).join('\n') || '无'}

发现的问题（含数据证据）:
${allFindings.map(f => formatFindingWithEvidence(f)).join('\n\n') || '无'}

调查路径:
${sharedContext.investigationPath.map(s => `${s.stepNumber}. [${s.agentId}] ${s.summary}`).join('\n')}

请生成:
1. 根因分析（最可能的原因）
2. 证据支撑（每个结论的依据）
3. 置信度评估

重要约束：
- 只基于上述提供的数据和证据得出结论，不要推测未提供的信息
  - 如果数据不足以得出某个结论，明确标注"证据不足"
  - 每个结论必须引用具体的数据来源（Finding 的标题或数据值）
  - 不要给出优化建议，只需要指出问题所在`;

  try {
    const response = await modelRouter.callWithFallback(prompt, 'synthesis', {
      sessionId: sharedContext.sessionId,
      traceId: sharedContext.traceId,
      promptId: useDialogueMode ? 'agent.conclusionGenerator.dialogue' : 'agent.conclusionGenerator',
      promptVersion: useDialogueMode ? '1.0.0' : '1.0.0',
      contractVersion: useDialogueMode ? 'conclusion_dialogue_text@1.0.0' : 'conclusion_text@1.0.0',
    });
    return response.response;
  } catch (error) {
    emitter.log(`Failed to generate conclusion: ${error}`);
    emitter.emitUpdate('degraded', {
      module: 'conclusionGenerator',
      fallback: useDialogueMode ? 'rule-based dialogue' : 'rule-based summary',
    });
  }

  return useDialogueMode
    ? generateDialogueFallback(allFindings, intent, stopReason, historyContext)
    : generateSimpleConclusion(allFindings, stopReason);
}

/**
 * Generate a simple markdown-formatted conclusion without LLM.
 */
export function generateSimpleConclusion(findings: Finding[], stopReason?: string): string {
  const critical = findings.filter(f => f.severity === 'critical');
  const warnings = findings.filter(f => f.severity === 'warning');

  let conclusion = '## 分析结论\n\n';

  if (critical.length > 0) {
    conclusion += `### 严重问题 (${critical.length})\n`;
    for (const f of critical) {
      conclusion += `- **${f.title}**\n`;
    }
    conclusion += '\n';
  }

  if (warnings.length > 0) {
    conclusion += `### 需要关注 (${warnings.length})\n`;
    for (const f of warnings) {
      conclusion += `- ${f.title}\n`;
    }
    conclusion += '\n';
  }

  if (findings.length === 0) {
    conclusion += '未发现明显的性能问题。\n';
  }

  if (stopReason) {
    conclusion += `\n> 备注：分析提前结束（${stopReason}）。\n`;
  }

  return conclusion;
}

function buildDialogueModePrompt(params: {
  turnCount: number;
  historyContext: string;
  intent: Intent;
  stopReason?: string;
  confirmedHypotheses: Array<{ description: string; confidence: number; status: string }>;
  findings: Finding[];
}): string {
  const parts: string[] = [];

  parts.push(`你是 SmartPerfetto 的 AI 性能分析助手，正在进行多轮对话（当前第 ${params.turnCount + 1} 轮）。`);
  parts.push('你的目标：充分理解用户本轮输入，在不重复长篇报告的前提下，用最小输出推进到“用户满意”。');
  parts.push('');

  parts.push('## 用户本轮输入');
  parts.push(params.intent.primaryGoal);
  parts.push('');

  if (params.stopReason) {
    parts.push('## 本轮停止原因');
    parts.push(params.stopReason);
    parts.push('');
  }

  if (params.historyContext) {
    parts.push('## 对话历史摘要（用于承接上下文）');
    parts.push(params.historyContext);
    parts.push('');
  }

  if (params.confirmedHypotheses.length > 0) {
    parts.push('## 已确认假设（摘要）');
    for (const h of params.confirmedHypotheses.slice(0, 5)) {
      parts.push(`- ${h.description} (confidence: ${Number(h.confidence).toFixed(2)})`);
    }
    parts.push('');
  }

  parts.push('## 本轮新增证据（findings 摘要）');
  if (params.findings.length === 0) {
    parts.push('无新增 findings。');
  } else {
    parts.push(params.findings.slice(0, 8).map(f => formatFindingWithEvidence(f)).join('\n\n'));
  }
  parts.push('');

  parts.push('## 输出要求（必须严格遵守）');
  parts.push('- 输出尽量短：总长度不超过 12 行（含空行）');
  parts.push('- 先回答用户本轮问题（如果可直接回答，用 1-3 句话；不要复述历史长文）');
  parts.push('- 然后提出最多 3 个澄清问题（每行以 "Q:" 开头），问题必须是决定下一步分析方向的关键信息');
  parts.push('- 结尾给出 2-3 个可选下一步（以 "A."/"B."/"C." 开头），让用户选择');
  parts.push('- 不要输出 SQL、不要代码块、不要编造未提供的数据');
  parts.push('- 全部中文');

  return parts.join('\n');
}

function generateDialogueFallback(
  findings: Finding[],
  intent: Intent,
  stopReason?: string,
  historyContext?: string
): string {
  const lines: string[] = [];

  // 1) Minimal acknowledgement of the user request
  lines.push(`我理解你想继续推进：${intent.primaryGoal}`);

  // 2) Keep it short: surface what we have (if any)
  const topTitles = findings
    .filter(f => typeof f.title === 'string' && f.title.trim().length > 0)
    .slice(0, 3)
    .map(f => f.title.trim());
  if (topTitles.length > 0) {
    lines.push(`目前可承接的线索：${topTitles.join('；')}`);
  } else if (historyContext) {
    lines.push('目前我会基于已有对话上下文继续推进。');
  }

  if (stopReason) {
    lines.push(`备注：本轮提前结束（${stopReason}）。`);
  }

  // 3) Ask the minimal next question(s)
  lines.push('Q: 你希望我下一步聚焦在哪里？（给出 frame_id / session_id / 时间范围 / 进程名之一即可）');
  lines.push('A. 深入某个卡顿帧（例如：frame_id=123）');
  lines.push('B. 深入某个滑动会话（例如：session_id=2）');
  lines.push('C. 重新指定一个时间范围（例如：1.2s~1.5s）');

  return lines.join('\n');
}
