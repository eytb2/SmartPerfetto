/**
 * Feedback Synthesizer
 *
 * Synthesizes findings from multiple agent responses using LLM.
 * Deduplicates findings, correlates evidence, updates hypotheses,
 * and identifies remaining information gaps.
 */

import { Finding } from '../types';
import {
  AgentResponse,
  Hypothesis,
  SharedAgentContext,
} from '../types/agentProtocol';
import { AgentMessageBus } from '../communication';
import { ModelRouter } from './modelRouter';
import { ProgressEmitter } from './orchestratorTypes';
import { isPlainObject, isStringArray, LlmJsonSchema, parseLlmJson } from '../../utils/llmJson';

type FeedbackSynthesisJsonPayload = {
  correlatedFindings?: string[];
  contradictions?: string[];
  hypothesisUpdates?: Array<{
    hypothesisId: string;
    action: 'support' | 'weaken' | 'reject';
    confidence_delta?: number;
    reason?: string;
  }>;
  informationGaps?: string[];
};

const FEEDBACK_SYNTHESIS_JSON_SCHEMA: LlmJsonSchema<FeedbackSynthesisJsonPayload> = {
  name: 'feedback_synthesis_json@1.0.0',
  validate: (value: unknown): value is FeedbackSynthesisJsonPayload => {
    if (!isPlainObject(value)) return false;

    const correlatedFindings = (value as any).correlatedFindings;
    if (correlatedFindings !== undefined && correlatedFindings !== null && !isStringArray(correlatedFindings)) {
      return false;
    }

    const contradictions = (value as any).contradictions;
    if (contradictions !== undefined && contradictions !== null && !isStringArray(contradictions)) {
      return false;
    }

    const informationGaps = (value as any).informationGaps;
    if (informationGaps !== undefined && informationGaps !== null && !isStringArray(informationGaps)) {
      return false;
    }

    const hypothesisUpdates = (value as any).hypothesisUpdates;
    if (hypothesisUpdates !== undefined && hypothesisUpdates !== null) {
      if (!Array.isArray(hypothesisUpdates)) return false;
      for (const item of hypothesisUpdates) {
        if (!isPlainObject(item)) return false;
        if (typeof (item as any).hypothesisId !== 'string') return false;
        if (!['support', 'weaken', 'reject'].includes(String((item as any).action))) return false;
        const delta = (item as any).confidence_delta;
        if (delta !== undefined && delta !== null && typeof delta !== 'number') return false;
        const reason = (item as any).reason;
        if (reason !== undefined && reason !== null && typeof reason !== 'string') return false;
      }
    }

    return true;
  },
};

/**
 * Format a finding briefly with key metrics for synthesis prompt.
 * Output: "title (metric1=val1, metric2=val2)"
 */
function formatFindingBrief(f: Finding): string {
  if (!f.details || typeof f.details !== 'object' || Object.keys(f.details).length === 0) {
    return f.title;
  }
  const entries = Object.entries(f.details).slice(0, 4);
  const metrics = entries.map(([k, v]) => {
    const val = typeof v === 'object' ? JSON.stringify(v).slice(0, 50) : String(v);
    return `${k}=${val}`;
  }).join(', ');
  return `${f.title} (${metrics})`;
}

export interface SynthesisResult {
  newFindings: Finding[];
  confirmedFindings: Finding[];
  updatedHypotheses: Hypothesis[];
  informationGaps: string[];
}

/**
 * Synthesize feedback from multiple agent responses.
 * Uses LLM to correlate findings and update hypothesis confidence.
 *
 * Hypothesis updates are routed through messageBus to ensure
 * broadcast events fire and other agents get notified.
 */
