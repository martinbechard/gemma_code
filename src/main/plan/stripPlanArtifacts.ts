import { findNextPlan } from "./parser";

const VERIFY_PAIRED_RE = /<verify\b[^>]*>[\s\S]*?<\/verify\s*>/gi;
const VERIFY_SELF_CLOSING_RE = /<verify\b[^>]*?\/\s*>/gi;
const SUMMARY_PAIRED_RE = /<summary\b[^>]*>([\s\S]*?)<\/summary\s*>/gi;
const ERROR_PAIRED_RE = /<error\b[^>]*>[\s\S]*?<\/error\s*>/gi;
const ERROR_SELF_CLOSING_RE = /<error\b[^>]*?\/\s*>/gi;
const BLANK_LINE_RUN_RE = /\n[ \t]*(?:\n[ \t]*)+/g;

export function stripPlanArtifacts(text: string): string {
  let out = stripYamlPlans(text);
  out = out.replace(VERIFY_PAIRED_RE, "");
  out = out.replace(VERIFY_SELF_CLOSING_RE, "");
  out = out.replace(SUMMARY_PAIRED_RE, "$1");
  out = out.replace(ERROR_PAIRED_RE, "");
  out = out.replace(ERROR_SELF_CLOSING_RE, "");
  out = out.replace(BLANK_LINE_RUN_RE, "\n\n");
  return out.trim();
}

function stripYamlPlans(text: string): string {
  let out = text;
  let cursor = 0;
  while (cursor < out.length) {
    const plan = findNextPlan(out, cursor);
    if (plan === null || plan === "incomplete") break;
    if (plan.steps.length === 0) {
      cursor = Math.max(plan.end, cursor + 1);
      continue;
    }
    out = `${out.slice(0, plan.start)}${out.slice(plan.end)}`;
    cursor = plan.start;
  }
  return out;
}
