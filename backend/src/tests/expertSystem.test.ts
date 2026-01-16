/**
 * Expert System Tests
 *
 * Tests for the Phase 3 Expert Agent System:
 * - Expert registration and routing
 * - Intent parsing
 * - Expert analysis execution
 * - Architecture-aware strategy selection
 */

import {
  expertRegistry,
  initializeExperts,
  parseAnalysisIntent,
  getExpertForIntent,
  InteractionExpert,
  LaunchExpert,
  SystemExpert,
  createInteractionExpert,
  createLaunchExpert,
  createSystemExpert,
  ExpertInput,
  AnalysisIntent,
} from '../agent/experts';

// Reset registry before each test suite
beforeAll(() => {
  // Clear and reinitialize
  initializeExperts();
});

describe('Expert Registry', () => {
  describe('initializeExperts', () => {
    it('should register all domain experts', () => {
      const experts = expertRegistry.list();
      expect(experts.length).toBeGreaterThanOrEqual(3);

      const expertIds = experts.map((e) => e.id);
      expect(expertIds).toContain('interaction_expert');
      expect(expertIds).toContain('launch_expert');
      expect(expertIds).toContain('system_expert');
    });

    it('should support all expected intent categories', () => {
      const supportedIntents = expertRegistry.getSupportedIntents();

      expect(supportedIntents).toContain('SCROLLING');
      expect(supportedIntents).toContain('CLICK');
      expect(supportedIntents).toContain('LAUNCH');
      expect(supportedIntents).toContain('CPU');
      expect(supportedIntents).toContain('MEMORY');
      expect(supportedIntents).toContain('IO');
      expect(supportedIntents).toContain('ANR');
    });
  });

  describe('getExpertForIntent', () => {
    it('should route SCROLLING to InteractionExpert', () => {
      const intent: AnalysisIntent = {
        category: 'SCROLLING',
        originalQuery: '分析滑动卡顿',
        keywords: ['滑动', '卡顿'],
        confidence: 0.9,
      };

      const expert = getExpertForIntent(intent);
      expect(expert).toBeDefined();
      expect(expert?.config.id).toBe('interaction_expert');
    });

    it('should route CLICK to InteractionExpert', () => {
      const intent: AnalysisIntent = {
        category: 'CLICK',
        originalQuery: '点击响应慢',
        keywords: ['点击', '响应'],
        confidence: 0.8,
      };

      const expert = getExpertForIntent(intent);
      expect(expert).toBeDefined();
      expect(expert?.config.id).toBe('interaction_expert');
    });

    it('should route LAUNCH to LaunchExpert', () => {
      const intent: AnalysisIntent = {
        category: 'LAUNCH',
        originalQuery: '启动慢',
        keywords: ['启动'],
        confidence: 0.9,
      };

      const expert = getExpertForIntent(intent);
      expect(expert).toBeDefined();
      expect(expert?.config.id).toBe('launch_expert');
    });

    it('should route CPU to SystemExpert', () => {
      const intent: AnalysisIntent = {
        category: 'CPU',
        originalQuery: 'CPU 占用高',
        keywords: ['CPU'],
        confidence: 0.8,
      };

      const expert = getExpertForIntent(intent);
      expect(expert).toBeDefined();
      expect(expert?.config.id).toBe('system_expert');
    });

    it('should route MEMORY to SystemExpert', () => {
      const intent: AnalysisIntent = {
        category: 'MEMORY',
        originalQuery: '内存泄漏',
        keywords: ['内存'],
        confidence: 0.7,
      };

      const expert = getExpertForIntent(intent);
      expect(expert).toBeDefined();
      expect(expert?.config.id).toBe('system_expert');
    });

    it('should return undefined for GENERAL intent', () => {
      const intent: AnalysisIntent = {
        category: 'GENERAL',
        originalQuery: '分析这个 trace',
        keywords: [],
        confidence: 0.3,
      };

      const expert = getExpertForIntent(intent);
      expect(expert).toBeUndefined();
    });
  });
});

