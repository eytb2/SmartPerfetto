/**
 * Scene Reconstruction Expert Agent
 *
 * 场景还原专家 Agent - 智能识别和还原 Trace 期间的用户操作场景
 *
 * 采用两阶段分析策略：
 * - Phase 1: 场景检测 - 收集基础数据，识别场景类型
 * - Phase 2: 深度分析 - 根据场景类型调用对应 skill 进行详细分析
 */

import { BaseExpertAgent, LLMClient } from './baseExpertAgent';
import {
  ExpertAgentConfig,
  Intent,
  AnalysisContext,
  ExpertResult,
  Finding,
  AgentTrace,
  ToolResult,
  StreamingUpdate,
} from '../types';

// =============================================================================
// Scene Types
// =============================================================================

export type SceneCategory =
  | 'cold_start'      // 冷启动
  | 'warm_start'      // 温启动
  | 'hot_start'       // 热启动
  | 'scroll'          // 滑动浏览
  | 'navigation'      // 页面跳转
  | 'app_switch'      // 应用切换
  | 'screen_unlock'   // 解锁屏幕
  | 'notification'    // 通知操作
  | 'split_screen'    // 分屏操作
  | 'tap'             // 点击操作
  | 'long_press'      // 长按操作
  | 'idle';           // 空闲状态

export interface DetectedScene {
  type: SceneCategory;
  startTs: string;
  endTs: string;
  durationMs: number;
  confidence: number;
  appPackage?: string;
  activityName?: string;
  metadata?: Record<string, any>;
}

export interface TrackEvent {
  ts: string;
  dur: string;
  name: string;
  category: 'scene' | 'action' | 'performance' | 'finding';
  colorScheme: 'scroll' | 'tap' | 'launch' | 'system' | 'jank' | 'navigation';
  details?: Record<string, any>;
}

export interface SceneReconstructionResult extends ExpertResult {
  scenes: DetectedScene[];
  trackEvents: TrackEvent[];
  narrative: string;
}

// =============================================================================
// Scene Knowledge Base
// =============================================================================

const SCENE_KNOWLEDGE = {
  // 场景类型到 Skill 的映射
  sceneToSkill: {
    'cold_start': 'startup_analysis',
    'warm_start': 'startup_analysis',
    'hot_start': 'startup_analysis',
    'scroll': 'scrolling_analysis',
    'navigation': 'click_response_analysis',
    'tap': 'click_response_analysis',
    'app_switch': null,  // 基础信息即可
    'screen_unlock': null,
    'notification': null,
    'split_screen': null,
    'long_press': null,
    'idle': 'cpu_analysis',
  } as Record<SceneCategory, string | null>,

  // 场景类型的显示名称
  sceneDisplayNames: {
    'cold_start': '冷启动',
    'warm_start': '温启动',
    'hot_start': '热启动',
    'scroll': '滑动浏览',
    'navigation': '页面跳转',
    'app_switch': '应用切换',
    'screen_unlock': '解锁屏幕',
    'notification': '通知操作',
    'split_screen': '分屏操作',
    'tap': '点击',
    'long_press': '长按',
    'idle': '空闲',
  } as Record<SceneCategory, string>,

  // 场景类型的颜色编码
  sceneColorSchemes: {
    'cold_start': 'launch',
    'warm_start': 'launch',
    'hot_start': 'launch',
    'scroll': 'scroll',
    'navigation': 'navigation',
    'app_switch': 'system',
    'screen_unlock': 'system',
    'notification': 'system',
    'split_screen': 'system',
    'tap': 'tap',
    'long_press': 'tap',
    'idle': 'system',
  } as Record<SceneCategory, TrackEvent['colorScheme']>,

  // 性能阈值
  performanceThresholds: {
    coldStartMs: { good: 500, acceptable: 1000 },
    warmStartMs: { good: 300, acceptable: 600 },
    hotStartMs: { good: 100, acceptable: 200 },
    scrollFps: { good: 55, acceptable: 45 },
    scrollJankRate: { good: 5, acceptable: 15 },
    tapResponseMs: { good: 100, acceptable: 200 },
    navigationMs: { good: 300, acceptable: 500 },
  },
};

// =============================================================================
// Agent Configuration
// =============================================================================

const SCENE_RECONSTRUCTION_CONFIG: ExpertAgentConfig = {
  name: 'SceneReconstructionExpert',
  domain: 'scene_reconstruction',
  description: '智能还原 Trace 期间用户的完整操作场景，分析性能表现',
  tools: ['execute_sql', 'analyze_frame', 'calculate_stats', 'invoke_skill'],
  maxIterations: 15,
  confidenceThreshold: 0.75,
};

