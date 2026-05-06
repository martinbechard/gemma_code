// Per-conversation persistence of a proposed plan. The harness writes the
// plan YAML here when the model emits one at the top level, then waits for the
// user to approve execution. On execute the file is parsed back into a
// ParsedPlan and used to drive PlanExecutionState. The file survives app
// crashes between propose and execute.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { userDataDir } from "../runtimePaths";
import { findNextPlan, type ParsedPlan } from "./parser";

function plansDir(): string {
  return join(userDataDir(), "plans");
}

function assertSafeId(conversationId: string): void {
  if (
    conversationId.length === 0 ||
    conversationId.includes("/") ||
    conversationId.includes("\\") ||
    conversationId.includes("..") ||
    conversationId.includes("\0")
  ) {
    throw new Error(`unsafe conversation id: ${conversationId}`);
  }
}

export function pendingPlanPath(conversationId: string): string {
  assertSafeId(conversationId);
  return join(plansDir(), `${conversationId}.yaml`);
}

export function savePlan(conversationId: string, planYaml: string): void {
  const dir = plansDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(pendingPlanPath(conversationId), planYaml, "utf8");
}

export function loadPlan(conversationId: string): ParsedPlan | null {
  const p = pendingPlanPath(conversationId);
  if (!existsSync(p)) return null;
  const yaml = readFileSync(p, "utf8");
  const parsed = findNextPlan(yaml);
  if (!parsed || parsed === "incomplete") return null;
  if (parsed.steps.length === 0) return null;
  return parsed;
}

export function clearPlan(conversationId: string): void {
  const p = pendingPlanPath(conversationId);
  if (existsSync(p)) rmSync(p, { force: true });
}
