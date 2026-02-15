import type { AnalysisExecutor } from '../../agent/core/executors/analysisExecutor';
import { DirectSkillExecutor } from '../../agent/core/executors/directSkillExecutor';
import {
  captureEntitiesFromResponses,
} from '../../agent/core/entityCapture';
import {
  concludeDecision,
  type AnalysisServices,
  type ExecutionContext,
  type ExecutorResult,
  type ProgressEmitter,
} from '../../agent/core/orchestratorTypes';
import type { FocusStore } from '../../agent/context/focusStore';
import type {
  EntityId,
  FrameEntity,
  SessionEntity,
} from '../../agent/context/entityStore';
import type { EnhancedSessionContext } from '../../agent/context/enhancedSessionContext';
import type { AgentResponse } from '../../agent/types/agentProtocol';
import type { Finding } from '../../agent/types';
import type {
  DirectSkillTask,
  FocusInterval,
  StageTaskTemplate,
} from '../../agent/strategies/types';

const DEFAULT_BATCH_SIZE = 5;

export class ExtendExecutor implements AnalysisExecutor {
  private focusStore?: FocusStore;

  constructor(
    private readonly sessionContext: EnhancedSessionContext,
    private readonly services: AnalysisServices,
    private readonly traceProcessorService?: unknown,
    private readonly traceId?: string,
    private readonly batchSize: number = DEFAULT_BATCH_SIZE
  ) {}

  setFocusStore(focusStore: FocusStore): void {
    this.focusStore = focusStore;
  }

  async execute(ctx: ExecutionContext, emitter: ProgressEmitter): Promise<ExecutorResult> {
    const entityStore = this.sessionContext.getEntityStore();
    const unanalyzedFrames = entityStore.getUnanalyzedCandidateFrames();
    const unanalyzedSessions = entityStore.getUnanalyzedCandidateSessions();

    if (unanalyzedFrames.length === 0 && unanalyzedSessions.length === 0) {
      return this.nothingToExtendResult();
    }

    const entityType: 'frame' | 'session' = unanalyzedFrames.length > 0 ? 'frame' : 'session';
    const ids = entityType === 'frame' ? unanalyzedFrames : unanalyzedSessions;
    const prioritized = this.prioritizeByFocus(entityType, ids);
    const batchIds = prioritized.slice(0, this.batchSize);
    const intervals = this.buildIntervals(entityType, batchIds);

    if (intervals.length === 0) {
      return this.resolutionFailedResult(batchIds.length);
    }

    const experimentId = ctx.sessionContext?.startTraceAgentExperiment({
      type: 'run_skill',
      objective: `[agentv2.extend] entityType=${entityType} batch=${batchIds.length}`,
    });

    const { findings, responses } = await this.runBatch(entityType, intervals, emitter);
    const evidenceIds =
      ctx.sessionContext?.ingestEvidenceFromResponses(responses, { stageName: 'extend', round: 1 }) || [];

    if (experimentId) {
      const ok = responses.some(response => response.success);
      ctx.sessionContext?.completeTraceAgentExperiment({
        id: experimentId,
        status: ok ? 'succeeded' : 'failed',
        producedEvidenceIds: evidenceIds,
      });
    }

    const capturedEntities = captureEntitiesFromResponses(responses);
    const analyzedEntityIds = entityType === 'frame' ? { frames: batchIds } : { sessions: batchIds };
    const summaryFinding = this.summaryFinding(entityType, batchIds.length, ids.length - batchIds.length);
    const allFindings = [...findings, summaryFinding];

    emitter.emitUpdate('finding', { round: 1, findings: allFindings });

    return {
      findings: allFindings,
      lastStrategy: concludeDecision(0.85, 'AgentRuntime extend completed'),
      confidence: 0.85,
      informationGaps: ids.length > batchIds.length
        ? [`还有 ${ids.length - batchIds.length} 个${entityType === 'frame' ? '帧' : '会话'}未分析`]
        : [],
      rounds: 1,
      stopReason: 'extend_complete',
      capturedEntities,
      analyzedEntityIds,
    };
  }