describe('Intent Parsing', () => {
  describe('parseAnalysisIntent', () => {
    it('should parse scrolling-related queries', () => {
      const queries = [
        '分析滑动卡顿',
        '为什么滑动时掉帧',
        'FPS 太低了',
        'scroll jank analysis',
        '列表滑动不流畅',
      ];

      for (const query of queries) {
        const intent = parseAnalysisIntent(query);
        expect(intent.category).toBe('SCROLLING');
        expect(intent.originalQuery).toBe(query);
        expect(intent.keywords.length).toBeGreaterThan(0);
      }
    });

    it('should parse click-related queries', () => {
      const queries = [
        '点击反应慢',
        '点击没有响应',
        'tap response is slow',
      ];

      for (const query of queries) {
        const intent = parseAnalysisIntent(query);
        expect(intent.category).toBe('CLICK');
      }
    });

    it('should parse launch-related queries', () => {
      const queries = [
        '启动太慢了',
        '冷启动分析',
        'app startup performance',
        'TTID 分析',
      ];

      for (const query of queries) {
        const intent = parseAnalysisIntent(query);
        expect(intent.category).toBe('LAUNCH');
      }
    });

    it('should parse CPU-related queries', () => {
      const queries = [
        'CPU 使用率高',
        '处理器负载分析',
        'scheduling 问题',
      ];

      for (const query of queries) {
        const intent = parseAnalysisIntent(query);
        expect(intent.category).toBe('CPU');
      }
    });

    it('should parse memory-related queries', () => {
      const queries = [
        '内存泄漏',
        'GC 频繁',
        'memory leak',
        '堆内存分析',
      ];

      for (const query of queries) {
        const intent = parseAnalysisIntent(query);
        expect(intent.category).toBe('MEMORY');
      }
    });

    it('should parse IO-related queries', () => {
      const queries = [
        '磁盘 IO 慢',
        '网络请求阻塞',
        'blocking operations',
      ];

      for (const query of queries) {
        const intent = parseAnalysisIntent(query);
        expect(intent.category).toBe('IO');
      }
    });

    it('should parse ANR-related queries', () => {
      const queries = [
        'ANR 分析',
        '应用无响应',
        'not responding',
        '死锁问题',
      ];

      for (const query of queries) {
        const intent = parseAnalysisIntent(query);
        expect(intent.category).toBe('ANR');
      }
    });

    it('should return GENERAL for ambiguous queries', () => {
      const queries = [
        '分析一下',
        'what is wrong',
        '看看这个 trace',
      ];

      for (const query of queries) {
        const intent = parseAnalysisIntent(query);
        expect(intent.category).toBe('GENERAL');
        expect(intent.confidence).toBeLessThan(0.5);
      }
    });
  });
});

describe('InteractionExpert', () => {
  let expert: InteractionExpert;

  beforeEach(() => {
    expert = createInteractionExpert();
  });

  describe('canHandle', () => {
    it('should handle SCROLLING intent', () => {
      const intent: AnalysisIntent = {
        category: 'SCROLLING',
        originalQuery: '滑动卡顿',
        keywords: ['滑动'],
        confidence: 0.9,
      };
      expect(expert.canHandle(intent)).toBe(true);
    });

    it('should handle CLICK intent', () => {
      const intent: AnalysisIntent = {
        category: 'CLICK',
        originalQuery: '点击慢',
        keywords: ['点击'],
        confidence: 0.8,
      };
      expect(expert.canHandle(intent)).toBe(true);
    });

    it('should not handle LAUNCH intent', () => {
      const intent: AnalysisIntent = {
        category: 'LAUNCH',
        originalQuery: '启动慢',
        keywords: ['启动'],
        confidence: 0.9,
      };
      expect(expert.canHandle(intent)).toBe(false);
    });
  });

  describe('getDecisionTree', () => {
    it('should return scrolling decision tree', () => {
      const tree = expert.getDecisionTree('scrolling');
      expect(tree).toBeDefined();
      expect(tree?.id).toBe('scrolling_analysis_v1');
    });
  });

  describe('config', () => {
    it('should have correct configuration', () => {
      expect(expert.config.id).toBe('interaction_expert');
      expect(expert.config.domain).toBe('interaction');
      expect(expert.config.handlesIntents).toContain('SCROLLING');
      expect(expert.config.handlesIntents).toContain('CLICK');
      expect(expert.config.availableSkills).toContain('scrolling_analysis');
    });
  });
});

