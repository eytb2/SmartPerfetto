<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2024-2026 Gracker (Chris) | SmartPerfetto -->

# 07. Verification Matrix

## 通用 gate

所有非纯文档变更在合入前必须至少跑：

```bash
npm --prefix backend run build
git diff --check
```

准备合入或 push 前跑：

```bash
npm run verify:pr
```

## 功能包验证矩阵

| 功能包 | Focused test | 集成验证 | E2E |
|---|---|---|---|
| SQL guardrail | `npm --prefix backend run test -- src/services/__tests__/sqlStdlibDependencyAnalyzer.test.ts src/agentv3/__tests__/sqlIncludeInjector.test.ts --runInBand` | `npm --prefix backend run validate:skills` | scrolling SSE |
| stdlib lineage | `npm --prefix backend run test -- src/services/__tests__/stdlibSkillCoverage.test.ts --runInBand` | generate stdlib asset + validate | lookup schema + execute SQL SSE |
| Android Skill upgrades | affected `tests/skill-eval/*.eval.ts` | `npm --prefix backend run test:scene-trace-regression` | startup/scrolling SSE |
| TP connection model | lease/routing/worker tests | enterprise isolation tests | multi-trace comparison flow |
| Frontend prebuild | prebuild checker | Perfetto UI typecheck/build | `./start.sh` browser smoke |
| upstream AI skills | skill validator | scene regression | Agent SSE with target scene |

## Agent SSE 命令

Startup:

```bash
npm --prefix backend run verify:agent-sse-scrolling -- \
  --trace ../test-traces/lacunh_heavy.pftrace \
  --query "分析启动性能" \
  --output test-output/e2e-startup.json \
  --keep-session
```

Scrolling:

```bash
npm --prefix backend run verify:agent-sse-scrolling -- \
  --trace ../test-traces/scroll-demo-customer-scroll.pftrace \
  --query "分析滑动性能" \
  --output test-output/e2e-scrolling.json \
  --keep-session
```

Flutter TextureView / SurfaceView:

```bash
npm --prefix backend run verify:agent-sse-scrolling -- \
  --trace "../test-traces/Scroll-Flutter-327-TextureView.pftrace" \
  --query "分析 Flutter 滑动性能" \
  --output test-output/e2e-flutter-textureview.json \
  --keep-session

npm --prefix backend run verify:agent-sse-scrolling -- \
  --trace "../test-traces/Scroll-Flutter-SurfaceView-Wechat-Wenyiwen.pftrace" \
  --query "分析 Flutter 滑动性能" \
  --output test-output/e2e-flutter-surfaceview.json \
  --keep-session
```

## 结果检查

E2E 不能只看 exit code。需要检查：

- `backend/test-output/e2e-*.json` 是否有 terminal success。
- `backend/logs/sessions/session_*.jsonl` 是否有 SQL/tool error。
- final conclusion 是否能追溯到 Skill/SQL evidence。
- 如果涉及 SQL guardrail，确认 auto include / warning 在日志或 tool result 中可见。