// =============================================================================
// Scene Reconstruction Expert Agent
// =============================================================================

export class SceneReconstructionExpertAgent extends BaseExpertAgent {
  private streamingCallback?: (update: StreamingUpdate) => void;
  private detectedScenes: DetectedScene[] = [];
  private trackEvents: TrackEvent[] = [];

  constructor(llm: LLMClient) {
    super(SCENE_RECONSTRUCTION_CONFIG, llm);
  }

  /**
   * 设置流式更新回调
   */
  setStreamingCallback(callback: (update: StreamingUpdate) => void): void {
    this.streamingCallback = callback;
  }

  /**
   * 发送流式更新
   */
  private emitUpdate(type: StreamingUpdate['type'], content: any): void {
    if (this.streamingCallback) {
      this.streamingCallback({
        type,
        content,
        timestamp: Date.now(),
      });
    }
  }

  canHandle(intent: Intent): boolean {
    const sceneKeywords = [
      'scene', 'reconstruct', 'what happened', 'user action', 'user behavior',
      'timeline', 'sequence', 'events', 'activity',
      '场景', '还原', '发生', '用户', '操作', '行为', '时间线', '事件',
    ];

    const aspectMatch = intent.aspects.some(a =>
      sceneKeywords.some(k => a.toLowerCase().includes(k))
    );
    const goalMatch = sceneKeywords.some(k =>
      intent.primaryGoal.toLowerCase().includes(k)
    );

    return aspectMatch || goalMatch;
  }

  protected getSystemPrompt(): string {
    return `你是一个场景还原专家 Agent，专门分析 Android Perfetto Trace 中的用户操作场景。

你的专业能力包括：
- 从 Trace 数据中识别用户操作场景（启动、滑动、点击、跳转等）
- 分析各场景的性能表现（启动耗时、滑动流畅度、响应延迟等）
- 智能判断数据价值，筛选有意义的信息呈现给用户
- 生成结构化的时间线和叙事报告

场景类型：
${Object.entries(SCENE_KNOWLEDGE.sceneDisplayNames).map(([k, v]) => `- ${k}: ${v}`).join('\n')}

性能阈值：
- 冷启动: 良好 < ${SCENE_KNOWLEDGE.performanceThresholds.coldStartMs.good}ms, 可接受 < ${SCENE_KNOWLEDGE.performanceThresholds.coldStartMs.acceptable}ms
- 滑动 FPS: 良好 > ${SCENE_KNOWLEDGE.performanceThresholds.scrollFps.good}, 可接受 > ${SCENE_KNOWLEDGE.performanceThresholds.scrollFps.acceptable}
- 点击响应: 良好 < ${SCENE_KNOWLEDGE.performanceThresholds.tapResponseMs.good}ms

分析策略：
1. Phase 1 (场景检测): 收集基础数据，识别所有场景类型和时间范围
2. Phase 2 (深度分析): 针对每个检测到的场景，调用对应的专业 skill 进行详细分析
3. Phase 3 (综合评估): 评估数据价值，生成结构化报告和 Perfetto 泳道数据

输出要求：
- 每个场景事件必须包含精确的时间戳 [[ts:纳秒]]
- 性能数据要与阈值对比，给出评级（良好/可接受/需优化）
- 生成简洁但信息丰富的叙事报告`;
  }

  protected getAnalysisGoals(context: AnalysisContext): string[] {
    const pkg = context.package || '目标应用';
    return [
      '识别 Trace 时间范围内的所有用户操作场景',
      `分析 ${pkg} 的启动性能（如有）`,
      '检测滑动操作并分析流畅度',
      '识别页面跳转和响应延迟',
      '检测系统事件（解锁、通知等）',
      '评估性能问题并标记异常',
      '生成结构化的场景时间线',
    ];
  }

