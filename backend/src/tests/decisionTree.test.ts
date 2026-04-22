// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

/**
 * Decision Tree Tests
 *
 * Unit tests for the decision tree execution system.
 * Tests cover:
 * - DecisionTreeExecutor basic execution
 * - Scrolling analysis decision tree
 * - Launch analysis decision tree
 * - Branch evaluation and node traversal
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

import {
  DecisionTreeExecutor,
  SkillExecutorInterface,
  DecisionTree,
  DecisionContext,
  DecisionTreeExecutionResult,
  scrollingDecisionTree,
  launchDecisionTree,
  getDecisionTree,
  listDecisionTrees,
} from '../agent/decision';

/**
 * Mock Skill Executor for testing
 */
class MockSkillExecutor implements SkillExecutorInterface {
  private mockResults: Map<string, any> = new Map();

  /**
   * Set mock result for a skill
   */
  setMockResult(skillId: string, result: any): void {
    this.mockResults.set(skillId, result);
  }

  /**
   * Execute skill (return mock result)
   */
  async execute(
    skillId: string,
    _params: Record<string, any>,
    _context: DecisionContext
  ): Promise<any> {
    const result = this.mockResults.get(skillId);
    if (result !== undefined) {
      return result;
    }
    throw new Error(`No mock result for skill: ${skillId}`);
  }
}

/**
 * Create a minimal decision context for testing
 */
function createTestContext(overrides?: Partial<DecisionContext>): DecisionContext {
  return {
    sessionId: 'test-session',
    traceId: 'test-trace',
    traceProcessorService: {} as any,
    previousResults: new Map(),
    ...overrides,
  };
}

