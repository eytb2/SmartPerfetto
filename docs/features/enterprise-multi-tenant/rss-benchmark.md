# §0.4.3 Trace Processor RSS Benchmark Runbook

## Goal

This runbook defines the evidence required before README §0.4.3 can be marked
complete. The benchmark must measure trace_processor_shell memory behavior for
large enterprise traces and feed the later §0.4.7 RAM budget / admission-control
work.

Required matrix:

| Scene | Required size buckets |
| --- | --- |
| scroll | 100MB, 500MB, 1GB |
| startup | 100MB, 500MB, 1GB |
| ANR | 100MB, 500MB, 1GB |
| memory | 100MB, 500MB, 1GB |
| heapprofd | 100MB, 500MB, 1GB |
| vendor | 100MB, 500MB, 1GB |

Each successful run records:

- startup RSS: first sampled child-process RSS after trace_processor_shell spawn
- load peak: maximum RSS observed before the processor is ready
- post-load RSS: RSS after initialization and before representative queries
- query peak: maximum RSS while the representative query set runs
- query incremental RSS: query peak minus post-load RSS
- query headroom: host total memory minus query peak

## Command

Run from `backend/` with Node 24:

```bash
PATH="$HOME/.nvm/versions/node/v24.15.0/bin:$PATH" \
  npm run benchmark:trace-rss -- \
  --manifest ../docs/features/enterprise-multi-tenant/rss-benchmark-manifest.local.json \
  --output test-output/trace-processor-rss-benchmark.json \
  --markdown test-output/trace-processor-rss-benchmark.md
```

The script also supports ad-hoc traces:

```bash
PATH="$HOME/.nvm/versions/node/v24.15.0/bin:$PATH" \
  npm run benchmark:trace-rss -- \
  --trace scroll=/path/to/scroll-500mb.pftrace \
  --trace startup=/path/to/startup-1gb.pftrace
```

Manifest shape:

```json
{
  "traces": [
    {
      "scene": "scroll",
      "label": "scroll-500mb-device-a",
      "path": "/absolute/or/manifest-relative/path.pftrace"
    }
  ]
}
```

The script classifies trace sizes from file size:

- `under-100MB`: below 100 MiB; useful for smoke only, does not satisfy §0.4.3
- `100MB`: at least 100 MiB and below 500 MiB
- `500MB`: at least 500 MiB and below 1 GiB
- `1GB`: at least 1 GiB

## Current Local Trace Audit

As of 2026-05-08, the repository checkout only has small local fixtures:

| Trace | Size | In §0.4.3 matrix |
| --- | ---: | --- |
| `test-traces/lacunh_heavy.pftrace` | 18 MiB | no, smoke only |
| `test-traces/scroll-demo-customer-scroll.pftrace` | 14 MiB | no, smoke only |
| `test-traces/Scroll-Flutter-SurfaceView-Wechat-Wenyiwen.pftrace` | 12 MiB | no, smoke only |
| `test-traces/launch_light.pftrace` | 10 MiB | no, smoke only |
| `test-traces/Scroll-Flutter-327-TextureView.pftrace` | 7 MiB | no, smoke only |
| `test-traces/scroll_Standard-AOSP-App-Without-PreAnimation.pftrace` | 6.3 MiB | no, smoke only |

These smoke traces can validate the benchmark harness, but they cannot complete
§0.4.3. Do not mark README §0.4.3 complete until the required 18 scene/size
cells above are covered by real benchmark output.
