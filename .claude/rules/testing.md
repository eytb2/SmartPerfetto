# Testing Rules

## Mandatory post-change regression

After EVERY code change, run:
```bash
cd backend && npm run test:scene-trace-regression
```

## Canonical test traces

These 6 traces in `test-traces/` must all pass:

| Scene | Trace File |
|-------|-----------|
| Heavy scrolling jank | `app_aosp_scrolling_heavy_jank.pftrace` |
| Light scrolling | `app_aosp_scrolling_light.pftrace` |
| Standard scrolling | `app_scroll_Standard-AOSP-App-Without-PreAnimation.pftrace` |
| App startup | `app_start_heavy.pftrace` |
| Flutter TextureView | `Scroll-Flutter-327-TextureView.pftrace` |
| Flutter SurfaceView | `Scroll-Flutter-SurfaceView-Wechat-Wenyiwen.pftrace` |

## Other test commands

```bash
cd backend && npm test                    # All tests (~8 min)
npm test -- --testPathPattern="__tests__" # Unit tests only (~2 min)
npm test -- tests/skill-eval              # Skill evals only (~5 min)
npm run validate:strategies               # Validate strategy YAML frontmatter
npm run validate:skills                   # Validate skill contracts
```

## Agent finding verification

~30% of agent findings are false positives. Before implementing fixes from agent reviews:
1. Require code snippet evidence
2. Cross-check with at least 2 sources
3. Run trace regression to confirm
