/**
 * Conclusion verifier for agentv3.
 * Three-layer verification:
 * 1. Heuristic checks (no LLM) — fast, always runs
 * 2. Plan adherence check — verifies Claude followed its submitted plan
 * 3. LLM verification (haiku, independent sdkQuery) — optional, validates evidence support
 *
 * When verification finds ERROR-level issues, generateCorrectionPrompt() produces
 * a prompt for a retry sdkQuery call (reflection-driven retry, P0-2).
 *
 * Enabled by default. Set CLAUDE_ENABLE_VERIFICATION=false to disable.
 */

import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';
import type { Finding, StreamingUpdate } from '../agent/types';
import type { VerificationResult, VerificationIssue, AnalysisPlanV3 } from './types';

/** Known misdiagnosis patterns — common false positives in performance analysis. */
const KNOWN_MISDIAGNOSIS_PATTERNS: Array<{
  pattern: RegExp;
  type: VerificationIssue['type'];
  message: string;
}> = [
  {
    pattern: /VSync.*(?:对齐异常|misalign|偏移)/i,
    type: 'known_misdiagnosis',
    message: 'VSync 对齐异常可能是正常的 VRR (可变刷新率) 行为，需确认设备是否支持 VRR',
  },
  {
    pattern: /Buffer Stuffing.*(?:严重|critical|掉帧)/i,
    type: 'known_misdiagnosis',
    message: 'Buffer Stuffing 标记可能是假阳性 — 需检查消费端帧间隔是否真的异常',
  },
  {
    pattern: /(?:单帧|single frame|1帧).*(?:异常|critical|严重)/i,
    type: 'known_misdiagnosis',
    message: '单帧异常不应标记为 CRITICAL — 需确认是否有模式性重复',
  },
];

/**
 * Run heuristic verification on analysis findings and conclusion.
 * These checks are fast (<1ms) and require no LLM calls.
 */
export function verifyHeuristic(
  findings: Finding[],
  conclusion: string,
): VerificationIssue[] {
  const issues: VerificationIssue[] = [];

  // Check 1: CRITICAL findings without evidence
  const criticals = findings.filter(f => f.severity === 'critical');
  for (const f of criticals) {
    if (!f.evidence || f.evidence.length === 0) {
      issues.push({
        type: 'missing_evidence',
        severity: 'error',
        message: `CRITICAL 发现 "${f.title}" 缺少证据支撑`,
      });
    }
  }

  // Check 2: Too many CRITICALs (>5 is suspicious)
  if (criticals.length > 5) {
    issues.push({
      type: 'too_many_criticals',
      severity: 'warning',
      message: `发现 ${criticals.length} 个 CRITICAL 级别问题，可能存在过度标记 — 通常不超过 3-5 个`,
    });
  }

  // Check 3: Known misdiagnosis pattern matching
  const fullText = conclusion + ' ' + findings.map(f => `${f.title} ${f.description}`).join(' ');
  for (const pattern of KNOWN_MISDIAGNOSIS_PATTERNS) {
    if (pattern.pattern.test(fullText)) {
      issues.push({
        type: pattern.type,
        severity: 'warning',
        message: pattern.message,
      });
    }
  }

  // Check 4: Conclusion mentions CRITICAL but no CRITICAL findings exist
  if (/\[CRITICAL\]/i.test(conclusion) && criticals.length === 0) {
    issues.push({
      type: 'severity_mismatch',
      severity: 'warning',
      message: '结论文本提及 CRITICAL 但结构化发现中无 CRITICAL 级别条目',
    });
  }

  // Check 5: Empty conclusion check
  if (conclusion.trim().length < 50) {
    issues.push({
      type: 'missing_reasoning',
      severity: 'error',
      message: '结论过短 (< 50 字符)，可能分析未完成',
    });
  }

  // Check 6: CRITICAL/HIGH findings must have causal reasoning (not just "耗时 XXms")
  const highSeverity = findings.filter(f => f.severity === 'critical' || f.severity === 'high');
  for (const f of highSeverity) {
    const desc = f.description || '';
    // Check if description only contains duration without causal analysis
    const hasDuration = /\d+(\.\d+)?\s*ms/i.test(desc);
    const hasCausalKeywords = /因为|导致|由于|caused|because|blocked|阻塞|锁|频率|CPU|IO|GC|Binder|等待|竞争|饥饿/i.test(desc);
    if (hasDuration && !hasCausalKeywords && desc.length < 100) {
      issues.push({
        type: 'missing_reasoning',
        severity: 'warning',
        message: `[${f.severity.toUpperCase()}] "${f.title}" 只报告了耗时但缺少根因分析（WHY）`,
      });
    }
  }

  return issues;
}

/**
 * Verify plan adherence — check if Claude completed all planned phases.
 * Returns issues for skipped phases that weren't explicitly marked as skipped.
 */
export function verifyPlanAdherence(plan: AnalysisPlanV3 | null): VerificationIssue[] {
  if (!plan) {
    // No plan submitted — this is a plan_deviation since planning is mandatory
    return [{
      type: 'plan_deviation',
      severity: 'warning',
      message: '未提交分析计划 — Claude 跳过了 submit_plan 步骤',
    }];
  }

  const issues: VerificationIssue[] = [];
  const pendingPhases = plan.phases.filter(p => p.status === 'pending');

  if (pendingPhases.length > 0) {
    const phaseNames = pendingPhases.map(p => `"${p.name}" (${p.id})`).join(', ');
    issues.push({
      type: 'plan_deviation',
      severity: pendingPhases.length >= 2 ? 'error' : 'warning',
      message: `${pendingPhases.length} 个计划阶段未完成: ${phaseNames}`,
    });
  }

  return issues;
}

