import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { setRuntimePaths } from "../../../src/main/runtimePaths";
import {
  savePlan,
  loadPlan,
  clearPlan,
  pendingPlanPath,
} from "../../../src/main/plan/planStore";

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "plan-store-"));
  setRuntimePaths({ userData: dir, appRoot: dir, packaged: false });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const samplePlanXml = `<plan>
  <step name="explore">
    <prompt>list the workspace</prompt>
    <verify>workspace listed</verify>
  </step>
</plan>`;

describe("planStore", () => {
  it("savePlan creates the file at the expected per-conversation path", () => {
    savePlan("conv-1", samplePlanXml);
    const p = pendingPlanPath("conv-1");
    expect(p.startsWith(join(dir, "plans"))).toBe(true);
    expect(p.endsWith("conv-1.xml")).toBe(true);
    expect(existsSync(p)).toBe(true);
  });

  it("loadPlan returns null when no plan has been saved", () => {
    expect(loadPlan("missing")).toBeNull();
  });

  it("loadPlan returns the parsed plan after savePlan", () => {
    savePlan("c", samplePlanXml);
    const loaded = loadPlan("c");
    expect(loaded).not.toBeNull();
    expect(loaded!.steps.length).toBe(1);
    expect(loaded!.steps[0].name).toBe("explore");
    expect(loaded!.steps[0].prompt).toBe("list the workspace");
    expect(loaded!.steps[0].verify).toBe("workspace listed");
  });

  it("loadPlan returns null when the saved file is malformed", () => {
    savePlan("c", "<plan><step>bad</step></plan>");
    expect(loadPlan("c")).toBeNull();
  });

  it("savePlan overwrites a previous proposal for the same conversation", () => {
    savePlan("c", samplePlanXml);
    const second = `<plan>
  <step name="other">
    <prompt>p2</prompt>
    <verify>v2</verify>
  </step>
</plan>`;
    savePlan("c", second);
    const loaded = loadPlan("c");
    expect(loaded!.steps[0].name).toBe("other");
  });

  it("clearPlan removes the file; subsequent loadPlan returns null", () => {
    savePlan("c", samplePlanXml);
    clearPlan("c");
    expect(loadPlan("c")).toBeNull();
    expect(existsSync(pendingPlanPath("c"))).toBe(false);
  });

  it("clearPlan is a no-op when no plan exists", () => {
    expect(() => clearPlan("never-saved")).not.toThrow();
  });

  it("plan paths for distinct conversations are isolated", () => {
    savePlan("a", samplePlanXml);
    savePlan(
      "b",
      `<plan><step name="x"><prompt>p</prompt><verify>v</verify></step></plan>`,
    );
    expect(loadPlan("a")!.steps[0].name).toBe("explore");
    expect(loadPlan("b")!.steps[0].name).toBe("x");
    clearPlan("a");
    expect(loadPlan("a")).toBeNull();
    expect(loadPlan("b")).not.toBeNull();
  });

  it("rejects conversationIds containing path separators", () => {
    expect(() => savePlan("../escape", samplePlanXml)).toThrow();
    expect(() => savePlan("a/b", samplePlanXml)).toThrow();
    expect(() => loadPlan("../escape")).toThrow();
    expect(() => clearPlan("../escape")).toThrow();
  });
});
