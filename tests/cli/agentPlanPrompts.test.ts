import { describe, expect, it } from "vitest";
import {
  buildCodeNoProgressPrompt,
  buildEditFailureRecoveryPrompt,
  buildPlanAmendmentPrompt,
  hasSatisfiedReadOnlyStepEvidence,
  buildPrematureVerifyPrompt,
  buildIncompleteStepPrompt,
  buildRepeatedActionPrompt,
  buildRepeatedEditFailureRecoveryPrompt,
  buildRepeatedRecoveryReadPrompt,
  createPlanInspectionEvidence,
  recordPlanInspectionEvidence,
  shouldHandlePlanAssemblyBuffer,
  type AgentRunOptions,
} from "../../src/cli/agent";
import {
  createPlanStepEvidence,
  recordPlanToolEvidence,
} from "../../src/main/plan/evidence";
import {
  applyPlanAssemblyResponse,
  createPlanAssemblyState,
} from "../../src/main/plan/assembly";
import { EXECUTABLE_PLAN_VALIDATION_GUIDANCE_LINES } from "../../src/main/plan/validation";

const codeOpts: AgentRunOptions = {
  mode: "code",
  model: "mlx-community/gemma-4-e2b-it-4bit",
  prompt: "Add keyboard shortcuts to the composer.",
  enableBash: true,
  worktree: true,
};

describe("plan inspection evidence", () => {
  it("ignores failed tool results", () => {
    const evidence = createPlanInspectionEvidence();

    recordPlanInspectionEvidence(
      evidence,
      "read_file",
      { path: "src/main/tools.ts" },
      "Error reading src/main/tools.ts: ENOENT",
    );

    expect(evidence.readPaths.size).toBe(0);
  });

  it("records successful file and command evidence without deriving fixed paths", () => {
    const evidence = createPlanInspectionEvidence();

    recordPlanInspectionEvidence(
      evidence,
      "read_file",
      { path: "src/renderer/src/components/Composer.tsx" },
      "ok",
    );
    recordPlanInspectionEvidence(
      evidence,
      "run_bash",
      { command: "npm test tests/renderer/components/Message.test.ts" },
      "pass",
    );

    expect(evidence.readPaths.has("src/renderer/src/components/Composer.tsx")).toBe(
      true,
    );
    expect(evidence.bashCommands).toEqual([
      "npm test tests/renderer/components/Message.test.ts",
    ]);
  });
});

describe("buildRepeatedActionPrompt", () => {
  it("uses a generic repeated action recovery prompt", () => {
    const prompt = buildRepeatedActionPrompt(
      codeOpts,
      createPlanInspectionEvidence(),
      "read_file",
      2,
    );

    expect(prompt).toContain("read_file");
    expect(prompt).toContain("move to the next distinct action");
    expect(prompt).toContain('reply exactly with <error reason="short reason"/>');
    expect(prompt).toContain("Do not assume hidden output");
    expect(prompt).toContain("Do not emit a YAML plan");
    expect(prompt).not.toContain("src/main/tools.ts");
    expect(prompt).not.toContain("tests/main");
  });
});

describe("buildCodeNoProgressPrompt", () => {
  it("nudges generic planning progress without injecting files or commands", () => {
    const prompt = buildCodeNoProgressPrompt(
      codeOpts,
      createPlanInspectionEvidence(),
    );

    expect(prompt).toContain("Continue in planning mode");
    expect(prompt).toContain("emit exactly one YAML plan step");
    expect(prompt).not.toContain("src/main/tools.ts");
    expect(prompt).not.toContain("tests/main");
  });
});

describe("hasSatisfiedReadOnlyStepEvidence", () => {
  it("recognizes completed read-only inspection steps", () => {
    const evidence = createPlanStepEvidence();
    const criterion =
      "src/main/tools.ts and Gemma.md have been read or inspected.";

    recordPlanToolEvidence(evidence, "read_file", "tools content", {
      path: "src/main/tools.ts",
    });
    expect(hasSatisfiedReadOnlyStepEvidence(criterion, evidence)).toBe(false);

    recordPlanToolEvidence(evidence, "read_file", "gemma content", {
      path: "Gemma.md",
    });
    expect(hasSatisfiedReadOnlyStepEvidence(criterion, evidence)).toBe(true);
    expect(
      hasSatisfiedReadOnlyStepEvidence(
        "The reading or inspection of src/main/tools.ts and Gemma.md has been completed.",
        evidence,
      ),
    ).toBe(true);
  });

  it("does not treat implementation criteria as read-only steps", () => {
    const evidence = createPlanStepEvidence();
    recordPlanToolEvidence(evidence, "read_file", "get_current_hostname", {
      path: "src/main/tools.ts",
    });

    expect(
      hasSatisfiedReadOnlyStepEvidence(
        "src/main/tools.ts contains get_current_hostname.",
        evidence,
      ),
    ).toBe(false);
    expect(
      hasSatisfiedReadOnlyStepEvidence(
        "The implementation of the get_current_hostname tool in src/main/tools.ts is complete or confirmed as already present.",
        evidence,
      ),
    ).toBe(false);
  });
});

