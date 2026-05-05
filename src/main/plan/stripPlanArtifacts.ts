// Removes <plan>...</plan> and <verify .../> markup from streamed model
// output before the chat UI displays it. PlanView already renders the
// structured tree, so leaving the raw tag bodies in the message would
// double-display every step prompt and verify clause.
//
// Unterminated <plan> tags (e.g. mid-stream fragments) are left intact so
// in-progress streams remain visible until the closing tag arrives.

const PLAN_BLOCK_RE = /<plan\s*>[\s\S]*?<\/plan\s*>/gi;
const VERIFY_PAIRED_RE = /<verify\b[^>]*>[\s\S]*?<\/verify\s*>/gi;
const VERIFY_SELF_CLOSING_RE = /<verify\b[^>]*?\/\s*>/gi;
const BLANK_LINE_RUN_RE = /\n[ \t]*(?:\n[ \t]*)+/g;

export function stripPlanArtifacts(text: string): string {
  let out = text.replace(PLAN_BLOCK_RE, "");
  out = out.replace(VERIFY_PAIRED_RE, "");
  out = out.replace(VERIFY_SELF_CLOSING_RE, "");
  out = out.replace(BLANK_LINE_RUN_RE, "\n\n");
  return out.trim() === "" ? "" : out;
}
