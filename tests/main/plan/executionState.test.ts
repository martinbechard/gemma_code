import { describe, it, expect } from "vitest";
import {
  PlanExecutionState,
  type PlanEvent,
} from "../../../src/main/plan/executionState";
import type { ParsedPlan } from "../../../src/main/plan/parser";

const counter = () => {
  let n = 0;
  return () => `n${++n}`;
};

const plan = (
  ...steps: Array<{ name: string; verify?: string }>
): ParsedPlan => ({
  steps: steps.map((s) => ({
    name: s.name,
    prompt: `do ${s.name}`,
    verify: s.verify ?? `${s.name} ok`,
  })),
  raw: "",
  start: 0,
  end: 0,
});

const startEvents = (events: PlanEvent[]) =>
  events.filter((e) => e.type === "plan_node_start");
const endEvents = (events: PlanEvent[]) =>
  events.filter((e) => e.type === "plan_node_end");

describe("PlanExecutionState — single step happy path", () => {
  it("yields step then verify, advances on pass, completes", () => {
    const s = new PlanExecutionState(plan({ name: "explore" }), {
      idGen: counter(),
    });

    const p1 = s.nextPrompt();
    expect(p1?.kind).toBe("step");
    expect(p1?.text).toContain("do explore");
    expect(p1?.text).not.toMatch(/\bhost\b/i);
    expect(p1?.text).toMatch(/do not emit a YAML plan/i);
    // Grounding reminder: every step prompt nudges the model to read
    // the canonical file before adding code to this project.
    expect(p1?.text).toMatch(/read.*canonical/i);
    expect(p1?.text).toMatch(/multiple files to read/i);
    expect(p1?.text).toMatch(/gather.*evidence/i);
    expect(p1?.text).toContain("avoid editing when it is already present");
    expect(p1?.text).toContain("run that exact command with run_bash");
    expect(p1?.text).toContain("preserve the current file content");
    expect(p1?.text).toMatch(/required write, edit, or command action fails/i);

    s.finishStepBody();

    const p2 = s.nextPrompt();
    expect(p2?.kind).toBe("verify");
    expect(p2?.text).toContain("explore ok");
    expect(p2?.text).not.toMatch(/\bhost\b/i);
    expect(p2?.text).toContain("Use only prior tool results");
    expect(p2?.text).toContain("any required edit failed");
    expect(p2?.text).toContain("targeted search result with no match");
    expect(s.currentVerifyCriterion()).toBe("explore ok");

    expect(s.applyVerify({ result: "pass" })).toBe("advance");
    expect(s.nextPrompt()).toBeNull();
    expect(s.state).toBe("complete");
  });

  it("emits start/end events for plan, step, verify nodes", () => {
    const s = new PlanExecutionState(plan({ name: "explore" }), {
      idGen: counter(),
    });
    s.nextPrompt();
    s.finishStepBody();
    s.nextPrompt();
    s.applyVerify({ result: "pass" });

    const events = s.drainEvents();
    const starts = startEvents(events).map((e) => e.kind);
    expect(starts).toEqual(["plan", "step", "verify"]);

    const ends = endEvents(events);
    expect(ends.map((e) => e.status)).toEqual(["ok", "ok", "ok"]);
  });

  it("plan_node_start for step carries the original prompt text", () => {
    const s = new PlanExecutionState(plan({ name: "explore" }), {
      idGen: counter(),
    });
    s.nextPrompt();
    const ev = startEvents(s.drainEvents()).find((e) => e.kind === "step");
    expect(ev?.prompt).toBe("do explore");
  });

  it("plan_node_start for verify carries the original criterion text", () => {
    const s = new PlanExecutionState(plan({ name: "explore" }), {
      idGen: counter(),
    });
    s.nextPrompt();
    s.finishStepBody();
    s.nextPrompt();
    const ev = startEvents(s.drainEvents()).find((e) => e.kind === "verify");
    expect(ev?.criterion).toBe("explore ok");
  });

  it("plan_node_end for verify failure carries the reason", () => {
    const s = new PlanExecutionState(plan({ name: "x" }), {
      idGen: counter(),
      maxRetries: 0,
    });
    s.nextPrompt();
    s.finishStepBody();
    s.nextPrompt();
    s.applyVerify({ result: "fail", reason: "missing artifact" });
    const verifyEnds = endEvents(s.drainEvents()).filter(
      (e) => e.kind === "verify",
    );
    expect(verifyEnds[0]?.reason).toBe("missing artifact");
  });
});

describe("PlanExecutionState — verify=none auto-advance", () => {
  it("skips verify phase when step's verify is 'none'", () => {
    const s = new PlanExecutionState(
      plan({ name: "trivial", verify: "none" }),
      {
        idGen: counter(),
      },
    );

    expect(s.nextPrompt()?.kind).toBe("step");
    s.finishStepBody();
    expect(s.nextPrompt()).toBeNull();
    expect(s.state).toBe("complete");

    const kinds = startEvents(s.drainEvents()).map((e) => e.kind);
    expect(kinds).not.toContain("verify");
  });
});

