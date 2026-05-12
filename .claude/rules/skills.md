# YAML Skill Rules

## Role of Skills

Skills are deterministic trace-analysis programs. They are the agent's evidence
collection layer, not a place for open-ended prompt prose.

Location:

```text
backend/skills/
  atomic/       # single-purpose SQL/evidence steps
  composite/    # multi-step scene analyses
  deep/         # deeper diagnostics
  pipelines/    # rendering-pipeline detection and teaching
  _template/    # skill authoring templates
```

The repository currently contains 200+ skill/config YAML files. Avoid hardcoding
counts in code or docs unless a test enforces them.

## Skill Types and Layers

Common skill types:

- `atomic`
- `composite`
- `iterator`
- `parallel`
- `conditional`

Layered results:

- L1 overview: aggregated metrics, `display.layer: overview` with `display.level: summary` or `key`.
- L2 list/detail: tables and expandable rows, usually `display.layer: list` with `display.level: detail`.
- L3 diagnosis: per-frame or per-event diagnosis, often iterator output.
- L4 deep: detailed frame/slice/callstack evidence.

Keep DataEnvelope output self-describing so frontend rendering stays generic.

## Parameter and Display Contracts

Skill parameters use:

```yaml
${param|default}
```

DataEnvelope columns should use typed column metadata where possible:

`display.layer` controls where the result appears: `overview`, `list`,
`session`, `deep`, or `diagnosis`. `display.level` controls visibility/detail:
`none`, `debug`, `detail`, `summary`, `key`, or `hidden`.

- `timestamp`
- `duration`
- `number`
- `string`
- `percentage`
- `bytes`

Click actions should be explicit, for example:

- `navigate_timeline`
- `navigate_range`
- `copy`

## Runtime Boundaries

- SQL should stay inside Skills or MCP SQL helpers, not UI code.
- Skill docs and `doc_path` references must point at committed repository docs.
- If a rendering-pipeline doc becomes runtime evidence, validate the matching
  Skill after editing that doc.
- Vendor or platform-specific behavior should be explicit in Skill inputs,
  conditions, or overrides, not hidden in generic SQL.

## Validation

After changing Skill YAML:

```bash
cd backend
npm run validate:skills
npm run test:scene-trace-regression
```

For scene-critical Skills, also run the relevant Agent SSE e2e check from
`.claude/rules/testing.md` and inspect both `backend/test-output/` and
`backend/logs/sessions/`.
