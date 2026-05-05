// Pure state machine driving a parsed <plan> through step / verify phases,
// with depth-first descent into nested plans. The agent loop calls
// `nextPrompt` to obtain the next synthetic-user turn, then reports back via
// `finishStepBody`, `pushNestedPlan`, or `applyVerify`. Events are buffered
// for the renderer and drained by the caller.

import type { ParsedPlan, VerifyResult } from "./parser";

export type PlanEvent =
  | {
      type: "plan_node_start";
      kind: "plan" | "step" | "verify";
      id: string;
      parentId?: string;
      name?: string;
      // For step nodes: the original <prompt> text from the plan, so the
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
  maxDepth?: number;
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
  private readonly maxDepth: number;

  constructor(plan: ParsedPlan, opts: PlanExecutionStateOptions = {}) {
    this.idGen = opts.idGen ?? defaultIdGen();
    this.maxRetries = opts.maxRetries ?? 2;
    this.maxDepth = opts.maxDepth ?? 3;
    this.pushFrame(plan, undefined);
  }

  pushNestedPlan(plan: ParsedPlan): void {
    if (this.frames.length >= this.maxDepth) {
      throw new Error(`max plan depth ${this.maxDepth} exceeded`);
    }
    const top = this.top();
    if (top.phase !== "step") {
      throw new Error("nested plan can only be pushed during a step body");
    }
    this.pushFrame(plan, top.currentStepNodeId);
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
      const header =
        `Execute step "${step.name}" now. Use <action> tags to do the work. ` +
        `Do NOT emit a <plan> in this turn — you are already inside a plan and the host is driving each step. Any <plan> tag you emit here will be rejected and this step will be re-prompted unchanged. ` +
        `If the step is too big, do as much as you can with <action> tags and let verify fail with a reason naming what's left; do not try to nest a sub-plan. ` +
        `Before writing any new code, read the canonical source-of-truth file for the kind of change you're making (see "Where to add things" in Gemma.md) so your edit fits the project's existing shape. ` +
        `When this step's work is done, write a brief plain-text summary and stop; the host will then ask you to verify.`;
      const body = f.retryReason
        ? `${step.prompt}\n\nPrevious attempt failed: ${f.retryReason}. Try a different approach.`
        : step.prompt;
      const text = `${header}\n\n${body}`;
      return { kind: "step", stepId: f.currentStepNodeId!, text };
    }

    if (!f.verifyStartEmitted) {
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
    const text = `Verify: ${step.verify}\n\nReply with <verify result="pass"/> or <verify result="fail" reason="...">.`;
    return { kind: "verify", stepId: f.currentStepNodeId!, text };
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
      return;
    }

    const parent = this.top();
    const parentStep = parent.plan.steps[parent.stepIndex];
    if (parentStep.verify.toLowerCase() === "none") {
      this.endStep(parent, "ok");
      this.advanceAfterStep(parent);
    } else {
      parent.phase = "verify";
    }
  }
}

function defaultIdGen(): () => string {
  let n = 0;
  return () => `plan-node-${++n}`;
}