  /**
   * 重写 analyze 方法，实现两阶段分析
   */
  async analyze(context: AnalysisContext): Promise<SceneReconstructionResult> {
    const startTime = Date.now();
    this.detectedScenes = [];
    this.trackEvents = [];

    const trace: AgentTrace = {
      agentName: this.config.name,
      startTime,
      endTime: 0,
      thoughts: [],
      toolCalls: [],
    };

    const findings: Finding[] = [];

    try {
      // =========================================================================
      // Phase 1: 场景检测
      // =========================================================================
      this.emitUpdate('progress', { phase: 1, message: '正在检测场景类型...' });
      this.emitUpdate('thought', { reasoning: '开始收集基础数据，识别用户操作场景' });

      const sceneDetectionResult = await this.detectScenes(context, trace);
      this.detectedScenes = sceneDetectionResult.scenes;

      // 发送检测到的场景
      for (const scene of this.detectedScenes) {
        this.emitUpdate('scene_detected', {
          scene,
          displayName: SCENE_KNOWLEDGE.sceneDisplayNames[scene.type],
        });
      }

      this.emitUpdate('progress', {
        phase: 1,
        message: `检测到 ${this.detectedScenes.length} 个场景`,
        scenes: this.detectedScenes.length,
      });

      // =========================================================================
      // Phase 2: 深度分析
      // =========================================================================
      this.emitUpdate('progress', { phase: 2, message: '正在进行深度分析...' });

      for (const scene of this.detectedScenes) {
        const skillId = SCENE_KNOWLEDGE.sceneToSkill[scene.type];

        if (skillId) {
          this.emitUpdate('thought', {
            reasoning: `分析 ${SCENE_KNOWLEDGE.sceneDisplayNames[scene.type]} 场景，调用 ${skillId}`
          });

          const sceneFindings = await this.analyzeScene(scene, context, trace);
          findings.push(...sceneFindings);

          for (const finding of sceneFindings) {
            this.emitUpdate('finding', finding);
          }
        } else {
          // 生成基础场景 finding
          const basicFinding = this.createBasicSceneFinding(scene);
          findings.push(basicFinding);
        }

        // 生成 track event
        const trackEvent = this.createTrackEvent(scene, findings);
        this.trackEvents.push(trackEvent);
      }

      // =========================================================================
      // Phase 3: 综合评估
      // =========================================================================
      this.emitUpdate('progress', { phase: 3, message: '正在生成报告...' });

      const narrative = await this.generateNarrative(this.detectedScenes, findings, context);

      // 发送 track 数据
      this.emitUpdate('track_data', {
        tracks: this.trackEvents,
      });

      this.emitUpdate('conclusion', { narrative });

      trace.endTime = Date.now();

      return {
        agentName: this.config.name,
        findings,
        diagnostics: [],
        suggestions: this.generateSuggestions(findings),
        confidence: this.calculateOverallConfidence(),
        executionTimeMs: Date.now() - startTime,
        trace,
        scenes: this.detectedScenes,
        trackEvents: this.trackEvents,
        narrative,
      };

    } catch (error: any) {
      trace.endTime = Date.now();
      this.emitUpdate('error', { message: error.message });

      return {
        agentName: this.config.name,
        findings,
        diagnostics: [{
          id: 'error',
          condition: 'execution_error',
          matched: true,
          message: `场景还原失败: ${error.message}`,
          suggestions: ['请检查 Trace 数据是否完整'],
        }],
        suggestions: [],
        confidence: 0,
        executionTimeMs: Date.now() - startTime,
        trace,
        scenes: this.detectedScenes,
        trackEvents: this.trackEvents,
        narrative: '',
      };
    }
  }