describe('DecisionTreeExecutor', () => {
  let mockExecutor: MockSkillExecutor;
  let treeExecutor: DecisionTreeExecutor;
  let testContext: DecisionContext;

  beforeEach(() => {
    mockExecutor = new MockSkillExecutor();
    treeExecutor = new DecisionTreeExecutor(mockExecutor, { verbose: false });
    testContext = createTestContext();
  });

  describe('Basic Execution', () => {
    it('should execute a simple tree with single conclusion', async () => {
      // Create a simple tree with one action and one conclusion
      const simpleTree: DecisionTree = {
        id: 'simple_test',
        name: 'Simple Test Tree',
        description: 'A simple test tree',
        analysisType: 'general',
        entryNode: 'get_data',
        nodes: [
          {
            id: 'get_data',
            type: 'ACTION',
            name: 'Get Data',
            action: {
              description: 'Get test data',
              skill: 'test_skill',
              params: {},
              resultKey: 'test_data',
            },
            next: { default: 'conclude' },
          },
          {
            id: 'conclude',
            type: 'CONCLUDE',
            name: 'Conclusion',
            conclusion: {
              category: 'UNKNOWN',
              component: 'UNKNOWN',
              summaryTemplate: 'Test completed successfully',
              confidence: 1.0,
            },
          },
        ],
      };

      mockExecutor.setMockResult('test_skill', { value: 42 });

      const result = await treeExecutor.execute(simpleTree, testContext);

      expect(result.success).toBe(true);
      expect(result.executionPath).toEqual(['get_data', 'conclude']);
      expect(result.conclusion).toBeDefined();
      expect(result.conclusion?.summaryTemplate).toBe('Test completed successfully');
    });

    it('should handle CHECK node with true condition', async () => {
      const treeWithCheck: DecisionTree = {
        id: 'check_test',
        name: 'Check Test Tree',
        description: 'Test CHECK node',
        analysisType: 'general',
        entryNode: 'get_data',
        nodes: [
          {
            id: 'get_data',
            type: 'ACTION',
            name: 'Get Data',
            action: {
              description: 'Get test data',
              skill: 'test_skill',
              params: {},
              resultKey: 'test_data',
            },
            next: { default: 'check_value' },
          },
          {
            id: 'check_value',
            type: 'CHECK',
            name: 'Check Value',
            check: {
              description: 'Is value > 50?',
              useResultFrom: 'test_data',
              evaluate: (data) => data.value > 50,
            },
            next: {
              true: 'conclude_high',
              false: 'conclude_low',
            },
          },
          {
            id: 'conclude_high',
            type: 'CONCLUDE',
            name: 'High Value',
            conclusion: {
              category: 'APP',
              component: 'UNKNOWN',
              summaryTemplate: 'Value is high',
              confidence: 0.9,
            },
          },
          {
            id: 'conclude_low',
            type: 'CONCLUDE',
            name: 'Low Value',
            conclusion: {
              category: 'APP',
              component: 'UNKNOWN',
              summaryTemplate: 'Value is low',
              confidence: 0.9,
            },
          },
        ],
      };

      mockExecutor.setMockResult('test_skill', { value: 75 });

      const result = await treeExecutor.execute(treeWithCheck, testContext);

      expect(result.success).toBe(true);
      expect(result.executionPath).toContain('conclude_high');
      expect(result.conclusion?.summaryTemplate).toBe('Value is high');
    });

    it('should handle CHECK node with false condition', async () => {
      const treeWithCheck: DecisionTree = {
        id: 'check_test',
        name: 'Check Test Tree',
        description: 'Test CHECK node',
        analysisType: 'general',
        entryNode: 'get_data',
        nodes: [
          {
            id: 'get_data',
            type: 'ACTION',
            name: 'Get Data',
            action: {
              description: 'Get test data',
              skill: 'test_skill',
              params: {},
              resultKey: 'test_data',
            },
            next: { default: 'check_value' },
          },
          {
            id: 'check_value',
            type: 'CHECK',
            name: 'Check Value',
            check: {
              description: 'Is value > 50?',
              useResultFrom: 'test_data',
              evaluate: (data) => data.value > 50,
            },
            next: {
              true: 'conclude_high',
              false: 'conclude_low',
            },
          },
          {
            id: 'conclude_high',
            type: 'CONCLUDE',
            name: 'High Value',
            conclusion: {
              category: 'APP',
              component: 'UNKNOWN',
              summaryTemplate: 'Value is high',
              confidence: 0.9,
            },
          },
          {
            id: 'conclude_low',
            type: 'CONCLUDE',
            name: 'Low Value',
            conclusion: {
              category: 'APP',
              component: 'UNKNOWN',
              summaryTemplate: 'Value is low',
              confidence: 0.9,
            },
          },
        ],
      };

      mockExecutor.setMockResult('test_skill', { value: 25 });

      const result = await treeExecutor.execute(treeWithCheck, testContext);

      expect(result.success).toBe(true);
      expect(result.executionPath).toContain('conclude_low');
      expect(result.conclusion?.summaryTemplate).toBe('Value is low');
    });

    it('should handle BRANCH node with multiple conditions', async () => {
      const treeWithBranch: DecisionTree = {
        id: 'branch_test',
        name: 'Branch Test Tree',
        description: 'Test BRANCH node',
        analysisType: 'general',
        entryNode: 'get_data',
        nodes: [
          {
            id: 'get_data',
            type: 'ACTION',
            name: 'Get Data',
            action: {
              description: 'Get test data',
              skill: 'test_skill',
              params: {},
              resultKey: 'test_data',
            },
            next: { default: 'branch_on_type' },
          },
          {
            id: 'branch_on_type',
            type: 'BRANCH',
            name: 'Branch on Type',
            branches: [
              {
                condition: {
                  description: 'Is type A?',
                  useResultFrom: 'test_data',
                  evaluate: (data) => data.type === 'A',
                },
                next: 'conclude_a',
              },
              {
                condition: {
                  description: 'Is type B?',
                  useResultFrom: 'test_data',
                  evaluate: (data) => data.type === 'B',
                },
                next: 'conclude_b',
              },
            ],
            next: { default: 'conclude_other' },
          },
          {
            id: 'conclude_a',
            type: 'CONCLUDE',
            name: 'Type A',
            conclusion: {
              category: 'APP',
              component: 'MAIN_THREAD',
              summaryTemplate: 'Detected type A',
              confidence: 0.9,
            },
          },
          {
            id: 'conclude_b',
            type: 'CONCLUDE',
            name: 'Type B',
            conclusion: {
              category: 'APP',
              component: 'RENDER_THREAD',
              summaryTemplate: 'Detected type B',
              confidence: 0.9,
            },
          },
          {
            id: 'conclude_other',
            type: 'CONCLUDE',
            name: 'Other Type',
            conclusion: {
              category: 'UNKNOWN',
              component: 'UNKNOWN',
              summaryTemplate: 'Unknown type',
              confidence: 0.5,
            },
          },
        ],
      };

      // Test type B
      mockExecutor.setMockResult('test_skill', { type: 'B' });

      const result = await treeExecutor.execute(treeWithBranch, testContext);

      expect(result.success).toBe(true);
      expect(result.executionPath).toContain('conclude_b');
      expect(result.conclusion?.component).toBe('RENDER_THREAD');
    });

    it('should use default branch when no conditions match', async () => {
      const treeWithBranch: DecisionTree = {
        id: 'branch_test',
        name: 'Branch Test Tree',
        description: 'Test BRANCH default',
        analysisType: 'general',
        entryNode: 'get_data',
        nodes: [
          {
            id: 'get_data',
            type: 'ACTION',
            name: 'Get Data',
            action: {
              description: 'Get test data',
              skill: 'test_skill',
              params: {},
              resultKey: 'test_data',
            },
            next: { default: 'branch_on_type' },
          },
          {
            id: 'branch_on_type',
            type: 'BRANCH',
            name: 'Branch on Type',
            branches: [
              {
                condition: {
                  description: 'Is type A?',
                  useResultFrom: 'test_data',
                  evaluate: (data) => data.type === 'A',
                },
                next: 'conclude_a',
              },
            ],
            next: { default: 'conclude_other' },
          },
          {
            id: 'conclude_a',
            type: 'CONCLUDE',
            name: 'Type A',
            conclusion: {
              category: 'APP',
              component: 'MAIN_THREAD',
              summaryTemplate: 'Detected type A',
              confidence: 0.9,
            },
          },
          {
            id: 'conclude_other',
            type: 'CONCLUDE',
            name: 'Other Type',
            conclusion: {
              category: 'UNKNOWN',
              component: 'UNKNOWN',
              summaryTemplate: 'Unknown type',
              confidence: 0.5,
            },
          },
        ],
      };

      mockExecutor.setMockResult('test_skill', { type: 'C' });

      const result = await treeExecutor.execute(treeWithBranch, testContext);

      expect(result.success).toBe(true);
      expect(result.executionPath).toContain('conclude_other');
    });

    it('should prevent infinite loops with maxNodes', async () => {
      const infiniteTree: DecisionTree = {
        id: 'infinite_test',
        name: 'Infinite Test Tree',
        description: 'Test max nodes protection',
        analysisType: 'general',
        entryNode: 'node_a',
        nodes: [
          {
            id: 'node_a',
            type: 'CHECK',
            name: 'Node A',
            check: {
              description: 'Always true',
              useResultFrom: 'test_data',
              evaluate: () => true,
            },
            next: { true: 'node_b', false: 'conclude' },
          },
          {
            id: 'node_b',
            type: 'CHECK',
            name: 'Node B',
            check: {
              description: 'Always true',
              useResultFrom: 'test_data',
              evaluate: () => true,
            },
            next: { true: 'node_a', false: 'conclude' },
          },
          {
            id: 'conclude',
            type: 'CONCLUDE',
            name: 'Conclusion',
            conclusion: {
              category: 'UNKNOWN',
              component: 'UNKNOWN',
              summaryTemplate: 'Done',
              confidence: 1.0,
            },
          },
        ],
      };

      const limitedExecutor = new DecisionTreeExecutor(mockExecutor, {
        verbose: false,
        maxNodes: 10,
      });

      const result = await limitedExecutor.execute(infiniteTree, testContext);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Max nodes');
      expect(result.executionPath.length).toBe(10);
    });
  });
});

