/**
 * SmartPerfetto Configurable Thresholds
 *
 * This module defines configurable thresholds for performance analysis.
 * These values were previously hardcoded throughout the codebase but are
 * now centralized here for:
 * - Easy customization per device/scenario
 * - Clear documentation of threshold semantics
 * - Future extensibility (e.g., device profiles)
 *
 * @module config/thresholds
 */

// =============================================================================
// Jank Detection Thresholds
// =============================================================================

/**
 * Thresholds for classifying jank severity based on rate and count.
 *
 * These are used by FrameAgent and other components to determine
 * whether a jank issue is critical, warning, or informational.
 */
export interface JankSeverityThresholds {
  /** Jank rate (%) above which severity is 'critical' */
  criticalRate: number;
  /** Jank count above which severity is 'critical' */
  criticalCount: number;
  /** Jank rate (%) above which severity is 'warning' */
  warningRate: number;
  /** Jank count above which severity is 'warning' */
  warningCount: number;
}

/**
 * Default jank severity thresholds.
 *
 * Rationale:
 * - criticalRate (15%): 1 in 7 frames is janky - very noticeable to users
 * - criticalCount (30): ~0.5s of jank in a typical scroll session
 * - warningRate (5%): 1 in 20 frames - perceptible to sensitive users
 * - warningCount (10): ~0.17s of jank - worth investigating
 */
export const DEFAULT_JANK_THRESHOLDS: JankSeverityThresholds = {
  criticalRate: 15,
  criticalCount: 30,
  warningRate: 5,
  warningCount: 10,
};

// =============================================================================
// VSync Period Configuration
// =============================================================================

/**
 * Standard refresh rate to VSync period mapping (in nanoseconds).
 *
 * This is used when VSync period cannot be detected from the trace
 * and must be estimated from device configuration.
 */
export const VSYNC_PERIODS_NS: Record<number, bigint> = {
  60: 16666667n,   // 16.67ms
  90: 11111111n,   // 11.11ms
  120: 8333333n,   // 8.33ms
  144: 6944444n,   // 6.94ms
  165: 6060606n,   // 6.06ms
  240: 4166667n,   // 4.17ms
};

/**
 * Default VSync period when refresh rate is unknown.
 * Uses 60Hz as the conservative default for most devices.
 */
export const DEFAULT_VSYNC_PERIOD_NS = VSYNC_PERIODS_NS[60];

/**
 * Number of VSync periods to use when estimating frame end time
 * from start time (when end_ts and dur_ms are both unavailable).
 *
 * Value of 2 accounts for:
 * - 1 vsync for the frame itself
 * - 1 vsync buffer for display latency
 */
export const DEFAULT_VSYNC_PERIODS_FOR_FRAME_ESTIMATION = 2;

/**
 * Infer VSync period from trace context or use default.
 *
 * Resolution order:
 * 1. Detected VSync period from trace (vsync_period_ns)
 * 2. Device refresh rate config (device_refresh_rate)
 * 3. Default 60Hz
 *
 * @param traceContext - Context containing detected trace properties
 * @returns VSync period in nanoseconds as BigInt
 */
export function inferVsyncPeriodNs(traceContext?: {
  detectedVsyncPeriodNs?: string | bigint | number;
  deviceRefreshRate?: number;
}): bigint {
  // Try detected value first
  if (traceContext?.detectedVsyncPeriodNs) {
    try {
      const detected = BigInt(traceContext.detectedVsyncPeriodNs);
      if (detected > 0n) return detected;
    } catch {
      // Fall through to next option
    }
  }

  // Try device refresh rate
  if (traceContext?.deviceRefreshRate) {
    const rate = traceContext.deviceRefreshRate;
    if (VSYNC_PERIODS_NS[rate]) {
      return VSYNC_PERIODS_NS[rate];
    }
    // Calculate for non-standard refresh rates
    if (rate > 0 && rate <= 500) {
      return BigInt(Math.round(1_000_000_000 / rate));
    }
  }

  // Default to 60Hz
  return DEFAULT_VSYNC_PERIOD_NS;
}

// =============================================================================
// Circuit Breaker Thresholds
// =============================================================================

/**
 * Circuit breaker configuration for user intervention handling.
 */
export interface CircuitBreakerThresholds {
  /** Max times user can force-close per session */
  maxForceCloseCount: number;
  /** Cooldown period between force-closes (ms) */
  forceCloseCooldownMs: number;
  /** Timeout waiting for user response (ms) */
  userResponseTimeoutMs: number;
  /** Number of successes needed to transition HALF_OPEN → CLOSED */
  halfOpenSuccessThreshold: number;
}

/**
 * Default circuit breaker thresholds.
 */
export const DEFAULT_CIRCUIT_BREAKER_THRESHOLDS: CircuitBreakerThresholds = {
  maxForceCloseCount: 5,
  forceCloseCooldownMs: 30_000, // 30 seconds
  userResponseTimeoutMs: 5 * 60 * 1000, // 5 minutes
  halfOpenSuccessThreshold: 3,
};

// =============================================================================
// Execution Concurrency
// =============================================================================

/**
 * Default concurrency limit for DirectSkillExecutor.
 *
 * This limits how many skills can execute in parallel to avoid
 * overwhelming trace_processor_shell with concurrent queries.
 */
export const DEFAULT_DIRECT_SKILL_CONCURRENCY = 6;

// =============================================================================
// Analysis Depth Limits
// =============================================================================

/**
 * Maximum number of frames to analyze per session in deep analysis.
 *
 * This prevents runaway analysis on traces with many jank frames.
 * Can be overridden via skill parameters.
 */