  /**
   * Phase 1: 场景检测
   */
  private async detectScenes(
    context: AnalysisContext,
    trace: AgentTrace
  ): Promise<{ scenes: DetectedScene[] }> {
    const scenes: DetectedScene[] = [];

    // 1. 获取 Trace 时间范围
    const timeRangeResult = await this.executeTool('execute_sql', {
      sql: `SELECT MIN(ts) AS start_ts, MAX(ts) AS end_ts FROM slice LIMIT 1`,
    }, context);

    const traceStartTs = timeRangeResult.data?.rows?.[0]?.[0] || '0';
    const traceEndTs = timeRangeResult.data?.rows?.[0]?.[1] || '0';

    // 2. 检测 App 启动
    const startupResult = await this.executeTool('execute_sql', {
      sql: `
        SELECT
          ts,
          dur,
          package,
          startup_type,
          CAST(dur / 1000000 AS INT) AS dur_ms
        FROM android_startups
        WHERE dur > 0
        ORDER BY ts
      `,
    }, context);

    if (startupResult.success && startupResult.data?.rows) {
      for (const row of startupResult.data.rows) {
        const [ts, dur, pkg, startupType, durMs] = row;
        let sceneType: SceneCategory = 'cold_start';
        if (startupType === 'warm') sceneType = 'warm_start';
        else if (startupType === 'hot') sceneType = 'hot_start';

        scenes.push({
          type: sceneType,
          startTs: String(ts),
          endTs: String(BigInt(ts) + BigInt(dur)),
          durationMs: Number(durMs),
          confidence: 0.95,
          appPackage: pkg,
          metadata: { startupType },
        });
      }
    }

    // 3. 检测滑动场景 - 多信号组合判断 Fling 结束
    // 策略：
    //   - DOWN/UP 确定按压滑动阶段
    //   - Fling 结束 = 帧间隔 > 100ms + 帧时长变异系数 < 0.15 + 无新输入事件
    //   - 用帧数据计算整体 FPS
    const scrollResult = await this.executeTool('execute_sql', {
      sql: `
        WITH
        -- 获取 motion 事件（滑动手势）
        motion_events AS (
          SELECT
            read_time AS ts,
            event_action
          FROM android_input_events
          WHERE event_type = 'MOTION'
        ),
        -- 标记手势边界
        gesture_markers AS (
          SELECT
            ts,
            event_action,
            SUM(CASE WHEN event_action = 'DOWN' THEN 1 ELSE 0 END) OVER (ORDER BY ts) AS gesture_id
          FROM motion_events
        ),
        -- 聚合每个手势的时间范围
        gestures AS (
          SELECT
            gesture_id,
            MIN(ts) AS down_ts,
            MAX(CASE WHEN event_action = 'UP' THEN ts ELSE NULL END) AS up_ts,
            COUNT(*) AS event_count
          FROM gesture_markers
          WHERE gesture_id > 0
          GROUP BY gesture_id
          HAVING COUNT(*) >= 4  -- 至少有 DOWN, MOVE, MOVE, UP (真正的滑动)
        ),
        -- 准备帧数据：计算帧间隔和帧时长变异
        frame_with_stats AS (
          SELECT
            ts,
            dur,
            ts + dur AS frame_end,
            jank_type,
            COALESCE(LEAD(ts) OVER (ORDER BY ts) - (ts + dur), 999999999) AS gap_to_next,
            -- 帧时长变异系数：使用滑动窗口计算 (max-min)/avg 作为近似
            -- SQLite 没有 STDDEV，用 (max-min)/avg 近似变异程度
            (MAX(dur) OVER (ORDER BY ts ROWS BETWEEN 10 PRECEDING AND CURRENT ROW) -
             MIN(dur) OVER (ORDER BY ts ROWS BETWEEN 10 PRECEDING AND CURRENT ROW)) * 1.0 /
            NULLIF(AVG(dur) OVER (ORDER BY ts ROWS BETWEEN 10 PRECEDING AND CURRENT ROW), 0)
              AS dur_variance_ratio
          FROM actual_frame_timeline_slice
          WHERE surface_frame_token IS NOT NULL AND dur > 0
        ),
        -- 对每个手势，用多信号组合找到真正的 fling 结束
        gesture_fling_end AS (
          SELECT
            g.gesture_id,
            g.down_ts,
            g.up_ts,
            -- fling 结束 = 满足多信号条件的第一帧
            COALESCE(
              (SELECT MIN(f.frame_end)
               FROM frame_with_stats f
               WHERE f.ts >= g.up_ts
                 -- 信号 1: 帧间隔 > 100ms
                 AND f.gap_to_next > 100000000
                 -- 信号 2: 帧时长变异比 < 0.3 (变异系数 0.15 对应 range/avg 约 0.3)
                 AND f.dur_variance_ratio < 0.3
                 -- 信号 3: 之后 100ms 内没有新的 MOVE 输入事件
                 AND NOT EXISTS (
                   SELECT 1 FROM android_input_events i
                   WHERE i.event_action = 'MOVE'
                     AND i.read_time > f.ts
                     AND i.read_time < f.ts + 100000000
                 )
              ),
              -- 备选：只满足帧间隔条件，但有 3 秒上限
              (SELECT MIN(f.frame_end)
               FROM frame_with_stats f
               WHERE f.ts >= g.up_ts
                 AND f.ts <= g.up_ts + 3000000000  -- 3 秒上限
                 AND f.gap_to_next > 100000000
              ),
              -- 兜底：UP + 500ms
              g.up_ts + 500000000
            ) AS fling_end_ts
          FROM gestures g
          WHERE g.up_ts IS NOT NULL
        ),
        -- 计算滑动区间的帧统计
        scroll_frame_stats AS (
          SELECT
            gfe.gesture_id,
            gfe.down_ts AS start_ts,
            gfe.fling_end_ts AS end_ts,
            gfe.up_ts,
            COUNT(f.ts) AS frame_count,
            SUM(CASE WHEN f.jank_type != 'None' THEN 1 ELSE 0 END) AS jank_count,
            -- FPS = 帧数 / 持续时间 (参考 scrolling_analysis.skill.yaml)
            ROUND(1e9 * COUNT(f.ts) / NULLIF(gfe.fling_end_ts - gfe.down_ts, 0), 1) AS avg_fps
          FROM gesture_fling_end gfe
          LEFT JOIN frame_with_stats f
            ON f.ts >= gfe.down_ts
            AND f.ts <= gfe.fling_end_ts
          GROUP BY gfe.gesture_id
          HAVING COUNT(f.ts) >= 5  -- 至少 5 帧才是有效滑动
        )
        SELECT
          start_ts,
          end_ts,
          up_ts,
          CAST((end_ts - start_ts) / 1000000 AS INT) AS dur_ms,
          CAST((up_ts - start_ts) / 1000000 AS INT) AS touch_dur_ms,
          CAST((end_ts - up_ts) / 1000000 AS INT) AS fling_dur_ms,
          frame_count,
          avg_fps,
          jank_count,
          ROUND(100.0 * jank_count / NULLIF(frame_count, 0), 1) AS jank_rate
        FROM scroll_frame_stats
        WHERE (end_ts - start_ts) > 200000000  -- 至少 200ms
        ORDER BY start_ts
        LIMIT 30
      `,
    }, context);

    if (scrollResult.success && scrollResult.data?.rows) {
      for (const row of scrollResult.data.rows) {
        const [startTs, endTs, upTs, durMs, touchDurMs, flingDurMs, frameCount, avgFps, jankCount, jankRate] = row;

        // 获取此时间段的前台应用
        const appResult = await this.executeTool('execute_sql', {
          sql: `
            SELECT str_value
            FROM android_battery_stats_event_slices
            WHERE track_name = 'battery_stats.top'
              AND ts <= ${startTs}
            ORDER BY ts DESC
            LIMIT 1
          `,
        }, context);

        const foregroundApp = appResult.data?.rows?.[0]?.[0];
        const appName = foregroundApp
          ? String(foregroundApp).replace('com.', '').replace('android.', '')
          : undefined;

        const hasFling = Number(flingDurMs) > 50; // fling > 50ms 算有效

        scenes.push({
          type: 'scroll' as SceneCategory,
          startTs: String(startTs),
          endTs: String(endTs),
          durationMs: Number(durMs),
          confidence: 0.9,
          appPackage: appName,
          metadata: {
            frameCount: Number(frameCount),
            avgFps: Number(avgFps),
            jankCount: Number(jankCount),
            jankRate: Number(jankRate),
            touchDurMs: Number(touchDurMs),
            flingDurMs: Number(flingDurMs),
            hasFling,
            upTs: String(upTs),
          },
        });
      }
    }

    // 4. 检测应用切换
    const appSwitchResult = await this.executeTool('execute_sql', {
      sql: `
        SELECT
          ts,
          safe_dur AS dur,
          str_value AS app_name,
          CAST(safe_dur / 1000000 AS INT) AS dur_ms
        FROM android_battery_stats_event_slices
        WHERE track_name = 'battery_stats.top'
          AND safe_dur > 50000000
        ORDER BY ts
        LIMIT 50
      `,
    }, context);

    if (appSwitchResult.success && appSwitchResult.data?.rows) {
      let prevApp: string | null = null;
      for (const row of appSwitchResult.data.rows) {
        const [ts, dur, appName, durMs] = row;
        if (prevApp && prevApp !== appName) {
          scenes.push({
            type: 'app_switch',
            startTs: String(ts),
            endTs: String(BigInt(ts) + BigInt(dur)),
            durationMs: Number(durMs),
            confidence: 0.9,
            appPackage: appName,
            metadata: { fromApp: prevApp, toApp: appName },
          });
        }
        prevApp = appName;
      }
    }

    // 5. 检测系统事件（解锁、通知等）- 使用更精确的匹配并去重
    const systemEventResult = await this.executeTool('execute_sql', {
      sql: `
        WITH system_events AS (
          SELECT
            ts,
            dur,
            name,
            CAST(dur / 1000000 AS INT) AS dur_ms,
            CASE
              -- 更精确的解锁检测：只匹配明确的 Keyguard dismiss 事件
              WHEN name GLOB '*KeyguardViewMediator*dismiss*'
                   OR name GLOB '*PhoneWindowManager*screenTurnedOff*dismiss*'
                   OR name = 'Keyguard dismiss animation'
              THEN 'screen_unlock'
              -- 通知面板展开
              WHEN name GLOB '*NotificationPanelView*expand*'
                   OR name GLOB '*NotificationShade*expand*'
              THEN 'notification'
              -- 分屏
              WHEN name GLOB '*SplitScreen*enter*' OR name GLOB '*MultiWindow*enter*'
              THEN 'split_screen'
              ELSE NULL
            END AS event_type
          FROM slice
          WHERE (
            name GLOB '*KeyguardViewMediator*dismiss*'
            OR name GLOB '*PhoneWindowManager*screenTurnedOff*'
            OR name = 'Keyguard dismiss animation'
            OR name GLOB '*NotificationPanelView*expand*'
            OR name GLOB '*NotificationShade*expand*'
            OR name GLOB '*SplitScreen*enter*'
            OR name GLOB '*MultiWindow*enter*'
          )
          AND dur > 1000000  -- 至少1ms，过滤噪音
        ),
        -- 去重：同类事件在1秒内只保留一个
        deduplicated AS (
          SELECT
            ts, dur, name, dur_ms, event_type,
            LAG(ts) OVER (PARTITION BY event_type ORDER BY ts) AS prev_ts
          FROM system_events
          WHERE event_type IS NOT NULL
        )
        SELECT ts, dur, name, dur_ms, event_type
        FROM deduplicated
        WHERE prev_ts IS NULL OR ts - prev_ts > 1000000000  -- 1秒间隔
        ORDER BY ts
        LIMIT 20
      `,
    }, context);

    if (systemEventResult.success && systemEventResult.data?.rows) {
      for (const row of systemEventResult.data.rows) {
        const [ts, dur, name, durMs, eventType] = row;
        if (eventType) {
          scenes.push({
            type: eventType as SceneCategory,
            startTs: String(ts),
            endTs: String(BigInt(ts) + BigInt(dur)),
            durationMs: Number(durMs),
            confidence: 0.9,
            metadata: { sliceName: name },
          });
        }
      }
    }

    // 按时间排序
    scenes.sort((a, b) => BigInt(a.startTs) > BigInt(b.startTs) ? 1 : -1);

    return { scenes };
  }

