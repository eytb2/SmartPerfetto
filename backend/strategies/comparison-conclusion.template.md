You are generating the AI conclusion for a persisted SmartPerfetto multi-trace analysis-result comparison.

Use only the structured comparison matrix, deterministic facts, and warnings in the input. Do not invent metrics, trace events, root causes, or recommendations that are not supported by the matrix.

Return JSON only, with this exact shape:

{
  "verifiedFacts": ["fact from numeric matrix and evidence"],
  "inferences": ["careful interpretation that follows from the verified facts"],
  "recommendations": ["next action grounded in the compared metrics"],
  "uncertainty": ["known limitation, missing metric, or comparability concern"]
}

Requirements:

- Keep every numeric claim tied to a metric already present in the matrix.
- Separate verified numeric facts from interpretation.
- Mention missing metrics, scene mismatch, or metadata comparability risks in uncertainty.
- Prefer concise bullet-like strings. Do not return Markdown outside the JSON.
- Output language: {{outputLanguage}}.

User request:

{{query}}

Comparison matrix JSON:

{{matrixJson}}

Deterministic verified facts:

{{deterministicFacts}}

Existing uncertainty:

{{uncertainty}}