export const DEFAULT_MAX_FRAMES_PER_SESSION = 8;

/**
 * Maximum number of sessions to analyze in overview stage.
 *
 * This limits the scope of analysis for very long traces.
 */
export const DEFAULT_MAX_SESSIONS_TO_ANALYZE = 10;

// =============================================================================
// Jank List Severity (for UI display)
// =============================================================================

/**
 * Threshold for jank list to be classified as 'critical' severity.
 *
 * When the number of detected jank frames exceeds this, the finding
 * is reported as critical severity in the UI.
 */
export const JANK_LIST_CRITICAL_THRESHOLD = 20;

// =============================================================================
// Confidence Thresholds
// =============================================================================

/**
 * Minimum confidence required to accept analysis results without
 * triggering additional rounds of investigation.
 */
export const DEFAULT_CONFIDENCE_THRESHOLD = 0.7;

/**
 * Confidence assigned to findings extracted from raw SQL results
 * (as opposed to AI-generated conclusions).
 */
export const DEFAULT_RAW_FINDING_CONFIDENCE = 0.75;

// =============================================================================
// Frame Time UI Thresholds (for display coloring)
// =============================================================================

/**
 * Frame time thresholds for UI display (warning/critical coloring).
 *
 * These are derived from VSync periods:
 * - warningMs: 1 VSync period (16.67ms at 60Hz)
 * - criticalMs: 2 VSync periods (33.33ms at 60Hz)
 * - maxCriticalMs: ~6 VSync periods (100ms - severe jank)
 */
export interface FrameTimeDisplayThresholds {
  /** Average frame time warning threshold (ms) */
  avgWarningMs: number;
  /** Average frame time critical threshold (ms) */
  avgCriticalMs: number;
  /** Max frame time warning threshold (ms) */
  maxWarningMs: number;
  /** Max frame time critical threshold (ms) */
  maxCriticalMs: number;
}

/**
 * Default frame time display thresholds (60Hz assumptions).
 */
export const DEFAULT_FRAME_TIME_DISPLAY_THRESHOLDS: FrameTimeDisplayThresholds = {
  avgWarningMs: 16.67,   // 1 VSync (60Hz)
  avgCriticalMs: 33.33,  // 2 VSyncs (60Hz)
  maxWarningMs: 33.33,   // 2 VSyncs (60Hz)
  maxCriticalMs: 100,    // ~6 VSyncs (severe)
};

/**
 * Generate frame time thresholds for a specific refresh rate.
 *
 * @param hz - Refresh rate in Hz (must be > 0 and <= 500)
 * @returns Thresholds for the given refresh rate, or default 60Hz thresholds for invalid input
 */
export function getFrameTimeThresholdsForHz(hz: number): FrameTimeDisplayThresholds {
  // Guard against invalid refresh rates
  if (!hz || hz <= 0 || hz > 500 || !Number.isFinite(hz)) {
    return DEFAULT_FRAME_TIME_DISPLAY_THRESHOLDS;
  }

  const vsyncMs = 1000 / hz;
  return {
    avgWarningMs: vsyncMs,
    avgCriticalMs: vsyncMs * 2,
    maxWarningMs: vsyncMs * 2,
    maxCriticalMs: 100, // Absolute max, not scaled
  };
}

// =============================================================================
// SQL Query VSync Threshold (nanoseconds)
// =============================================================================

/**
 * VSync period in nanoseconds for SQL queries.
 * Used as a constant in SQL WHERE clauses for jank detection.
 *
 * Note: We use 16666666 (rounded down from 16666667) for two reasons:
 * 1. Many existing SQL queries in the codebase use this value
 * 2. Slightly lower threshold is more conservative (catches edge cases)
 *
 * The 1ns difference (0.000001ms) is negligible in practice.
 */
export const SQL_VSYNC_THRESHOLD_NS = 16666666;

/**
 * Double VSync period for jank detection in SQL.
 * Missing 2+ VSyncs is typically considered jank.
 */
export const SQL_JANK_THRESHOLD_NS = SQL_VSYNC_THRESHOLD_NS * 2;

// =============================================================================
// Export All Defaults for Easy Access
// =============================================================================

export const ANALYSIS_THRESHOLDS = {
  jank: DEFAULT_JANK_THRESHOLDS,
  circuitBreaker: DEFAULT_CIRCUIT_BREAKER_THRESHOLDS,
  vsync: {
    periods: VSYNC_PERIODS_NS,
    default: DEFAULT_VSYNC_PERIOD_NS,
    framesForEstimation: DEFAULT_VSYNC_PERIODS_FOR_FRAME_ESTIMATION,
  },
  execution: {
    directSkillConcurrency: DEFAULT_DIRECT_SKILL_CONCURRENCY,
    maxFramesPerSession: DEFAULT_MAX_FRAMES_PER_SESSION,
    maxSessionsToAnalyze: DEFAULT_MAX_SESSIONS_TO_ANALYZE,
  },
  confidence: {
    threshold: DEFAULT_CONFIDENCE_THRESHOLD,
    rawFinding: DEFAULT_RAW_FINDING_CONFIDENCE,
  },
  ui: {
    jankListCriticalThreshold: JANK_LIST_CRITICAL_THRESHOLD,
    frameTimeDisplay: DEFAULT_FRAME_TIME_DISPLAY_THRESHOLDS,
  },
  sql: {
    vsyncThresholdNs: SQL_VSYNC_THRESHOLD_NS,
    jankThresholdNs: SQL_JANK_THRESHOLD_NS,
  },
};
