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
    expect(p1?.text).toMatch(/do not emit another <plan>/i);

    s.finishStepBody();

    const p2 = s.nextPrompt();
    expect(p2?.kind).toBe("verify");
    expect(p2?.text).toContain("explore ok");

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

  it("tracks the inner step id while a nested plan is active", () => {
    const s = new PlanExecutionState(plan({ name: "outer" }), {
      idGen: counter(),
    });
    const outerStep = s.nextPrompt()!;
    expect(s.currentStepId).toBe(outerStep.stepId);

    s.pushNestedPlan(plan({ name: "inner" }));
    const innerStep = s.nextPrompt()!;
    expect(s.currentStepId).toBe(innerStep.stepId);
    expect(innerStep.stepId).not.toBe(outerStep.stepId);
  });
});

describe("PlanExecutionState — verify retry and abort", () => {
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

describe("PlanExecutionState — nested plans", () => {
  it("descends into a nested plan during a step's body, then resumes outer verify", () => {
    const s = new PlanExecutionState(plan({ name: "outer" }), {
      idGen: counter(),
    });
    s.nextPrompt();
    s.pushNestedPlan(plan({ name: "inner" }));

    const inner = s.nextPrompt();
    expect(inner?.kind).toBe("step");
    expect(inner?.text).toContain("do inner");
    s.finishStepBody();
    s.nextPrompt();
    s.applyVerify({ result: "pass" });

    const outerVerify = s.nextPrompt();
    expect(outerVerify?.kind).toBe("verify");
    expect(outerVerify?.text).toContain("outer ok");
    s.applyVerify({ result: "pass" });
    expect(s.state).toBe("complete");
  });

  it("rejects nested plans beyond maxDepth", () => {
    const s = new PlanExecutionState(plan({ name: "L1" }), {
      idGen: counter(),
      maxDepth: 2,
    });
    s.nextPrompt();
    s.pushNestedPlan(plan({ name: "L2" }));
    s.nextPrompt();
    expect(() => s.pushNestedPlan(plan({ name: "L3" }))).toThrow(/depth/i);
  });
});