  /**
   * Phase 2: 深度分析单个场景
   */
  private async analyzeScene(
    scene: DetectedScene,
    context: AnalysisContext,
    trace: AgentTrace
  ): Promise<Finding[]> {
    const findings: Finding[] = [];
    const skillId = SCENE_KNOWLEDGE.sceneToSkill[scene.type];

    if (!skillId) {
      return findings;
    }

    this.emitUpdate('tool_call', {
      toolName: 'invoke_skill',
      params: { skillId, scene },
    });

    // 根据场景类型执行不同的分析
    switch (scene.type) {
      case 'cold_start':
      case 'warm_start':
      case 'hot_start':
        findings.push(...await this.analyzeStartup(scene, context));
        break;

      case 'scroll':
        findings.push(...await this.analyzeScroll(scene, context));
        break;

      case 'tap':
      case 'navigation':
        findings.push(...await this.analyzeTapOrNavigation(scene, context));
        break;
    }

    return findings;
  }

  /**
   * 分析启动场景
   */
  private async analyzeStartup(scene: DetectedScene, context: AnalysisContext): Promise<Finding[]> {
    const findings: Finding[] = [];
    const thresholds = SCENE_KNOWLEDGE.performanceThresholds;

    let rating = '需优化';
    let threshold = thresholds.coldStartMs;

    if (scene.type === 'warm_start') threshold = thresholds.warmStartMs;
    else if (scene.type === 'hot_start') threshold = thresholds.hotStartMs;

    if (scene.durationMs < threshold.good) rating = '良好';
    else if (scene.durationMs < threshold.acceptable) rating = '可接受';

    const displayName = SCENE_KNOWLEDGE.sceneDisplayNames[scene.type];
    const appName = scene.appPackage?.replace('com.', '').replace('android.', '') || '未知应用';

    findings.push({
      id: `startup_${scene.startTs}`,
      category: 'startup',
      severity: rating === '需优化' ? 'warning' : 'info',
      title: `${displayName} ${appName} [${scene.durationMs}ms]`,
      description: `${displayName} ${appName}，耗时 ${scene.durationMs}ms，评级：${rating}`,
      evidence: [{ durationMs: scene.durationMs, rating, threshold }],
      timestampsNs: [Number(scene.startTs)],
    });

    // 获取更详细的启动分析
    const detailResult = await this.executeTool('execute_sql', {
      sql: `
        SELECT
          package,
          startup_type,
          CAST(time_to_initial_display / 1000000 AS INT) AS ttid_ms,
          CAST(time_to_full_display / 1000000 AS INT) AS ttfd_ms
        FROM android_startups
        WHERE ts = ${scene.startTs}
        LIMIT 1
      `,
    }, context);

    if (detailResult.success && detailResult.data?.rows?.[0]) {
      const [, , ttidMs, ttfdMs] = detailResult.data.rows[0];
      if (ttidMs || ttfdMs) {
        findings[findings.length - 1].evidence.push({
          ttidMs: ttidMs || 'N/A',
          ttfdMs: ttfdMs || 'N/A',
        });
      }
    }

    return findings;
  }