describe('Decision Tree Registry', () => {
  it('should list available trees', () => {
    const trees = listDecisionTrees();

    expect(trees).toContain('scrolling');
    expect(trees).toContain('launch');
  });

  it('should get tree by type', () => {
    const scrollTree = getDecisionTree('scrolling');
    const launchTree = getDecisionTree('launch');

    expect(scrollTree).toBeDefined();
    expect(scrollTree?.id).toBe('scrolling_analysis_v1');

    expect(launchTree).toBeDefined();
    expect(launchTree?.id).toBe('launch_analysis_v1');
  });

  it('should return undefined for unknown tree', () => {
    const unknownTree = getDecisionTree('unknown');

    expect(unknownTree).toBeUndefined();
  });
});

describe('Scrolling Decision Tree', () => {
  let mockExecutor: MockSkillExecutor;
  let treeExecutor: DecisionTreeExecutor;
  let testContext: DecisionContext;

  beforeEach(() => {
    mockExecutor = new MockSkillExecutor();
    treeExecutor = new DecisionTreeExecutor(mockExecutor, { verbose: false });
    testContext = createTestContext();
  });

  it('should have valid structure', () => {
    expect(scrollingDecisionTree.id).toBe('scrolling_analysis_v1');
    expect(scrollingDecisionTree.analysisType).toBe('scrolling');
    expect(scrollingDecisionTree.entryNode).toBe('get_fps_overview');
    expect(scrollingDecisionTree.nodes.length).toBeGreaterThan(10);
  });

  it('should conclude no problem when FPS is good', async () => {
    // Mock high FPS data - use format that helper functions expect
    mockExecutor.setMockResult('scrolling_analysis', {
      avg_fps: 59.5,
      min_fps: 55,
      janky_frame_count: 20,
      total_frame_count: 1000,
      jank_rate: 0.02, // 2% jank rate, below 5% threshold
    });

    const result = await treeExecutor.execute(scrollingDecisionTree, testContext);

    expect(result.success).toBe(true);
    expect(result.conclusion).toBeDefined();
    // Should conclude with no problem
    expect(result.executionPath).toContain('conclude_no_problem');
  });

  it('should detect low FPS problem and analyze continuous low', async () => {
    // Mock low FPS data with continuous low pattern (small variance between avg and min)
    mockExecutor.setMockResult('scrolling_analysis', {
      avg_fps: 35,
      min_fps: 25, // variance = 10 < 15, continuous low pattern
      janky_frame_count: 200,
      total_frame_count: 1000,
      jank_rate: 0.20, // 20% jank rate
    });

    // Mock SF analysis result - SF has problem
    mockExecutor.setMockResult('surfaceflinger_analysis', {
      sf_avg_duration: 8, // > 4ms threshold, SF issue
    });

    const result = await treeExecutor.execute(scrollingDecisionTree, testContext);

    expect(result.success).toBe(true);
    // Should go through the problem analysis path
    expect(result.executionPath).toContain('check_has_problem');
    expect(result.executionPath).toContain('check_fps_pattern');
    expect(result.executionPath).toContain('analyze_continuous_low');
    // Should conclude SF issue since SF avg duration > 4ms
    expect(result.executionPath).toContain('conclude_sf_issue');
    expect(result.conclusion?.category).toBe('SYSTEM');
    expect(result.conclusion?.component).toBe('SURFACE_FLINGER');
  });
});

