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