  /**
   * 分析滑动场景
   * 使用场景检测阶段已收集的数据，避免重复查询
   */
  private async analyzeScroll(scene: DetectedScene, _context: AnalysisContext): Promise<Finding[]> {
    const findings: Finding[] = [];
    const thresholds = SCENE_KNOWLEDGE.performanceThresholds;

    // 从 metadata 获取帧数据（场景检测时已收集）
    const metadata = scene.metadata || {};
    const avgFps = metadata.avgFps ?? null;
    const jankRate = metadata.jankRate ?? null;
    const frameCount = metadata.frameCount ?? 0;
    const jankCount = metadata.jankCount ?? 0;
    const touchDurMs = metadata.touchDurMs ?? 0;
    const flingDurMs = metadata.flingDurMs ?? 0;
    const hasFling = metadata.hasFling ?? false;

    let fpsRating = '需优化';
    if (avgFps !== null && avgFps >= thresholds.scrollFps.good) fpsRating = '良好';
    else if (avgFps !== null && avgFps >= thresholds.scrollFps.acceptable) fpsRating = '可接受';

    let jankRating = '良好';
    if (jankRate !== null && jankRate > thresholds.scrollJankRate.acceptable) jankRating = '需优化';
    else if (jankRate !== null && jankRate > thresholds.scrollJankRate.good) jankRating = '可接受';

    const appName = scene.appPackage || '';
    const locationStr = appName ? ` [${appName}]` : '';

    const fpsDisplay = avgFps !== null ? avgFps.toFixed(1) : 'N/A';
    const jankDisplay = jankRate !== null ? jankRate.toFixed(1) : 'N/A';

    // 构建更详细的描述
    let phaseInfo = '';
    if (hasFling) {
      phaseInfo = `（按压 ${touchDurMs}ms + 惯性 ${flingDurMs}ms）`;
    } else {
      phaseInfo = `（按压滑动）`;
    }

    findings.push({
      id: `scroll_${scene.startTs}`,
      category: 'scroll',
      severity: jankRating === '需优化' ? 'warning' : 'info',
      title: `滑动${locationStr} ${scene.durationMs}ms ${phaseInfo} FPS: ${fpsDisplay}`,
      description: `滑动浏览${locationStr}，总时长 ${scene.durationMs}ms${phaseInfo}，平均 FPS ${fpsDisplay}（${fpsRating}），掉帧率 ${jankDisplay}%（${jankRating}），共 ${frameCount} 帧`,
      evidence: [{
        frameCount,
        jankCount,
        jankRate,
        avgFps,
        fpsRating,
        jankRating,
        durationMs: scene.durationMs,
        touchDurMs,
        flingDurMs,
        hasFling,
      }],
      timestampsNs: [Number(scene.startTs)],
    });

    return findings;
  }

