// Pure state machine driving a parsed YAML plan through step / verify phases.
// The agent loop calls `nextPrompt` to obtain the next synthetic-user turn,
// then reports back via `finishStepBody` or `applyVerify`. Events are buffered
// for the renderer and drained by the caller.

import type { ParsedPlan, VerifyResult } from "./parser";

export type PlanEvent =
  | {
      type: "plan_node_start";
      kind: "plan" | "step" | "verify";
      id: string;
      parentId?: string;
      name?: string;
      // For step nodes: the original prompt text from the plan, so the
      // renderer can show what instructions the model gave itself for the step.
      prompt?: string;
      // For verify nodes: the original <verify> criterion text.
      criterion?: string;
    }
  | {
      type: "plan_node_end";
      kind: "plan" | "step" | "verify";
      id: string;
      status: "ok" | "failed";
      // For verify nodes that failed: the reason the model returned.
      reason?: string;
    };

export type Prompt =
  | { kind: "step"; stepId: string; text: string }
  | { kind: "verify"; stepId: string; text: string };

export type PlanState = "running" | "complete" | "failed";
export type ApplyResult = "advance" | "retry" | "abort";

export interface PlanExecutionStateOptions {
  idGen?: () => string;
  maxRetries?: number;
}

interface Frame {
  plan: ParsedPlan;
  stepIndex: number;
  retryCount: number;
  phase: "step" | "verify";
  retryReason?: string;
  planNodeId: string;
  currentStepNodeId?: string;
  currentVerifyNodeId?: string;
  stepStartEmitted: boolean;
  verifyStartEmitted: boolean;
}

export class PlanExecutionState {
  state: PlanState = "running";
  private frames: Frame[] = [];
  private events: PlanEvent[] = [];
  private readonly idGen: () => string;
  private readonly maxRetries: number;

  constructor(plan: ParsedPlan, opts: PlanExecutionStateOptions = {}) {
    this.idGen = opts.idGen ?? defaultIdGen();
    this.maxRetries = opts.maxRetries ?? 2;
    this.pushFrame(plan, undefined);
  }

  nextPrompt(): Prompt | null {
    if (this.state !== "running" || this.frames.length === 0) return null;
    const f = this.top();
    const step = f.plan.steps[f.stepIndex];
    if (!step) return null;

    if (f.phase === "step") {
      if (!f.stepStartEmitted) {
        f.currentStepNodeId = this.idGen();
        f.stepStartEmitted = true;
        this.events.push({
          type: "plan_node_start",
          kind: "step",
          id: f.currentStepNodeId,
          parentId: f.planNodeId,
          name: step.name,
          prompt: step.prompt,
        });
      }
      const body = f.retryReason
        ? `${step.prompt}\n\nPrevious attempt failed: ${f.retryReason}. Try a different approach.`
        : step.prompt;
      const instructions = [
        "Use <action> tags to invoke tools to do file operations and other external work.",
        "If a required tool result is not visible, says Error, is empty when useful output was required, or is truncated before the required evidence appears, reply exactly BLOCKED: followed by one short reason, then stop.",
        "If this requires changing files, emit a file-changing <action> tag and receive a successful tool result before summarizing.",
        "Summarize the work that was done.",
      ];
      const text = `${body}\n\n${instructions.join("\n")}`;
      return { kind: "step", stepId: f.currentStepNodeId!, text };
    }

    this.startVerify(f);
    const text =
      `Verify: ${step.verify}\n\n` +
      `Use prior tool results and visible file evidence from this step. ` +
      `If the existing evidence is not enough to verify the condition, issue read-only <action> tags now, such as read_file, search_files, list_files, or a non-mutating run_bash command, and wait for the tool result before deciding. ` +
      `Do not mutate files during verify. ` +
      `Do not guess, infer, or rely on intended behavior. If no available or newly gathered tool result proves the condition, fail and name the missing evidence. ` +
      `A targeted search result with no match for the exact requested text is valid evidence that the text was not found in the searched files. ` +
      `For remove, edit, update, replace, delete, or modify steps, pass only if the prior step includes successful mutation evidence; for removal steps, also require post-mutation absence evidence. ` +
      `If any required edit failed or any required command exited nonzero without a later successful rerun, fail and name that evidence. ` +
      `Reply with <verify result="pass"/> or <verify result="fail" reason="...">.`;
    return { kind: "verify", stepId: f.currentStepNodeId!, text };
  }

  currentVerifyCriterion(): string | null {
    if (this.state !== "running" || this.frames.length === 0) return null;
    const f = this.top();
    if (f.phase !== "verify" && f.phase !== "step") return null;
    return f.plan.steps[f.stepIndex]?.verify ?? null;
  }

  currentStepEvidenceCriterion(): string | null {
    if (this.state !== "running" || this.frames.length === 0) return null;
    const f = this.top();
    if (f.phase !== "verify" && f.phase !== "step") return null;
    const step = f.plan.steps[f.stepIndex];
    if (!step) return null;
    return `${step.prompt}\n${step.verify}`;
  }