/**
 * Run LLM-based verification using a lightweight model (haiku).
 * Validates evidence support, severity consistency, and completeness.
 * Returns undefined if LLM call fails (graceful degradation).
 */
export async function verifyWithLLM(
  findings: Finding[],
  conclusion: string,
): Promise<VerificationIssue[] | undefined> {
  try {
    const findingSummary = findings
      .slice(0, 15)
      .map(f => `[${f.severity.toUpperCase()}] ${f.title}: ${f.description?.substring(0, 150) || ''}`)
      .join('\n');

    const prompt = `你是一个 Android 性能分析验证器。请验证以下分析结论的质量。

## 发现列表
${findingSummary}

## 结论
${conclusion.substring(0, 3000)}

## 验证检查项
请逐项检查并仅报告发现的问题（如果全部通过则返回空列表）：
1. 每个 CRITICAL/HIGH 发现是否有具体数据证据（时间戳、数值等）？
2. 严重程度标记是否合理？（如单帧异常不应是 CRITICAL）
3. 是否遗漏了明显的检查项？（如提到掉帧但没分析根因）

**输出格式**：JSON 数组，每项包含 type、severity、message 字段。无问题时返回 []。
\`\`\`json
[{"type": "missing_evidence", "severity": "warning", "message": "..."}]
\`\`\``;

    const stream = sdkQuery({
      prompt,
      options: {
        model: 'claude-haiku-4-5',
        maxTurns: 1,
        permissionMode: 'bypassPermissions' as const,
        allowDangerouslySkipPermissions: true,
      },
    });

    let result = '';
    for await (const msg of stream) {
      if (msg.type === 'result' && (msg as any).subtype === 'success') {
        result = (msg as any).result || '';
      }
    }

    // Parse JSON from the result
    const jsonMatch = result.match(/\[[\s\S]*?\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as VerificationIssue[];
      return parsed.filter(i => i.type && i.message);
    }
    return [];
  } catch (err) {
    console.warn('[ClaudeVerifier] LLM verification failed (graceful degradation):', (err as Error).message);
    return undefined;
  }
}

/**
 * Generate a correction prompt for reflection-driven retry.
 * Called when verification finds ERROR-level issues.
 * Returns a prompt that asks Claude to fix the specific issues.
 */
export function generateCorrectionPrompt(
  issues: VerificationIssue[],
  originalConclusion: string,
): string {
  const errorIssues = issues.filter(i => i.severity === 'error');
  const warningIssues = issues.filter(i => i.severity === 'warning');

  const issueList = errorIssues
    .map((i, idx) => `${idx + 1}. **[ERROR]** ${i.message}`)
    .join('\n');

  const warningList = warningIssues.length > 0
    ? '\n\n注意事项:\n' + warningIssues.map(i => `- ${i.message}`).join('\n')
    : '';

  return `## 验证反馈 — 请修正以下问题

你的分析结论未通过质量验证。以下是需要修正的 ERROR 级别问题：

${issueList}${warningList}

### 修正要求
1. 重新审视你的分析结论
2. 针对每个 ERROR 问题进行修正：
   - **missing_evidence**: 为 CRITICAL/HIGH 发现补充具体数据证据（时间戳、数值、工具调用结果）
   - **plan_deviation**: 执行未完成的计划阶段，或明确说明跳过原因
   - **missing_reasoning**: 补充完整的分析结论
3. 输出修正后的完整结论

### 原始结论（需修正）
${originalConclusion.substring(0, 2000)}

请直接输出修正后的结论，不要重复描述问题。如需额外数据，可以调用工具获取。`;
}

/**
 * Run full verification pipeline (heuristic + plan adherence + optional LLM).
 * Emits SSE warnings for any issues found.
 * Returns verification result with all issues and whether correction is needed.
 */
export async function verifyConclusion(
  findings: Finding[],
  conclusion: string,
  options: {
    emitUpdate?: (update: StreamingUpdate) => void;
    enableLLM?: boolean;
    plan?: AnalysisPlanV3 | null;
  } = {},
): Promise<VerificationResult> {
  const startTime = Date.now();
  const { emitUpdate, enableLLM = true, plan } = options;

  // Layer 1: Heuristic checks
  const heuristicIssues = verifyHeuristic(findings, conclusion);

  // Layer 2: Plan adherence check
  const planIssues = verifyPlanAdherence(plan ?? null);
  heuristicIssues.push(...planIssues);

  // Layer 3: LLM verification (optional)
  let llmIssues: VerificationIssue[] | undefined;
  if (enableLLM) {
    llmIssues = await verifyWithLLM(findings, conclusion);
  }

  const allIssues = [...heuristicIssues, ...(llmIssues || [])];
  const passed = allIssues.filter(i => i.severity === 'error').length === 0;

  // Emit SSE warnings for issues
  if (emitUpdate && allIssues.length > 0) {
    const issueMessages = allIssues
      .map(i => `[${i.severity.toUpperCase()}] ${i.message}`)
      .join('\n');
    emitUpdate({
      type: 'progress',
      content: {
        phase: 'concluding',
        message: `验证发现 ${allIssues.length} 个问题:\n${issueMessages}`,
      },
      timestamp: Date.now(),
    });
  }

  return {
    passed,
    heuristicIssues,
    llmIssues,
    durationMs: Date.now() - startTime,
  };
}