describe('Launch Decision Tree', () => {
  let mockExecutor: MockSkillExecutor;
  let treeExecutor: DecisionTreeExecutor;
  let testContext: DecisionContext;

  beforeEach(() => {
    mockExecutor = new MockSkillExecutor();
    treeExecutor = new DecisionTreeExecutor(mockExecutor, { verbose: false });
    testContext = createTestContext();
  });

  it('should have valid structure', () => {
    expect(launchDecisionTree.id).toBe('launch_analysis_v1');
    expect(launchDecisionTree.analysisType).toBe('launch');
    expect(launchDecisionTree.entryNode).toBe('get_launch_overview');
    expect(launchDecisionTree.nodes.length).toBeGreaterThan(10);
  });

  it('should conclude launch OK when TTID is fast', async () => {
    // Mock fast cold launch data
    mockExecutor.setMockResult('startup_analysis', {
      launch_type: 'cold',
      ttid: 800, // Under 1000ms threshold
      has_process_start: true,
    });

    const result = await treeExecutor.execute(launchDecisionTree, testContext);

    expect(result.success).toBe(true);
    expect(result.executionPath).toContain('conclude_launch_ok');
  });

  it('should detect slow cold launch and identify slowest phase', async () => {
    // Mock slow cold launch data with process_start as slowest
    mockExecutor.setMockResult('startup_analysis', {
      launch_type: 'cold',
      ttid: 2500,
      has_process_start: true,
      process_start_time: 1200, // Slowest
      application_init_time: 500,
      activity_create_time: 400,
      first_frame_time: 400,
      zygote_fork_time: 50, // Not too slow
    });

    const result = await treeExecutor.execute(launchDecisionTree, testContext);

    expect(result.success).toBe(true);
    expect(result.executionPath).toContain('find_slowest_phase');
    // Should analyze process start since it's the slowest
  });

  it('should detect warm launch problems', async () => {
    // Mock slow warm launch data
    mockExecutor.setMockResult('startup_analysis', {
      launch_type: 'warm',
      ttid: 800,
      has_activity_restart: true,
      warm_launch_time: 600, // Over 500ms threshold
    });

    const result = await treeExecutor.execute(launchDecisionTree, testContext);

    expect(result.success).toBe(true);
    expect(result.executionPath).toContain('analyze_warm_launch');
    expect(result.executionPath).toContain('conclude_warm_launch_slow');
  });

  it('should detect hot launch problems', async () => {
    // Mock slow hot launch data
    mockExecutor.setMockResult('startup_analysis', {
      launch_type: 'hot',
      ttid: 300,
      hot_launch_time: 250, // Over 200ms threshold
    });

    const result = await treeExecutor.execute(launchDecisionTree, testContext);

    expect(result.success).toBe(true);
    expect(result.executionPath).toContain('analyze_hot_launch');
    expect(result.executionPath).toContain('conclude_hot_launch_slow');
  });
});
