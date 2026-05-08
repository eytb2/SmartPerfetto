# Enterprise Multi-Tenant Baseline

## 2026-05-08

Branch: `feature/enterprise-multi-tenant`

Baseline commands:

| Command | Result | Elapsed |
| --- | --- | ---: |
| `cd backend && npm run typecheck` | PASS | 2.97s |
| `cd backend && npm run test:scene-trace-regression` | PASS, 6/6 canonical traces | 11.75s |

Scene trace regression evidence:

- PASS `lacunh_heavy.pftrace`
- PASS `launch_light.pftrace`
- PASS `scroll_Standard-AOSP-App-Without-PreAnimation.pftrace`
- PASS `scroll-demo-customer-scroll.pftrace`
- PASS `Scroll-Flutter-327-TextureView.pftrace`
- PASS `Scroll-Flutter-SurfaceView-Wechat-Wenyiwen.pftrace`

Notes:

- `README-review.md` and `appendix-ha.md` were re-read during handoff.
- v1 scope remains single-node or small-node enterprise deployment; Redis,
  NATS, Vault, Postgres HA, independent API Gateway, and independent SSE Gateway
  stay out of the mainline implementation.

## 2026-05-08 RSS Benchmark Harness Smoke

Branch: `feature/enterprise-multi-tenant-rss-benchmark`

Command:

```bash
PATH="$HOME/.nvm/versions/node/v24.15.0/bin:$PATH" \
  TP_PORT_MIN=9820 TP_PORT_MAX=9849 \
  npm run benchmark:trace-rss -- \
  --output test-output/trace-processor-rss-benchmark-smoke.json \
  --markdown test-output/trace-processor-rss-benchmark-smoke.md
```

Result: PASS for the benchmark harness and local smoke traces, but §0.4.3
coverage remains incomplete because no local trace reached the required 100MB,
500MB, or 1GB buckets.

| Trace | Scene | Size bucket | Init | Load peak | Query peak | Query delta | Status |
| --- | --- | --- | ---: | ---: | ---: | ---: | --- |
| `lacunh_heavy.pftrace` | startup | under-100MB | 834ms | 176.3 MiB | 185.0 MiB | 8.6 MiB | PASS |
| `launch_light.pftrace` | startup | under-100MB | 660ms | 89.2 MiB | 92.1 MiB | 2.8 MiB | PASS |
| `scroll_Standard-AOSP-App-Without-PreAnimation.pftrace` | scroll | under-100MB | 623ms | 85.5 MiB | 89.8 MiB | 4.0 MiB | PASS |
| `scroll-demo-customer-scroll.pftrace` | scroll | under-100MB | 722ms | 144.8 MiB | 154.1 MiB | 9.0 MiB | PASS |
| `Scroll-Flutter-327-TextureView.pftrace` | scroll | under-100MB | 634ms | 99.8 MiB | 105.4 MiB | 5.6 MiB | PASS |
| `Scroll-Flutter-SurfaceView-Wechat-Wenyiwen.pftrace` | scroll | under-100MB | 700ms | 129.5 MiB | 135.4 MiB | 5.6 MiB | PASS |

Missing §0.4.3 required matrix cells:

- scroll: 100MB, 500MB, 1GB
- startup: 100MB, 500MB, 1GB
- ANR: 100MB, 500MB, 1GB
- memory: 100MB, 500MB, 1GB
- heapprofd: 100MB, 500MB, 1GB
- vendor: 100MB, 500MB, 1GB
