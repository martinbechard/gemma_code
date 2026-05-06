import { describe, expect, it } from "vitest";
import {
  createPlanStepEvidence,
  forcedVerifyFailureReason,
  recordPlanToolEvidence,
} from "../../../src/main/plan/evidence";

describe("plan step evidence", () => {
  it("blocks a verify pass when a step gathered no tool evidence", () => {
    const evidence = createPlanStepEvidence();

    expect(
      forcedVerifyFailureReason("The file was changed.", evidence),
    ).toContain("no tool evidence");
  });

  it("blocks a verify pass after an edit_file failure", () => {
    const evidence = createPlanStepEvidence();

    recordPlanToolEvidence(
      evidence,
      "edit_file",
      "Error editing src/main/tools.ts: old_string not found",
    );

    expect(
      forcedVerifyFailureReason(
        "src/main/tools.ts contains the new tool",
        evidence,
      ),
    ).toContain("tool failure during step");
  });

  it("does not treat successful file content containing error text as a tool failure", () => {
    const evidence = createPlanStepEvidence();

    recordPlanToolEvidence(
      evidence,
      "read_file",
      'return `Error fetching: ${(e as Error).message}`;',
      { path: "src/main/tools.ts" },
    );

    expect(
      forcedVerifyFailureReason("src/main/tools.ts has been read.", evidence),
    ).toBeNull();
  });

  it("blocks a verify pass when a required read path is missing", () => {
    const evidence = createPlanStepEvidence();

    recordPlanToolEvidence(evidence, "read_file", "tools source", {
      path: "src/main/tools.ts",
    });

    expect(
      forcedVerifyFailureReason(
        "src/main/tools.ts, Gemma.md, package.json, and tests/main/currentDatetimeTool.test.ts have been read.",
        evidence,
      ),
    ).toContain(
      "missing read_file evidence for: Gemma.md, package.json, tests/main/currentDatetimeTool.test.ts",
    );
  });

  it("allows a verify pass when every required read path is present", () => {
    const evidence = createPlanStepEvidence();

    for (const path of [
      "src/main/tools.ts",
      "Gemma.md",
      "package.json",
      "tests/main/currentDatetimeTool.test.ts",
    ]) {
      recordPlanToolEvidence(evidence, "read_file", `content for ${path}`, {
        path,
      });
    }

    expect(
      forcedVerifyFailureReason(
        "src/main/tools.ts, Gemma.md, package.json, and tests/main/currentDatetimeTool.test.ts have been read.",
        evidence,
      ),
    ).toBeNull();
  });

  it("blocks a verify pass after a required nonzero command", () => {
    const evidence = createPlanStepEvidence();

    recordPlanToolEvidence(evidence, "run_bash", "exit=1 stdout: failed");

    expect(
      forcedVerifyFailureReason("The focused test exited 0.", evidence),
    ).toContain("command failure during step");
  });

  it("allows nonzero command evidence when the criterion expects failure", () => {
    const evidence = createPlanStepEvidence();

    recordPlanToolEvidence(evidence, "run_bash", "exit=1 stdout: failed");

    expect(
      forcedVerifyFailureReason(
        "The focused test fails because the tool is missing.",
        evidence,
      ),
    ).toBeNull();
  });
});
