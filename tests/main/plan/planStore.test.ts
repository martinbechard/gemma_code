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

const samplePlanYaml = [
  "plan:",
  "  steps:",
  "    - name: explore",
  "      prompt: list the workspace",
  "      verify: workspace listed",
].join("\n");

describe("planStore", () => {
  it("savePlan creates the file at the expected per-conversation path", () => {
    savePlan("conv-1", samplePlanYaml);
    const p = pendingPlanPath("conv-1");
    expect(p.startsWith(join(dir, "plans"))).toBe(true);
    expect(p.endsWith("conv-1.yaml")).toBe(true);
    expect(existsSync(p)).toBe(true);
  });

  it("loadPlan returns null when no plan has been saved", () => {
    expect(loadPlan("missing")).toBeNull();
  });

  it("loadPlan returns the parsed plan after savePlan", () => {
    savePlan("c", samplePlanYaml);
    const loaded = loadPlan("c");
    expect(loaded).not.toBeNull();
    expect(loaded!.steps.length).toBe(1);
    expect(loaded!.steps[0].name).toBe("explore");
    expect(loaded!.steps[0].prompt).toBe("list the workspace");
    expect(loaded!.steps[0].verify).toBe("workspace listed");
  });

  it("loadPlan returns null when the saved file is malformed", () => {
    savePlan("c", "plan:\n  steps:\n    - prompt: missing name");
    expect(loadPlan("c")).toBeNull();
  });

  it("savePlan overwrites a previous proposal for the same conversation", () => {
    savePlan("c", samplePlanYaml);
    const second = [
      "plan:",
      "  steps:",
      "    - name: other",
      "      prompt: p2",
      "      verify: v2",
    ].join("\n");
    savePlan("c", second);
    const loaded = loadPlan("c");
    expect(loaded!.steps[0].name).toBe("other");
  });

  it("clearPlan removes the file; subsequent loadPlan returns null", () => {
    savePlan("c", samplePlanYaml);
    clearPlan("c");
    expect(loadPlan("c")).toBeNull();
    expect(existsSync(pendingPlanPath("c"))).toBe(false);
  });

  it("clearPlan is a no-op when no plan exists", () => {
    expect(() => clearPlan("never-saved")).not.toThrow();
  });

  it("plan paths for distinct conversations are isolated", () => {
    savePlan("a", samplePlanYaml);
    savePlan(
      "b",
      ["plan:", "  steps:", "    - name: x", "      prompt: p", "      verify: v"].join(
        "\n",
      ),
    );
    expect(loadPlan("a")!.steps[0].name).toBe("explore");
    expect(loadPlan("b")!.steps[0].name).toBe("x");
    clearPlan("a");
    expect(loadPlan("a")).toBeNull();
    expect(loadPlan("b")).not.toBeNull();
  });

  it("rejects conversationIds containing path separators", () => {
    expect(() => savePlan("../escape", samplePlanYaml)).toThrow();
    expect(() => savePlan("a/b", samplePlanYaml)).toThrow();
    expect(() => loadPlan("../escape")).toThrow();
    expect(() => clearPlan("../escape")).toThrow();
  });
});