describe("buildPlanAmendmentPrompt", () => {
  it("asks for one additional YAML plan step without more tools", () => {
    const prompt = buildPlanAmendmentPrompt(
      "Plan has no executable steps.",
    );

    expect(prompt).toContain("Do not use tools");
    expect(prompt).toContain("one additional well-formed YAML plan step");
    expect(prompt).toContain("name, prompt, and verify");
  });

  it("includes generic deterministic validation guidance", () => {
    const prompt = buildPlanAmendmentPrompt(
      "Plan has no executable steps.",
    );

    for (const line of EXECUTABLE_PLAN_VALIDATION_GUIDANCE_LINES) {
      expect(prompt).toContain(line);
    }
    expect(prompt).not.toContain("focused test command");
    expect(prompt).not.toContain("tests/main");
  });
});

describe("shouldHandlePlanAssemblyBuffer", () => {
  it("routes non-YAML answers after an accepted planning fragment to assembly rejection", () => {
    const first = applyPlanAssemblyResponse(
      createPlanAssemblyState(),
      [
        "plan:",
        "  steps:",
        "    - name: explore",
        "      prompt: Read src/main/tools.ts.",
        "      verify: src/main/tools.ts has been read.",
      ].join("\n"),
    );
    if (first.kind !== "accepted") throw new Error("expected accepted step");

    expect(
      shouldHandlePlanAssemblyBuffer({
        planStateActive: false,
        planAssemblyState: first.state,
        planFound: null,
        buffer: "That is all.",
      }),
    ).toBe(true);
  });

  it("does not handle non-YAML answers before any planning fragment", () => {
    expect(
      shouldHandlePlanAssemblyBuffer({
        planStateActive: false,
        planAssemblyState: createPlanAssemblyState(),
        planFound: null,
        buffer: "I need more context.",
      }),
    ).toBe(false);
  });
});

describe("buildEditFailureRecoveryPrompt", () => {
  it("forces rereading the failed edit target before retrying", () => {
    const prompt = buildEditFailureRecoveryPrompt(
      "tests/main/currentDatetimeTool.test.ts",
    );

    expect(prompt).toContain("old_string could not be applied safely");
    expect(prompt).toContain("<action name=\"read_file\">");
    expect(prompt).toContain(
      "<path>tests/main/currentDatetimeTool.test.ts</path>",
    );
    expect(prompt).toContain("nothing else");
  });
});

describe("buildRepeatedEditFailureRecoveryPrompt", () => {
  it("blocks retrying the same missing old string after repeated failures", () => {
    const prompt = buildRepeatedEditFailureRecoveryPrompt(
      "tests/main/currentDatetimeTool.test.ts",
      "const mockCwd = '/mock/cwd';",
      2,
    );

    expect(prompt).toContain("failed 2 times");
    expect(prompt).toContain("Do not use it again");
    expect(prompt).toContain("Use the latest read_file result");
    expect(prompt).toContain("exactly one write_file action");
    expect(prompt).toContain("Do not emit read_file, edit_file");
    expect(prompt).toContain("const mockCwd = '/mock/cwd';");
  });
});

describe("buildPrematureVerifyPrompt", () => {
  it("keeps a step alive when verify is emitted before the harness asks", () => {
    const prompt = buildPrematureVerifyPrompt(
      "missing read_file evidence for: package.json",
    );

    expect(prompt).toContain("verify tag while executing a step body");
    expect(prompt).toContain("Only emit verify tags after I send");
    expect(prompt).not.toMatch(/\bhost\b/i);
    expect(prompt).toContain("missing read_file evidence for: package.json");
    expect(prompt).toContain("next required action tag");
  });
});

describe("buildIncompleteStepPrompt", () => {
  it("forces the next action when a step summary lacks required evidence", () => {
    const prompt = buildIncompleteStepPrompt(
      "missing read_file evidence for: src/main/index.ts",
    );

    expect(prompt).toContain("current plan step is not complete");
    expect(prompt).toContain("missing read_file evidence for: src/main/index.ts");
    expect(prompt).toContain("Do not invent tool results");
    expect(prompt).toContain("next required action tag");
    expect(prompt).toContain('reply exactly with <error reason="short reason"/>');
  });
});

describe("buildRepeatedRecoveryReadPrompt", () => {
  it("forces write_file when edit recovery rereads the same file repeatedly", () => {
    const prompt = buildRepeatedRecoveryReadPrompt(
      "tests/main/currentDatetimeTool.test.ts",
    );

    expect(prompt).toContain("recovering from a failed edit_file action");
    expect(prompt).toContain("already been reread");
    expect(prompt).toContain("exactly one write_file action");
    expect(prompt).toContain("Do not emit read_file, edit_file");
  });
});
