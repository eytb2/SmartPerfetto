/**
 * Scene Reconstruction Trace Regression
 *
 * Mandatory post-change regression suite for scene_reconstruction.
 *
 * Runs the skill on the canonical 6 trace files and checks:
 * 1) skill executes successfully;
 * 2) key extraction steps are present and successful;
 * 3) trace-specific minimum expectations remain true.
 */

import { createSkillEvaluator, getTestTracePath } from './runner';

type StepResultLike = {
  success?: boolean;
  error?: string;
  data?: any[];
};

type TraceCase = {
  file: string;
  label: string;
  minCounts?: Partial<Record<string, number>>;
  maxUnlockEvents?: number;
  minMaxDurationMs?: Partial<Record<string, number>>;
};

const TRACE_CASES: TraceCase[] = [
  {
    file: 'app_aosp_scrolling_heavy_jank.pftrace',
    label: '重度滑动卡顿',
    minCounts: {
      user_gestures: 1,
      inertial_scrolls: 1,
      jank_events: 1,
    },
    maxUnlockEvents: 0,
    minMaxDurationMs: {
      user_gestures: 2500,
      inertial_scrolls: 2500,
    },
  },
  {
    file: 'app_aosp_scrolling_light.pftrace',
    label: '轻度滑动',
    minCounts: {
      user_gestures: 1,
      inertial_scrolls: 1,
    },
    maxUnlockEvents: 0,
  },
  {
    file: 'app_scroll_Standard-AOSP-App-Without-PreAnimation.pftrace',
    label: '标准滑动',
    maxUnlockEvents: 0,
  },
  {
    file: 'app_start_heavy.pftrace',
    label: 'App 启动',
    minCounts: {
      app_launches: 1,
    },
    maxUnlockEvents: 0,
  },
  {
    file: 'Scroll-Flutter-327-TextureView.pftrace',
    label: 'Flutter TextureView 滑动',
    maxUnlockEvents: 0,
  },
  {
    file: 'Scroll-Flutter-SurfaceView-Wechat-Wenyiwen.pftrace',
    label: 'Flutter SurfaceView 滑动',
    maxUnlockEvents: 0,
  },
];

const REQUIRED_STEPS = [
  'user_gestures',
  'scroll_initiation',
  'inertial_scrolls',
  'idle_periods',
  'app_launches',
  'system_events',
  'jank_events',
] as const;

function findStep(layers: any, stepId: string): StepResultLike | null {
  if (layers?.overview?.[stepId]) return layers.overview[stepId];
  if (layers?.list?.[stepId]) return layers.list[stepId];

  for (const sessionData of Object.values(layers?.session || {})) {
    const step = (sessionData as any)?.[stepId];
    if (step) return step;
  }

  for (const sessionData of Object.values(layers?.deep || {})) {
    const step = (sessionData as any)?.[stepId];
    if (step) return step;
  }

  return null;
}

async function runCase(testCase: TraceCase): Promise<void> {
  const evaluator = createSkillEvaluator('scene_reconstruction');

  try {
    await evaluator.loadTrace(getTestTracePath(testCase.file));
    const result = await evaluator.executeSkill({ trace_id: `scene_regression_${testCase.file}` });

    if (!result.success) {
      throw new Error(`skill execution failed: ${result.error || 'unknown error'}`);
    }

    const counts: Record<string, number> = {};
    const maxDurationMs: Record<string, number> = {};
    let unlockEventCount = 0;

    for (const stepId of REQUIRED_STEPS) {
      const step = findStep(result.layers, stepId);
      if (!step) {
        throw new Error(`missing step result: ${stepId}`);
      }
      if (!step.success) {
        throw new Error(`step failed: ${stepId}, error=${step.error || 'unknown error'}`);
      }

      const count = Array.isArray(step.data) ? step.data.length : 0;
      counts[stepId] = count;
      maxDurationMs[stepId] = Array.isArray(step.data)
        ? step.data.reduce((max: number, row: any) => {
          const durNs = Number(row?.dur || 0);
          if (!Number.isFinite(durNs) || durNs <= 0) return max;
          const durMs = Math.floor(durNs / 1_000_000);
          return durMs > max ? durMs : max;
        }, 0)
        : 0;

      if (stepId === 'system_events') {
        unlockEventCount = Array.isArray(step.data)
          ? step.data.filter((row: any) => String(row?.event || '').includes('解锁')).length
          : 0;
      }
    }

    for (const [stepId, minCount] of Object.entries(testCase.minCounts || {})) {
      const actual = counts[stepId] ?? 0;
      if (actual < minCount) {
        throw new Error(`step ${stepId} count ${actual} < required ${minCount}`);
      }
    }

    if (typeof testCase.maxUnlockEvents === 'number' && unlockEventCount > testCase.maxUnlockEvents) {
      throw new Error(
        `system_events unlock count ${unlockEventCount} > max ${testCase.maxUnlockEvents}`
      );
    }

    for (const [stepId, minDurationMs] of Object.entries(testCase.minMaxDurationMs || {})) {
      const actual = maxDurationMs[stepId] ?? 0;
      if (actual < minDurationMs) {
        throw new Error(`step ${stepId} max duration ${actual}ms < required ${minDurationMs}ms`);
      }
    }

    console.log(
      `[PASS] ${testCase.label} (${testCase.file}) | ` +
      `gestures=${counts.user_gestures}, scroll_starts=${counts.scroll_initiation}, ` +
      `inertial=${counts.inertial_scrolls}, idle=${counts.idle_periods}, ` +
      `launches=${counts.app_launches}, sys=${counts.system_events}, ` +
      `unlock=${unlockEventCount}, janks=${counts.jank_events}`,
    );
  } finally {
    await evaluator.cleanup();
  }
}

async function main() {
  const failures: Array<{ trace: string; reason: string }> = [];

  for (const traceCase of TRACE_CASES) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await runCase(traceCase);
    } catch (error: any) {
      const reason = error?.message || String(error);
      failures.push({ trace: traceCase.file, reason });
      console.error(`[FAIL] ${traceCase.label} (${traceCase.file}) -> ${reason}`);
    }
  }

  if (failures.length > 0) {
    console.error('\nScene trace regression failed:');
    for (const f of failures) {
      console.error(`- ${f.trace}: ${f.reason}`);
    }
    process.exit(1);
  }

  console.log('\nScene trace regression passed for all 6 traces.');
}

main().catch((error) => {
  console.error('[scene_trace_regression] fatal:', error);
  process.exit(1);
});