describe("PlanExecutionState — multi-step", () => {
  it("walks steps in order and completes after the last verify passes", () => {
    const s = new PlanExecutionState(
      plan({ name: "a" }, { name: "b" }, { name: "c" }),
      { idGen: counter() },
    );

    const seen: string[] = [];
    while (s.state === "running") {
      const p = s.nextPrompt();
      if (!p) break;
      seen.push(`${p.kind}:${p.stepId}`);
      if (p.kind === "step") s.finishStepBody();
      else s.applyVerify({ result: "pass" });
    }

    expect(s.state).toBe("complete");
    const stepIds = seen
      .filter((x) => x.startsWith("step:"))
      .map((x) => x.slice(5));
    const verifyIds = seen
      .filter((x) => x.startsWith("verify:"))
      .map((x) => x.slice(7));
    expect(stepIds).toHaveLength(3);
    expect(verifyIds).toEqual(stepIds);
  });
});

describe("PlanExecutionState — currentStepId", () => {
  it("returns the active step id while in step or verify phase, null otherwise", () => {
    const s = new PlanExecutionState(plan({ name: "a" }, { name: "b" }), {
      idGen: counter(),
    });
    expect(s.currentStepId).toBeNull();

    const p1 = s.nextPrompt();
    expect(s.currentStepId).toBe(p1!.stepId);

    s.finishStepBody();
    expect(s.currentStepId).toBe(p1!.stepId);

    s.nextPrompt();
    s.applyVerify({ result: "pass" });
    expect(s.currentStepId).toBeNull();

    const p2 = s.nextPrompt();
    expect(s.currentStepId).toBe(p2!.stepId);
    expect(p2!.stepId).not.toBe(p1!.stepId);
  });

  it("keeps the same top-level step id through body and verify", () => {
    const s = new PlanExecutionState(plan({ name: "outer" }), {
      idGen: counter(),
    });
    const step = s.nextPrompt()!;
    expect(s.currentStepId).toBe(step.stepId);

    s.finishStepBody();
    expect(s.currentStepId).toBe(step.stepId);

    const verify = s.nextPrompt()!;
    expect(verify.stepId).toBe(step.stepId);
  });
});

describe("PlanExecutionState — verify retry and abort", () => {
  it("can fail the current step attempt from step phase and retry without waiting for verify text", () => {
    const s = new PlanExecutionState(plan({ name: "verify" }), {
      idGen: counter(),
      maxRetries: 1,
    });

    const first = s.nextPrompt();
    expect(first?.kind).toBe("step");

    expect(
      s.failCurrentStepAttempt(
        "repeated run_bash action after command failure",
      ),
    ).toBe("retry");

    const retry = s.nextPrompt();
    expect(retry?.kind).toBe("step");
    expect(retry?.stepId).toBe(first?.stepId);
    expect(retry?.text).toContain("repeated run_bash action");

    const events = s.drainEvents();
    expect(startEvents(events).map((e) => e.kind)).toEqual([
      "plan",
      "step",
      "verify",
    ]);
    expect(endEvents(events)).toContainEqual(
      expect.objectContaining({
        kind: "verify",
        status: "failed",
        reason: "repeated run_bash action after command failure",
      }),
    );
  });

  it("retries the same step on fail, eventually advances on pass", () => {
    const s = new PlanExecutionState(plan({ name: "x" }), {
      idGen: counter(),
      maxRetries: 2,
    });

    s.nextPrompt();
    s.finishStepBody();
    s.nextPrompt();
    expect(s.applyVerify({ result: "fail", reason: "first miss" })).toBe(
      "retry",
    );

    const retry = s.nextPrompt();
    expect(retry?.kind).toBe("step");
    expect(retry?.text).toContain("first miss");
    s.finishStepBody();
    s.nextPrompt();
    expect(s.applyVerify({ result: "pass" })).toBe("advance");
    expect(s.state).toBe("complete");
  });

  it("aborts after maxRetries failures", () => {
    const s = new PlanExecutionState(plan({ name: "x" }), {
      idGen: counter(),
      maxRetries: 2,
    });
    s.nextPrompt();
    s.finishStepBody();
    s.nextPrompt();
    expect(s.applyVerify({ result: "fail", reason: "1" })).toBe("retry");
    s.nextPrompt();
    s.finishStepBody();
    s.nextPrompt();
    expect(s.applyVerify({ result: "fail", reason: "2" })).toBe("retry");
    s.nextPrompt();
    s.finishStepBody();
    s.nextPrompt();
    expect(s.applyVerify({ result: "fail", reason: "3" })).toBe("abort");
    expect(s.state).toBe("failed");
    expect(s.nextPrompt()).toBeNull();
  });
});

describe("PlanExecutionState — non-recursive plan execution", () => {
  it("does not expose nested plan execution", () => {
    expect(Object.hasOwn(PlanExecutionState.prototype, "pushNestedPlan")).toBe(
      false,
    );
  });
});
