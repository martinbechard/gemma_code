import { describe, it, expect } from "vitest";
import { findNextPlan } from "../../../src/main/plan/parser";

describe("findNextPlan — null / incomplete", () => {
  it("returns null when there is no <plan> tag", () => {
    expect(findNextPlan("just some prose, no plan here")).toBeNull();
  });

  it("returns null on empty input", () => {
    expect(findNextPlan("")).toBeNull();
  });

  it("returns 'incomplete' when <plan> has opened but not closed", () => {
    const text = 'I will plan this:\n<plan>\n  <step name="explore">\n';
    expect(findNextPlan(text)).toBe("incomplete");
  });

  it("returns 'incomplete' when </plan> is partially streamed", () => {
    const text = "<plan><step name=\"x\"><prompt>p</prompt><verify>v</verify></step></pla";
    expect(findNextPlan(text)).toBe("incomplete");
  });
});

describe("findNextPlan — well-formed", () => {
  it("parses a single step with name, prompt, verify", () => {
    const text = `Here is the plan:
<plan>
  <step name="explore">
    <prompt>List files in src/cli</prompt>
    <verify>The file list contains agent.ts</verify>
  </step>
</plan>
After the plan.`;
    const r = findNextPlan(text);
    expect(r).not.toBeNull();
    expect(r).not.toBe("incomplete");
    if (r === null || r === "incomplete") return;
    expect(r.steps).toHaveLength(1);
    expect(r.steps[0]).toEqual({
      name: "explore",
      prompt: "List files in src/cli",
      verify: "The file list contains agent.ts",
    });
    expect(text.slice(r.start, r.end)).toContain("<plan>");
    expect(text.slice(r.start, r.end)).toContain("</plan>");
  });

  it("parses multiple steps in order", () => {
    const text = `<plan>
<step name="a"><prompt>p1</prompt><verify>v1</verify></step>
<step name="b"><prompt>p2</prompt><verify>v2</verify></step>
<step name="c"><prompt>p3</prompt><verify>v3</verify></step>
</plan>`;
    const r = findNextPlan(text);
    if (r === null || r === "incomplete") throw new Error("expected plan");
    expect(r.steps.map((s) => s.name)).toEqual(["a", "b", "c"]);
    expect(r.steps[2].prompt).toBe("p3");
    expect(r.steps[2].verify).toBe("v3");
  });

  it("accepts verify=none as an explicit opt-out", () => {
    const text = `<plan>
<step name="trivial"><prompt>do thing</prompt><verify>none</verify></step>
</plan>`;
    const r = findNextPlan(text);
    if (r === null || r === "incomplete") throw new Error("expected plan");
    expect(r.steps[0].verify).toBe("none");
  });

  it("trims whitespace inside prompt and verify blocks", () => {
    const text = `<plan>
  <step name="s">
    <prompt>
      a multi-line
      prompt
    </prompt>
    <verify>
      result is fine
    </verify>
  </step>
</plan>`;
    const r = findNextPlan(text);
    if (r === null || r === "incomplete") throw new Error("expected plan");
    expect(r.steps[0].prompt).toBe("a multi-line\n      prompt");
    expect(r.steps[0].verify).toBe("result is fine");
  });

  it("tolerates attribute quote variations on name", () => {
    const text = `<plan>
<step name='single'><prompt>p</prompt><verify>v</verify></step>
<step name=bare><prompt>p</prompt><verify>v</verify></step>
<step  name = "spaced" ><prompt>p</prompt><verify>v</verify></step>
</plan>`;
    const r = findNextPlan(text);
    if (r === null || r === "incomplete") throw new Error("expected plan");
    expect(r.steps.map((s) => s.name)).toEqual(["single", "bare", "spaced"]);
  });

  it("reports start/end indices spanning the full <plan>…</plan>", () => {
    const prefix = "noise before\n";
    const planText = `<plan><step name="x"><prompt>p</prompt><verify>v</verify></step></plan>`;
    const text = prefix + planText + "\nafter";
    const r = findNextPlan(text);
    if (r === null || r === "incomplete") throw new Error("expected plan");
    expect(r.start).toBe(prefix.length);
    expect(r.end).toBe(prefix.length + planText.length);
    expect(r.raw).toBe(planText);
  });
});

describe("findNextPlan — malformed step rejection", () => {
  it("skips a step missing the name attribute", () => {
    const text = `<plan>
<step><prompt>p</prompt><verify>v</verify></step>
<step name="ok"><prompt>p2</prompt><verify>v2</verify></step>
</plan>`;
    const r = findNextPlan(text);
    if (r === null || r === "incomplete") throw new Error("expected plan");
    expect(r.steps.map((s) => s.name)).toEqual(["ok"]);
  });

  it("skips a step missing <prompt>", () => {
    const text = `<plan>
<step name="bad"><verify>v</verify></step>
<step name="good"><prompt>p</prompt><verify>v</verify></step>
</plan>`;
    const r = findNextPlan(text);
    if (r === null || r === "incomplete") throw new Error("expected plan");
    expect(r.steps.map((s) => s.name)).toEqual(["good"]);
  });

  it("skips a step missing <verify>", () => {
    const text = `<plan>
<step name="bad"><prompt>p</prompt></step>
<step name="good"><prompt>p</prompt><verify>v</verify></step>
</plan>`;
    const r = findNextPlan(text);
    if (r === null || r === "incomplete") throw new Error("expected plan");
    expect(r.steps.map((s) => s.name)).toEqual(["good"]);
  });

  it("returns a plan with empty steps when all steps are malformed", () => {
    const text = `<plan><step><prompt>p</prompt></step></plan>`;
    const r = findNextPlan(text);
    if (r === null || r === "incomplete") throw new Error("expected plan");
    expect(r.steps).toEqual([]);
  });
});

describe("findNextPlan — from offset", () => {
  it("respects the from index and finds the second plan", () => {
    const a = `<plan><step name="a"><prompt>p</prompt><verify>v</verify></step></plan>`;
    const b = `<plan><step name="b"><prompt>p</prompt><verify>v</verify></step></plan>`;
    const text = a + "\n" + b;
    const first = findNextPlan(text);
    if (first === null || first === "incomplete") throw new Error("expected plan");
    const second = findNextPlan(text, first.end);
    if (second === null || second === "incomplete") throw new Error("expected plan");
    expect(second.steps[0].name).toBe("b");
  });
});
