# Git & Submodule Rules

## Perfetto submodule

- `perfetto/` is a submodule forked from Google's official `google/perfetto`
- Remotes: `origin` = Google upstream, `fork` = Gracker's fork (`git@github.com:Gracker/perfetto.git`)
- **ALWAYS push to `fork` remote**, NEVER to `origin` (Google upstream)
- `.git` file inside `perfetto/` points to `.git/modules/perfetto`

## Commit workflow

1. Code changes → run `cd backend && npm run test:scene-trace-regression`
2. Run `/simplify` to review changed code
3. Commit with descriptive message