  /**
   * 分析点击/跳转场景
   */
  private async analyzeTapOrNavigation(scene: DetectedScene, context: AnalysisContext): Promise<Finding[]> {
    const findings: Finding[] = [];
    const thresholds = SCENE_KNOWLEDGE.performanceThresholds;

    let rating = '需优化';
    if (scene.durationMs < thresholds.tapResponseMs.good) rating = '良好';
    else if (scene.durationMs < thresholds.tapResponseMs.acceptable) rating = '可接受';

    const appName = scene.appPackage?.replace('com.', '').replace('android.', '') || '';
    const locationStr = appName ? ` [${appName}]` : '';
    const actionName = scene.type === 'navigation' ? '页面跳转' : '点击';

    findings.push({
      id: `tap_${scene.startTs}`,
      category: scene.type,
      severity: rating === '需优化' ? 'warning' : 'info',
      title: `${actionName}${locationStr} [${scene.durationMs}ms]`,
      description: `${actionName}${locationStr}，响应延迟 ${scene.durationMs}ms，评级：${rating}`,
      evidence: [{ durationMs: scene.durationMs, rating }],
      timestampsNs: [Number(scene.startTs)],
    });

    return findings;
  }

  /**
   * 创建基础场景 Finding
   */
  private createBasicSceneFinding(scene: DetectedScene): Finding {
    const displayName = SCENE_KNOWLEDGE.sceneDisplayNames[scene.type];
    const appName = scene.appPackage?.replace('com.', '').replace('android.', '') || '';
    const locationStr = appName ? ` [${appName}]` : '';

    return {
      id: `scene_${scene.startTs}`,
      category: scene.type,
      severity: 'info',
      title: `${displayName}${locationStr}`,
      description: `${displayName}${locationStr}，持续 ${scene.durationMs}ms`,
      evidence: [{ durationMs: scene.durationMs }],
      timestampsNs: [Number(scene.startTs)],
    };
  }

