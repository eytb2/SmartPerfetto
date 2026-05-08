# Enterprise PR Gate And Regression Evidence

Date: 2026-05-09

This document records the evidence for `README.md` §0.6.10 and §0.6.11.

## Local Gate

Current checkout:

- Branch: `feature/enterprise-multi-tenant-f6-sse-matrix`
- Head: `b96b8218 test(enterprise): tolerate uninitialized perfetto evidence`
- Command: `PATH="$HOME/.nvm/versions/node/v24.15.0/bin:$PATH" npm run verify:pr`
- Result: PASS

The local PR gate covered:

- root quality checks
- Rust formatting/check/tests
- backend Skill and Strategy validation
- backend typecheck and build
- CLI package check
- `cd backend && npm run test:core`
- trace processor availability
- `cd backend && npm run test:scene-trace-regression`

Scene trace regression passed for all 6 traces:

- `lacunh_heavy.pftrace`
- `launch_light.pftrace`
- `scroll_Standard-AOSP-App-Without-PreAnimation.pftrace`
- `scroll-demo-customer-scroll.pftrace`
- `Scroll-Flutter-327-TextureView.pftrace`
- `Scroll-Flutter-SurfaceView-Wechat-Wenyiwen.pftrace`

## GitHub PR Gates

All current §0.6 coverage-matrix stack PRs are green in GitHub Actions.

| PR | Branch | Head | GitHub run | quality | gate | docker-smoke | Merge state |
| --- | --- | --- | --- | --- | --- | --- | --- |
| #124 | `feature/enterprise-multi-tenant-f6-security-matrix` | `a357e156` | `25578661742` | SUCCESS | SUCCESS | SUCCESS | CLEAN |
| #125 | `feature/enterprise-multi-tenant-f6-runtime-matrix` | `9d531df6` | `25578521511` | SUCCESS | SUCCESS | SUCCESS | CLEAN |
| #126 | `feature/enterprise-multi-tenant-f6-persistence-matrix` | `5d231707` | `25578507327` | SUCCESS | SUCCESS | SUCCESS | CLEAN |
| #127 | `feature/enterprise-multi-tenant-f6-sse-matrix` | `b96b8218` | `25578491245` | SUCCESS | SUCCESS | SUCCESS | CLEAN |

Verification query:

```bash
gh pr view 124 --json number,headRefName,baseRefName,headRefOid,mergeStateStatus,statusCheckRollup
gh pr view 125 --json number,headRefName,baseRefName,headRefOid,mergeStateStatus,statusCheckRollup
gh pr view 126 --json number,headRefName,baseRefName,headRefOid,mergeStateStatus,statusCheckRollup
gh pr view 127 --json number,headRefName,baseRefName,headRefOid,mergeStateStatus,statusCheckRollup
```

## CI Repairs Captured In This Evidence

Two gate-only stability issues were fixed before marking §0.6.10 and §0.6.11 complete:

- `enterpriseRuntimeIsolationChecklist.test.ts` no longer assumes GitHub backend gate has checked out the heavy `perfetto/` submodule. Root-repo evidence remains strict; `perfetto/` evidence verifies content when the submodule is present and verifies the root gitlink when it is not.
- `analysisPatternMemory.test.ts` no longer assumes scoped pattern persistence order. It verifies tenant provenance by `sourceTenantId` and keeps the scope-filtering assertions unchanged.
