import { parse } from "yaml";

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

interface PlanYamlDocument {
  plan?: {
    steps?: unknown[];
  };
}

const PLAN_KEY_RE = /^plan\s*:\s*(?:#.*)?$/gm;
const VERIFY_TAG_RE = /<verify\b([^>]*?)(?:\/\s*>|>([\s\S]*?)<\/verify\s*>)/i;
const RESULT_RE = /result\s*=\s*(?:"([^"]*)"|'([^']*)'|([a-zA-Z_][\w-]*))/i;
const REASON_RE = /reason\s*=\s*(?:"([^"]*)"|'([^']*)'|([a-zA-Z_][\w-]*))/i;

export function findNextPlan(
  text: string,
  from = 0,
): ParsedPlan | "incomplete" | null {
  const start = findPlanStart(text, from);
  if (start === null) return null;

  const nextStart = findPlanStart(text, start + "plan:".length);
  const planEnd = findPlanEnd(text, start);
  const end = Math.min(nextStart ?? text.length, planEnd);
  const raw = text.slice(start, end).trimEnd();
  if (raw.length === 0) return "incomplete";

  let doc: unknown;
  try {
    doc = parse(raw);
  } catch {
    return "incomplete";
  }

  return {
    steps: parseSteps(doc),
    raw,
    start,
    end: start + raw.length,
  };
}

export function containsCompletePlan(text: string): boolean {
  const plan = findNextPlan(text);
  return plan !== null && plan !== "incomplete" && plan.steps.length > 0;
}

function findPlanStart(text: string, from: number): number | null {
  PLAN_KEY_RE.lastIndex = from;
  const match = PLAN_KEY_RE.exec(text);
  return match ? match.index : null;
}

function findPlanEnd(text: string, start: number): number {
  const lines = text.slice(start).match(/[^\n]*(?:\n|$)/g) ?? [];
  let offset = start;
  let sawPlanLine = false;
  for (const line of lines) {
    if (line.length === 0) break;
    if (!sawPlanLine) {
      sawPlanLine = true;
      offset += line.length;
      continue;
    }
    if (line.trim().length > 0 && !/^\s/.test(line)) {
      break;
    }
    offset += line.length;
  }
  return offset;
}

function parseSteps(doc: unknown): ParsedStep[] {
  if (!isPlanYamlDocument(doc)) return [];
  const steps = doc.plan?.steps;
  if (!Array.isArray(steps)) return [];

  const parsedSteps: ParsedStep[] = [];
  for (const step of steps) {
    if (!isRecord(step)) continue;
    const name = stringField(step, "name");
    const prompt = stringField(step, "prompt");
    const verify = stringField(step, "verify");
    if (!name || !prompt || !verify) continue;
    parsedSteps.push({ name, prompt, verify });
  }
  return parsedSteps;
}

function isPlanYamlDocument(value: unknown): value is PlanYamlDocument {
  if (!isRecord(value)) return false;
  const plan = value.plan;
  if (plan === undefined) return false;
  if (!isRecord(plan)) return false;
  const steps = plan.steps;
  return steps === undefined || Array.isArray(steps);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(
  source: Record<string, unknown>,
  key: string,
): string | null {
  const value = source[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? value : null;
}

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
