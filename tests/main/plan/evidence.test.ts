import { describe, expect, it } from "vitest";
import {
  createPlanStepEvidence,
  forcedVerifyFailureReason,
  isRecoverableEditFailureResult,
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

  it("treats ambiguous old_string edit failures as recoverable edit failures", () => {
    expect(
      isRecoverableEditFailureResult(
        "Error editing src/main/tools.ts: old_string appears multiple times in src/main/tools.ts. Use replace_all or add context.",
      ),
    ).toBe(true);
    expect(
      isRecoverableEditFailureResult(
        "Error editing src/main/tools.ts: old_string not found in src/main/tools.ts",
      ),
    ).toBe(true);
  });

  it("allows verify after a recoverable edit failure is corrected by write_file on the same path", () => {
    const evidence = createPlanStepEvidence();

    recordPlanToolEvidence(
      evidence,
      "edit_file",
      "Error editing src/main/tools.ts: old_string appears multiple times in src/main/tools.ts. Use replace_all or add context.",
      { path: "src/main/tools.ts" },
    );
    recordPlanToolEvidence(
      evidence,
      "write_file",
      "Wrote src/main/tools.ts (100 bytes, 5 lines).",
      { path: "src/main/tools.ts" },
    );

    expect(
      forcedVerifyFailureReason(
        "src/main/tools.ts contains the new tool",
        evidence,
      ),
    ).toBeNull();
  });

  it("keeps a recoverable edit failure unresolved until the same path is written or edited successfully", () => {
    const evidence = createPlanStepEvidence();

    recordPlanToolEvidence(
      evidence,
      "edit_file",
      "Error editing src/main/tools.ts: old_string not found in src/main/tools.ts",
      { path: "src/main/tools.ts" },
    );
    recordPlanToolEvidence(
      evidence,
      "write_file",
      "Wrote Gemma.md (100 bytes, 5 lines).",
      { path: "Gemma.md" },
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

  it("blocks a verify pass after a nonzero project script command", () => {
    const evidence = createPlanStepEvidence();

    recordPlanToolEvidence(
      evidence,
      "run_project_script",
      [
        "command=pnpm run build",
        "exit=1 (729ms)",
        "stdout:",
        "> gemma-chat@0.1.0 build",
        "stderr:",
        "Build failed",
      ].join("\n"),
    );

    expect(
      forcedVerifyFailureReason(
        "The build command pnpm run build has been executed successfully",
        evidence,
      ),
    ).toContain("command failure during step");
  });

  it("blocks a verify pass when a build criterion has no command evidence", () => {
    const evidence = createPlanStepEvidence();

    recordPlanToolEvidence(
      evidence,
      "write_file",
      "Wrote src/main/tools.ts (100 bytes, 5 lines).",
      { path: "src/main/tools.ts" },
    );

    expect(
      forcedVerifyFailureReason(
        "The build command pnpm run build has been executed successfully.",
        evidence,
      ),
    ).toContain("missing command evidence");
  });

  it("allows a verify pass when a build criterion has successful command evidence", () => {
    const evidence = createPlanStepEvidence();

    recordPlanToolEvidence(
      evidence,
      "run_project_script",
      ["command=pnpm run build", "exit=0 (1000ms)", "stdout:", "built"].join(
        "\n",
      ),
    );

    expect(
      forcedVerifyFailureReason(
        "The build command pnpm run build has been executed successfully.",
        evidence,
      ),
    ).toBeNull();
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
