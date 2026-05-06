// Parser for the <plan> protocol the model emits to drive multi-step work.
//
// Schema:
//   <plan>
//     <step name="...">
//       <prompt>...</prompt>
//       <verify>...</verify>
//     </step>
//     ...
//   </plan>
//
// Steps missing required fields (name, prompt, verify) are silently skipped;
// callers are free to reject a plan whose `steps` array ends up empty.

export interface ParsedStep {
  name: string;
  prompt: string;
  verify: string;
}

export interface ParsedPlan {
  steps: ParsedStep[];
  raw: string;
  start: number;
  end: number;
}

export type VerifyResult =
  | { result: "pass" }
  | { result: "fail"; reason: string };

const PLAN_OPEN_RE = /<plan\s*>/gi;
const PLAN_CLOSE_RE = /<\/plan\s*>/i;
const STEP_RE = /<step\s+([^>]*?)>([\s\S]*?)<\/step\s*>/gi;
const NAME_RE = /name\s*=\s*(?:"([^"]*)"|'([^']*)'|([a-zA-Z_][\w-]*))/i;
const PROMPT_RE = /<prompt>([\s\S]*?)<\/prompt>/i;
const VERIFY_RE = /<verify>([\s\S]*?)<\/verify>/i;

export function findNextPlan(
  text: string,
  from = 0,
): ParsedPlan | "incomplete" | null {
  PLAN_OPEN_RE.lastIndex = from;
  const open = PLAN_OPEN_RE.exec(text);
  if (!open) return null;

  const bodyStart = open.index + open[0].length;
  const closeMatch = text.slice(bodyStart).match(PLAN_CLOSE_RE);
  if (!closeMatch || closeMatch.index === undefined) return "incomplete";

  const closeIdx = bodyStart + closeMatch.index;
  const body = text.slice(bodyStart, closeIdx);
  const end = closeIdx + closeMatch[0].length;

  return {
    steps: parseSteps(body),
    raw: text.slice(open.index, end),
    start: open.index,
    end,
  };
}

export function containsCompletePlan(text: string): boolean {
  const plan = findNextPlan(text);
  return plan !== null && plan !== "incomplete";
}

function parseSteps(body: string): ParsedStep[] {
  const out: ParsedStep[] = [];
  STEP_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = STEP_RE.exec(body)) !== null) {
    const attrs = m[1];
    const inner = m[2];

    const nameM = NAME_RE.exec(attrs);
    const name = (nameM && (nameM[1] ?? nameM[2] ?? nameM[3]))?.trim();
    if (!name) continue;

    const promptM = PROMPT_RE.exec(inner);
    if (!promptM) continue;
    const prompt = promptM[1].trim();
    if (!prompt) continue;

    const verifyM = VERIFY_RE.exec(inner);
    if (!verifyM) continue;
    const verify = verifyM[1].trim();
    if (!verify) continue;

    out.push({ name, prompt, verify });
  }
  return out;
}

const VERIFY_TAG_RE = /<verify\b([^>]*?)(?:\/\s*>|>([\s\S]*?)<\/verify\s*>)/i;
const RESULT_RE = /result\s*=\s*(?:"([^"]*)"|'([^']*)'|([a-zA-Z_][\w-]*))/i;
const REASON_RE = /reason\s*=\s*(?:"([^"]*)"|'([^']*)'|([a-zA-Z_][\w-]*))/i;

export function parseVerifyResult(text: string): VerifyResult | null {
  const m = VERIFY_TAG_RE.exec(text);
  if (!m) return null;
  const attrs = m[1] ?? "";
  const body = (m[2] ?? "").trim();

  const resultM = RESULT_RE.exec(attrs);
  const result = (resultM && (resultM[1] ?? resultM[2] ?? resultM[3]))?.trim();
  if (result !== "pass" && result !== "fail") return null;

  if (result === "pass") return { result: "pass" };

  const reasonM = REASON_RE.exec(attrs);
  const reasonAttr = reasonM && (reasonM[1] ?? reasonM[2] ?? reasonM[3]);
  const reason =
    reasonAttr !== undefined && reasonAttr !== null ? reasonAttr : body;
  return { result: "fail", reason };
}
