# Linux CPU Scheduling on Android

## Mechanism

Android uses **EAS (Energy Aware Scheduling)**, which places tasks on the most energy-efficient CPU core that can meet the task's performance requirements. The scheduler balances performance against power consumption.

### Core Topology

Modern Android SoCs use heterogeneous CPU clusters:

| Cluster | Cores | Characteristics |
|---------|-------|----------------|
| **Little** (efficiency) | 4 | Low frequency, low power, high efficiency |
| **Medium** (balanced) | 2-3 | Mid frequency, moderate power |
| **Big** (performance) | 1-2 | High frequency, high power |
| **Prime** (peak) | 1 | Highest frequency, highest power |

Higher-capacity cores run at higher frequencies and complete work faster, but consume more power and generate more heat.

### Why Small-Core Placement Hurts

When a latency-sensitive task (main thread, RenderThread) runs on a little core, it executes at a lower frequency. Work that takes 8ms on a big core might take 20ms on a little core, missing the frame deadline entirely. The scheduler may initially place the task on a little core because its load average appears low.

### Frequency Governor Latency

The CPU frequency governor adjusts core frequency based on load, but with a **10-30ms ramp-up delay**. A sudden burst of work (e.g., Choreographer#doFrame starting) runs at the previous low frequency for the first few milliseconds before the governor ramps up. This initial slow period can push the frame past its budget.

### uclamp (Utilization Clamping)

Android uses `uclamp.min` to hint the scheduler that certain threads need minimum performance. RenderThread and main thread typically get high uclamp values, requesting placement on faster cores. When uclamp is misconfigured or the system is under thermal constraints, these hints may be ignored.

## Trace Signatures

| What to Look For | Meaning |
|-----------------|---------|
| `sched_slice` table | Which CPU core ran each thread and for how long |
| `cpu_frequency_counters` | Actual CPU frequency over time |
| CPU ID in Q1/Q2 range (0-3 typically little) | Task running on efficiency cores |
| Scheduling latency (Runnable duration) | Time between Runnable and Running state |

**Scheduling latency thresholds**:
- < 2ms: Normal
- 2-5ms: Elevated (acceptable under load)
- 5-15ms: Concerning -- CPU contention or priority issue
- \> 15ms: Critical -- severe CPU starvation, likely thermal throttle or runaway process

## Typical Solutions

- Set appropriate thread priority: `SCHED_FIFO` or high nice value for critical rendering threads
- Reduce background thread count to avoid CPU contention
- Check thermal state: throttling forces tasks onto slower cores at lower frequencies
- Use `Process.setThreadPriority()` for worker threads to yield to UI threads
- Audit background services and jobs running during performance-critical operations
- Verify uclamp settings for RenderThread and main thread via `thread_state` table