  finishStepBody(): void {
    if (this.state !== "running") return;
    const f = this.top();
    if (f.phase !== "step") throw new Error("not in step phase");
    const step = f.plan.steps[f.stepIndex];
    if (step.verify.toLowerCase() === "none") {
      this.endStep(f, "ok");
      this.advanceAfterStep(f);
    } else {
      f.phase = "verify";
    }
  }

  applyVerify(result: VerifyResult): ApplyResult {
    if (this.state !== "running") return "abort";
    const f = this.top();
    if (f.phase !== "verify") throw new Error("not in verify phase");

    if (result.result === "pass") {
      this.endVerify(f, "ok");
      this.endStep(f, "ok");
      this.advanceAfterStep(f);
      return "advance";
    }

    if (f.retryCount < this.maxRetries) {
      this.endVerify(f, "failed", result.reason);
      f.retryCount++;
      f.retryReason = result.reason;
      f.phase = "step";
      f.verifyStartEmitted = false;
      f.currentVerifyNodeId = undefined;
      return "retry";
    }

    this.endVerify(f, "failed", result.reason);
    this.endStep(f, "failed");
    while (this.frames.length > 0) {
      const top = this.frames.pop()!;
      this.events.push({
        type: "plan_node_end",
        kind: "plan",
        id: top.planNodeId,
        status: "failed",
      });
    }
    this.state = "failed";
    return "abort";
  }

  failCurrentStepAttempt(reason: string): ApplyResult {
    if (this.state !== "running" || this.frames.length === 0) return "abort";
    const f = this.top();
    if (!f.currentStepNodeId) return "abort";
    if (f.phase === "step") {
      f.phase = "verify";
      this.startVerify(f);
    }
    return this.applyVerify({ result: "fail", reason });
  }

  abortCurrentStep(reason: string): void {
    if (this.state !== "running" || this.frames.length === 0) return;
    const f = this.top();
    if (!f.currentStepNodeId) return;
    if (f.phase === "step") {
      f.phase = "verify";
      this.startVerify(f);
    }
    this.endVerify(f, "failed", reason);
    this.endStep(f, "failed");
    while (this.frames.length > 0) {
      const top = this.frames.pop()!;
      this.events.push({
        type: "plan_node_end",
        kind: "plan",
        id: top.planNodeId,
        status: "failed",
      });
    }
    this.state = "failed";
  }

  drainEvents(): PlanEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  // Id of the innermost active step node, or null when no step is in flight.
  // The agent loop stamps tool calls with this so the renderer can group them
  // under the step they happened in.
  get currentStepId(): string | null {
    if (this.state !== "running" || this.frames.length === 0) return null;
    const f = this.top();
    return f.currentStepNodeId ?? null;
  }

  private top(): Frame {
    return this.frames[this.frames.length - 1];
  }

  private pushFrame(
    plan: ParsedPlan,
    parentStepNodeId: string | undefined,
  ): void {
    const planNodeId = this.idGen();
    this.events.push({
      type: "plan_node_start",
      kind: "plan",
      id: planNodeId,
      parentId: parentStepNodeId,
    });
    this.frames.push({
      plan,
      stepIndex: 0,
      retryCount: 0,
      phase: "step",
      planNodeId,
      stepStartEmitted: false,
      verifyStartEmitted: false,
    });
  }

  private endStep(f: Frame, status: "ok" | "failed"): void {
    if (f.currentStepNodeId) {
      this.events.push({
        type: "plan_node_end",
        kind: "step",
        id: f.currentStepNodeId,
        status,
      });
    }
  }

  private startVerify(f: Frame): void {
    if (f.verifyStartEmitted) return;
    const step = f.plan.steps[f.stepIndex];
    f.currentVerifyNodeId = this.idGen();
    f.verifyStartEmitted = true;
    this.events.push({
      type: "plan_node_start",
      kind: "verify",
      id: f.currentVerifyNodeId,
      parentId: f.currentStepNodeId,
      criterion: step.verify,
    });
  }

  private endVerify(f: Frame, status: "ok" | "failed", reason?: string): void {
    if (f.currentVerifyNodeId) {
      this.events.push({
        type: "plan_node_end",
        kind: "verify",
        id: f.currentVerifyNodeId,
        ...(reason ? { reason } : {}),
        status,
      });
    }
  }

  private advanceAfterStep(f: Frame): void {
    f.stepIndex++;
    f.retryCount = 0;
    f.retryReason = undefined;
    f.phase = "step";
    f.stepStartEmitted = false;
    f.verifyStartEmitted = false;
    f.currentStepNodeId = undefined;
    f.currentVerifyNodeId = undefined;

    if (f.stepIndex < f.plan.steps.length) return;

    this.events.push({
      type: "plan_node_end",
      kind: "plan",
      id: f.planNodeId,
      status: "ok",
    });
    this.frames.pop();

    if (this.frames.length === 0) {
      this.state = "complete";
    }
  }
}

function defaultIdGen(): () => string {
  let n = 0;
  return () => `plan-node-${++n}`;
}