describe('LaunchExpert', () => {
  let expert: LaunchExpert;

  beforeEach(() => {
    expert = createLaunchExpert();
  });

  describe('canHandle', () => {
    it('should handle LAUNCH intent', () => {
      const intent: AnalysisIntent = {
        category: 'LAUNCH',
        originalQuery: '启动慢',
        keywords: ['启动'],
        confidence: 0.9,
      };
      expect(expert.canHandle(intent)).toBe(true);
    });

    it('should not handle SCROLLING intent', () => {
      const intent: AnalysisIntent = {
        category: 'SCROLLING',
        originalQuery: '滑动卡顿',
        keywords: ['滑动'],
        confidence: 0.9,
      };
      expect(expert.canHandle(intent)).toBe(false);
    });
  });

  describe('getDecisionTree', () => {
    it('should return launch decision tree', () => {
      const tree = expert.getDecisionTree('launch');
      expect(tree).toBeDefined();
      expect(tree?.id).toBe('launch_analysis_v1');
    });
  });

  describe('config', () => {
    it('should have correct configuration', () => {
      expect(expert.config.id).toBe('launch_expert');
      expect(expert.config.domain).toBe('launch');
      expect(expert.config.handlesIntents).toContain('LAUNCH');
      expect(expert.config.availableSkills).toContain('startup_analysis');
    });
  });
});

describe('SystemExpert', () => {
  let expert: SystemExpert;

  beforeEach(() => {
    expert = createSystemExpert();
  });

  describe('canHandle', () => {
    it('should handle CPU intent', () => {
      const intent: AnalysisIntent = {
        category: 'CPU',
        originalQuery: 'CPU 高',
        keywords: ['CPU'],
        confidence: 0.8,
      };
      expect(expert.canHandle(intent)).toBe(true);
    });

    it('should handle MEMORY intent', () => {
      const intent: AnalysisIntent = {
        category: 'MEMORY',
        originalQuery: '内存问题',
        keywords: ['内存'],
        confidence: 0.7,
      };
      expect(expert.canHandle(intent)).toBe(true);
    });

    it('should handle IO intent', () => {
      const intent: AnalysisIntent = {
        category: 'IO',
        originalQuery: 'IO 阻塞',
        keywords: ['IO'],
        confidence: 0.8,
      };
      expect(expert.canHandle(intent)).toBe(true);
    });

    it('should handle ANR intent', () => {
      const intent: AnalysisIntent = {
        category: 'ANR',
        originalQuery: 'ANR 分析',
        keywords: ['ANR'],
        confidence: 0.9,
      };
      expect(expert.canHandle(intent)).toBe(true);
    });

    it('should not handle SCROLLING intent', () => {
      const intent: AnalysisIntent = {
        category: 'SCROLLING',
        originalQuery: '滑动卡顿',
        keywords: ['滑动'],
        confidence: 0.9,
      };
      expect(expert.canHandle(intent)).toBe(false);
    });
  });

  describe('config', () => {
    it('should have correct configuration', () => {
      expect(expert.config.id).toBe('system_expert');
      expect(expert.config.domain).toBe('system');
      expect(expert.config.handlesIntents).toContain('CPU');
      expect(expert.config.handlesIntents).toContain('MEMORY');
      expect(expert.config.handlesIntents).toContain('IO');
      expect(expert.config.handlesIntents).toContain('ANR');
      expect(expert.config.availableSkills).toContain('cpu_analysis');
      expect(expert.config.availableSkills).toContain('memory_analysis');
    });
  });
});

describe('Expert Analysis Flow', () => {
  it('should have initial state as null', () => {
    const expert = createInteractionExpert();
    expect(expert.getState()).toBeNull();
  });

  // Note: Full analysis tests require mock traceProcessorService
  // which should be added in integration tests
});
