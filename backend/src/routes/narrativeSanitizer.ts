/**
 * Sanitizes assistant narrative text for end users.
 * Keeps human-readable reasoning but removes internal evidence IDs.
 */

const EVIDENCE_ID_RE = /\bev_[0-9a-f]{12}\b/gi;

export function sanitizeNarrativeForClient(narrative: string): string {
  let out = String(narrative || '');
  if (!out.trim()) return out;

  // Hide internal evidence index line from user-facing output.
  out = out.replace(/^\s*-\s*证据索引（自动补全）:.*$/gim, '');

  // Remove compact "(ev_xxx|ev_yyy)" groups first to avoid leftover wrappers.
  out = out.replace(
    /[（(]\s*ev_[0-9a-f]{12}(?:\s*[|｜]\s*ev_[0-9a-f]{12})*\s*[）)]/gi,
    ''
  );

  // Remove any remaining standalone evidence IDs.
  out = out.replace(EVIDENCE_ID_RE, '');

  // Remove empty JSON evidence field after evidence-id stripping.
  out = out.replace(/,\s*"evidence"\s*:\s*""/g, '');
  out = out.replace(/"evidence"\s*:\s*"",\s*/g, '');

  // Remove connector-only placeholders left inside parentheses after ID removal.
  // Example: "（ vs ）", "( | )", "（ / ）"
  out = out.replace(/[（(]\s*(?:vs|VS)\s*[）)]/g, '');
  out = out.replace(/[（(]\s*(?:[|｜/:,+-]\s*)+[）)]/g, '');

  // Cleanup artifacts introduced by ID removal.
  out = out.replace(/[（(]\s*[）)]/g, '');
  out = out.replace(/[ \t]+$/gm, '');
  out = out.replace(/[ \t]{2,}/g, ' ');
  out = out.replace(/\n{3,}/g, '\n\n');

  return out.trim();
}