export async function synthesizeFeedback(
  responses: AgentResponse[],
  sharedContext: SharedAgentContext,
  modelRouter: ModelRouter,
  emitter: ProgressEmitter,
  messageBus?: AgentMessageBus
): Promise<SynthesisResult> {
  const allFindings: Finding[] = [];
  const newFindings: Finding[] = [];

  // Collect all findings from responses
  for (const response of responses) {
    allFindings.push(...response.findings);
  }

  // Deduplicate by title
  const seenTitles = new Set<string>();
  for (const finding of allFindings) {
    if (!seenTitles.has(finding.title)) {
      seenTitles.add(finding.title);
      newFindings.push(finding);
    }
  }

  // Use LLM to synthesize correlations and gaps
  const prompt = `综合以下 Agent 反馈：

${responses.map(r => `[${r.agentId}]:
- 发现: ${r.findings.map(f => formatFindingBrief(f)).join('\n  ') || '无'}
- 置信度: ${r.confidence.toFixed(2)}
- 建议: ${r.suggestions?.join('; ') || '无'}`).join('\n\n')}

当前假设:
${Array.from(sharedContext.hypotheses.values()).map(h => `- ${h.description} (${h.status})`).join('\n')}

请基于实际发现分析：
1. 哪些发现相互印证？（引用具体数据）
2. 是否存在数据矛盾？
3. 哪些假设得到数据支持或被否定？
4. 当前数据是否存在不一致或异常？

请以 JSON 返回：
{
  "correlatedFindings": ["相互印证的发现"],
  "contradictions": ["数据中的矛盾或不一致"],
  "hypothesisUpdates": [
    {
      "hypothesisId": "假设ID",
      "action": "support/weaken/reject",
      "confidence_delta": 0.1,
      "reason": "更新原因"
    }
  ],
  "informationGaps": ["已有数据中的不一致或异常"]
}

## 假设更新规则
- support: 发现支持该假设，增加置信度（+0.05 到 +0.2）
- weaken: 发现与该假设部分矛盾，降低置信度（-0.05 到 -0.2）但不否定
- reject: 发现明确否定该假设，将置信度设为 0 并标记为 rejected`;

  let informationGaps: string[] = [];

  try {
    const response = await modelRouter.callWithFallback(prompt, 'evaluation', {
      sessionId: sharedContext.sessionId,
      traceId: sharedContext.traceId,
      jsonMode: true,
      promptId: 'agent.feedbackSynthesizer',
      promptVersion: '1.0.0',
      contractVersion: 'feedback_synthesis_json@1.0.0',
    });
    const parsed = parseLlmJson<FeedbackSynthesisJsonPayload>(response.response, FEEDBACK_SYNTHESIS_JSON_SCHEMA);
    informationGaps = parsed.informationGaps || [];

    // Process hypothesis updates via messageBus (ensures broadcasts fire)
    if (parsed.hypothesisUpdates) {
      for (const update of parsed.hypothesisUpdates) {
        const hypothesis = sharedContext.hypotheses.get(update.hypothesisId);
        if (hypothesis) {
          const updated: Hypothesis = {
            ...hypothesis,
            updatedAt: Date.now(),
          };

          // Determine confidence adjustment
          // LLM can specify confidence_delta, otherwise use defaults
          const delta = typeof update.confidence_delta === 'number'
            ? Math.max(-0.3, Math.min(0.3, update.confidence_delta)) // Clamp to [-0.3, 0.3]
            : (update.action === 'support' ? 0.1 : -0.1);

          if (update.action === 'support') {
            // Support: increase confidence
            updated.confidence = Math.min(1, hypothesis.confidence + Math.abs(delta));
            // If confidence exceeds 0.85, mark as confirmed
            if (updated.confidence >= 0.85) {
              updated.status = 'confirmed';
            }
          } else if (update.action === 'weaken') {
            // Weaken: decrease confidence but don't reject
            updated.confidence = Math.max(0.1, hypothesis.confidence - Math.abs(delta));
            // Keep status as proposed or investigating
            if (updated.status === 'confirmed' && updated.confidence < 0.7) {
              updated.status = 'investigating';
            }
          } else if (update.action === 'reject') {
            // Reject: set confidence to 0 and mark as rejected
            updated.status = 'rejected';
            updated.confidence = 0;
          }

          if (messageBus) {
            messageBus.updateHypothesis(updated);
          } else {
            // Fallback: direct mutation (legacy callers without messageBus)
            sharedContext.hypotheses.set(updated.id, updated);
          }
        }
      }
    }
  } catch (error) {
    emitter.log(`Failed to synthesize feedback: ${error}`);
    emitter.emitUpdate('degraded', { module: 'feedbackSynthesizer', fallback: 'passthrough findings' });
  }

  return {
    newFindings,
    confirmedFindings: sharedContext.confirmedFindings,
    updatedHypotheses: Array.from(sharedContext.hypotheses.values()),
    informationGaps,
  };
}