  private prioritizeByFocus(entityType: 'frame' | 'session', ids: EntityId[]): EntityId[] {
    if (!this.focusStore || ids.length === 0) return ids;

    const entityStore = this.sessionContext.getEntityStore();
    const focuses = this.focusStore.getTopFocuses(5);
    if (focuses.length === 0) return ids;

    const scored = ids.map(id => {
      let score = 0;
      const entity = entityType === 'frame' ? entityStore.getFrame(id) : entityStore.getSession(id);
      if (!entity) return { id, score };

      for (const focus of focuses) {
        if (focus.type === 'entity' && focus.target.entityType === entityType && focus.target.entityId === id) {
          score += focus.weight * 10;
        }

        if (focus.type === 'timeRange' && focus.target.timeRange && entity.start_ts && entity.end_ts) {
          const focusStart = BigInt(focus.target.timeRange.start);
          const focusEnd = BigInt(focus.target.timeRange.end);
          const entityStart = BigInt(entity.start_ts);
          const entityEnd = BigInt(entity.end_ts);
          if (entityStart <= focusEnd && entityEnd >= focusStart) {
            score += focus.weight * 5;
          }
        }

        if (
          entityType === 'frame' &&
          focus.type === 'entity' &&
          focus.target.entityType === 'session' &&
          (entity as FrameEntity).session_id === focus.target.entityId
        ) {
          score += focus.weight * 3;
        }
      }

      return { id, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.map(item => item.id);
  }

  private buildIntervals(entityType: 'frame' | 'session', ids: EntityId[]): FocusInterval[] {
    const store = this.sessionContext.getEntityStore();
    const intervals: FocusInterval[] = [];

    for (let index = 0; index < ids.length; index += 1) {
      const id = ids[index];
      if (entityType === 'frame') {
        const frame = store.getFrame(id);
        if (frame && frame.start_ts && frame.end_ts) {
          intervals.push(this.frameToInterval(frame, index));
        }
      } else {
        const session = store.getSession(id);
        if (session && session.start_ts && session.end_ts) {
          intervals.push(this.sessionToInterval(session, index));
        }
      }
    }

    return intervals;
  }

  private frameToInterval(frame: FrameEntity, index: number): FocusInterval {
    return {
      id: index,
      processName: frame.process_name || '',
      startTs: frame.start_ts || '0',
      endTs: frame.end_ts || '0',
      priority: 1,
      label: `帧 ${frame.frame_id}`,
      metadata: {
        sourceEntityType: 'frame',
        sourceEntityId: frame.frame_id,
        frameId: frame.frame_id,
        frame_id: frame.frame_id,
        sessionId: frame.session_id,
        session_id: frame.session_id,
        jankType: frame.jank_type,
        jank_type: frame.jank_type,
      },
    };
  }

  private sessionToInterval(session: SessionEntity, index: number): FocusInterval {
    return {
      id: index,
      processName: session.process_name || '',
      startTs: session.start_ts || '0',
      endTs: session.end_ts || '0',
      priority: 1,
      label: `会话 ${session.session_id}`,
      metadata: {
        sourceEntityType: 'session',
        sourceEntityId: session.session_id,
        sessionId: session.session_id,
        session_id: session.session_id,
      },
    };
  }

  private async runBatch(
    entityType: 'frame' | 'session',
    intervals: FocusInterval[],
    emitter: ProgressEmitter
  ): Promise<{ findings: Finding[]; responses: AgentResponse[] }> {
    if (!this.traceProcessorService || !this.traceId) {
      return { findings: [], responses: [] };
    }

    const skillId = entityType === 'frame' ? 'jank_frame_detail' : 'scroll_session_analysis';
    const template: StageTaskTemplate = {
      agentId: 'frame_agent',
      domain: entityType,
      executionMode: 'direct_skill',
      scope: 'per_interval',
      directSkillId: skillId,
      descriptionTemplate: 'Analyze {{scopeLabel}}',
      skillParams: {},
      paramMapping: entityType === 'frame'
        ? {
            frame_id: 'frameId',
            start_ts: 'startTs',
            end_ts: 'endTs',
            process_name: 'processName',
            session_id: 'sessionId',
          }
        : {
            session_id: 'sessionId',
            start_ts: 'startTs',
            end_ts: 'endTs',
            process_name: 'processName',
          },
    };

    const tasks: DirectSkillTask[] = intervals.map((interval, index) => ({
      interval,
      template,
      scopeLabel: interval.label || `${entityType}-${index}`,
    }));

    const directExecutor = new DirectSkillExecutor(
      this.traceProcessorService,
      this.services.modelRouter,
      this.traceId,
      Math.min(this.batchSize, 6)
    );

    try {
      const responses = await directExecutor.executeTasks(tasks, emitter);
      const findings: Finding[] = [];
      for (const response of responses) {
        if (response.findings?.length) findings.push(...response.findings);
      }
      return { findings, responses };
    } catch {
      return { findings: [], responses: [] };
    }
  }

  private summaryFinding(entityType: 'frame' | 'session', analyzedCount: number, remainingCount: number): Finding {
    return {
      id: `agentv2_extend_summary_${Date.now()}`,
      category: 'extension',
      type: 'extend_summary',
      severity: 'info',
      title: '扩展分析完成',
      description: remainingCount > 0
        ? `本次扩展分析了 ${analyzedCount} 个${entityType === 'frame' ? '帧' : '会话'}，剩余 ${remainingCount} 个可继续分析。`
        : `本次扩展分析了 ${analyzedCount} 个${entityType === 'frame' ? '帧' : '会话'}，候选实体已分析完毕。`,
      source: 'agentv2.extend',
      confidence: 0.85,
      details: {
        entityType,
        analyzedCount,
        remainingCount,
      },
    };
  }

  private nothingToExtendResult(): ExecutorResult {
    return {
      findings: [
        {
          id: `agentv2_extend_info_${Date.now()}`,
          category: 'info',
          type: 'extend_complete',
          severity: 'info',
          title: '无更多实体可分析',
          description: '当前候选帧/会话均已分析。',
          source: 'agentv2.extend',
          confidence: 1,
        },
      ],
      lastStrategy: concludeDecision(0.9, 'nothing_to_extend'),
      confidence: 0.9,
      informationGaps: [],
      rounds: 1,
      stopReason: 'nothing_to_extend',
    };
  }

  private resolutionFailedResult(requestedCount: number): ExecutorResult {
    return {
      findings: [
        {
          id: `agentv2_extend_error_${Date.now()}`,
          category: 'error',
          type: 'extend_error',
          severity: 'warning',
          title: '实体解析失败',
          description: `无法为 ${requestedCount} 个实体构建有效时间区间。`,
          source: 'agentv2.extend',
          confidence: 1,
        },
      ],
      lastStrategy: concludeDecision(0.3, 'resolution_failed'),
      confidence: 0.3,
      informationGaps: ['实体缓存缺少时间范围'],
      rounds: 1,
      stopReason: 'resolution_failed',
    };
  }
}