  /**
   * 创建 Track Event
   */
  private createTrackEvent(scene: DetectedScene, findings: Finding[]): TrackEvent {
    const displayName = SCENE_KNOWLEDGE.sceneDisplayNames[scene.type];
    const colorScheme = SCENE_KNOWLEDGE.sceneColorSchemes[scene.type];
    const appName = scene.appPackage?.replace('com.', '').replace('android.', '') || '';

    // 找到对应的 finding 来丰富显示信息
    const relatedFinding = findings.find(f => f.id.includes(scene.startTs));
    let name = displayName;

    if (appName) name += ` [${appName}]`;
    if (scene.durationMs) name += ` ${scene.durationMs}ms`;

    return {
      ts: scene.startTs,
      dur: String(BigInt(scene.endTs) - BigInt(scene.startTs)),
      name,
      category: 'scene',
      colorScheme,
      details: {
        sceneType: scene.type,
        appPackage: scene.appPackage,
        durationMs: scene.durationMs,
        confidence: scene.confidence,
        finding: relatedFinding,
      },
    };
  }

  /**
   * 生成叙事报告
   */
  private async generateNarrative(
    scenes: DetectedScene[],
    findings: Finding[],
    context: AnalysisContext
  ): Promise<string> {
    if (scenes.length === 0) {
      return '未检测到明显的用户操作场景。';
    }

    // 计算 Trace 时间范围
    const firstTs = BigInt(scenes[0].startTs);
    const lastTs = BigInt(scenes[scenes.length - 1].endTs);
    const totalDurationSec = Number(lastTs - firstTs) / 1_000_000_000;

    // 使用 LLM 生成叙事
    const prompt = `基于以下场景数据，生成一段简洁的用户操作还原报告（中文，100-200字）：

Trace 总时长: ${totalDurationSec.toFixed(1)} 秒

检测到的场景：
${scenes.map((s, i) => {
  const offsetSec = Number(BigInt(s.startTs) - firstTs) / 1_000_000_000;
  return `${i + 1}. [${offsetSec.toFixed(1)}s] ${SCENE_KNOWLEDGE.sceneDisplayNames[s.type]} ${s.appPackage || ''} (${s.durationMs}ms)`;
}).join('\n')}

性能发现：
${findings.filter(f => f.severity !== 'info').map(f => `- ${f.title}: ${f.description}`).join('\n') || '无明显性能问题'}

请生成：
1. 场景概述（描述用户主要做了什么）
2. 性能评估（简要评价整体表现）
3. 关键发现（如有性能问题，指出最重要的1-2个）`;

    try {
      const narrative = await this.llm.complete(prompt);
      return narrative.trim();
    } catch {
      // 降级到简单报告
      return `在 ${totalDurationSec.toFixed(1)} 秒的 Trace 期间，检测到 ${scenes.length} 个用户操作场景，包括 ${scenes.map(s => SCENE_KNOWLEDGE.sceneDisplayNames[s.type]).join('、')}。`;
    }
  }

  /**
   * 生成建议
   */
  private generateSuggestions(findings: Finding[]): string[] {
    const suggestions: string[] = [];

    const warningFindings = findings.filter(f => f.severity === 'warning' || f.severity === 'critical');

    for (const finding of warningFindings) {
      if (finding.category.includes('start')) {
        suggestions.push(`优化 ${finding.title.split('[')[0].trim()} 的启动耗时，考虑使用 Baseline Profile 或延迟初始化`);
      } else if (finding.category === 'scroll') {
        suggestions.push(`优化滑动流畅度，检查是否有主线程阻塞或 Binder 调用延迟`);
      } else if (finding.category === 'tap' || finding.category === 'navigation') {
        suggestions.push(`优化点击响应速度，检查事件处理是否有耗时操作`);
      }
    }

    return suggestions.slice(0, 5); // 最多返回 5 条建议
  }

  /**
   * 计算整体置信度
   */
  private calculateOverallConfidence(): number {
    if (this.detectedScenes.length === 0) return 0.5;

    const avgConfidence = this.detectedScenes.reduce((sum, s) => sum + s.confidence, 0) / this.detectedScenes.length;
    return Math.min(avgConfidence, 0.95);
  }
}

// =============================================================================
// Factory Function
// =============================================================================

export function createSceneReconstructionAgent(llm: LLMClient): SceneReconstructionExpertAgent {
  return new SceneReconstructionExpertAgent(llm);
}
