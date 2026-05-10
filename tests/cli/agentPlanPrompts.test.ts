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
  findPlanTestPaths,
  findRequestedToolNames,
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

const hostToolOpts: AgentRunOptions = {
  mode: "code",
  model: "mlx-community/gemma-4-e2b-it-4bit",
  prompt: "Create a tool to obtain the current date time.",
  enableBash: true,
  worktree: true,
};

describe("buildRepeatedActionPrompt", () => {
  it("does not treat failed read_file results as inspected test evidence", () => {
    const evidence = createPlanInspectionEvidence();
    recordPlanInspectionEvidence(
      evidence,
      "read_file",
      { path: "tests/main/exampleTool.test.ts" },
      "Error reading tests/main/exampleTool.test.ts: ENOENT",
    );

    const prompt = buildCodeNoProgressPrompt(hostToolOpts, evidence);

    expect(prompt).toContain("one exact tests/main/currentDatetimeTool.test.ts");
  });

  it("forces the next missing host-tool inspection path after a repeated action", () => {
    const evidence = createPlanInspectionEvidence();
    recordPlanInspectionEvidence(
      evidence,
      "read_file",
      { path: "tests/main/currentDatetimeTool.test.ts" },
      "ok",
    );

    const prompt = buildRepeatedActionPrompt(
      hostToolOpts,
      evidence,
      "read_file",
      2,
    );

    expect(prompt).toContain("src/main/tools.ts");
    expect(prompt).toContain("<action name=\"read_file\">");
    expect(prompt).toContain("<path>src/main/tools.ts</path>");
    expect(prompt).not.toContain("emit exactly one YAML plan step");
  });

  it("falls back to a generic nudge when no host-tool evidence is missing", () => {
    const evidence = createPlanInspectionEvidence();
    for (const path of [
      "src/main/tools.ts",
      "Gemma.md",
      "package.json",
      "tests/main/currentDatetimeTool.test.ts",
    ]) {
      recordPlanInspectionEvidence(evidence, "read_file", { path }, "ok");
    }

    const prompt = buildRepeatedActionPrompt(
      hostToolOpts,
      evidence,
      "read_file",
      2,
    );

    expect(prompt).toContain("move to the next distinct action");
    expect(prompt).toContain("Do not emit a YAML plan");
    expect(prompt).not.toContain("Your next response must be exactly this action tag");
  });

  it("forces a tests/main search when only test evidence is missing", () => {
    const evidence = createPlanInspectionEvidence();
    for (const path of ["src/main/tools.ts", "Gemma.md", "package.json"]) {
      recordPlanInspectionEvidence(evidence, "read_file", { path }, "ok");
    }

    const prompt = buildRepeatedActionPrompt(
      hostToolOpts,
      evidence,
      "read_file",
      2,
    );

    expect(prompt).toContain("<action name=\"run_bash\">");
    expect(prompt).toContain("rg --files tests/main");
    expect(prompt).toContain("currentDatetimeTool.test.ts");
  });
});

describe("buildCodeNoProgressPrompt", () => {
  it("forces src/main/tools.ts as the first host-tool inspection path", () => {
    const evidence = createPlanInspectionEvidence();

    const prompt = buildCodeNoProgressPrompt(hostToolOpts, evidence);

    expect(prompt).toContain("src/main/tools.ts");
    expect(prompt).toContain("<action name=\"read_file\">");
    expect(prompt).toContain("<path>src/main/tools.ts</path>");
  });

  it("recognizes current working directory tool requests", () => {
    const evidence = createPlanInspectionEvidence();
    const prompt = buildCodeNoProgressPrompt(
      {
        ...hostToolOpts,
        prompt:
          "Create get_current_working_directory for the process current working directory.",
      },
      evidence,
    );

    expect(prompt).toContain("<path>src/main/tools.ts</path>");
  });

  it("asks for tests/main discovery when canonical files are already inspected", () => {
    const evidence = createPlanInspectionEvidence();
    for (const path of ["src/main/tools.ts", "Gemma.md", "package.json"]) {
      recordPlanInspectionEvidence(evidence, "read_file", { path }, "ok");
    }

    const prompt = buildCodeNoProgressPrompt(hostToolOpts, evidence);

    expect(prompt).toContain("<action name=\"run_bash\">");
    expect(prompt).toContain("rg --files tests/main");
  });

  it("asks for a YAML plan when all host-tool evidence is already inspected", () => {
    const evidence = createPlanInspectionEvidence();
    for (const path of [
      "src/main/tools.ts",
      "Gemma.md",
      "package.json",
      "tests/main/currentDatetimeTool.test.ts",
    ]) {
      recordPlanInspectionEvidence(evidence, "read_file", { path }, "ok");
    }

    const prompt = buildCodeNoProgressPrompt(hostToolOpts, evidence);

    expect(prompt).toContain("Emit exactly one well-formed YAML plan step");
    expect(prompt).toContain("Do not use tools");
    expect(prompt).not.toContain("<action");
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
      "Plan must include grounding, test, implementation, and verification steps.",
    );

    expect(prompt).toContain("Do not use tools");
    expect(prompt).toContain("one additional well-formed YAML plan step");
    expect(prompt).toContain("name, prompt, and verify");
  });

  it("includes the executable-plan validation gates when amending a rejected plan", () => {
    const prompt = buildPlanAmendmentPrompt(
      "Plan must name the exact tests/main test file path it will create or update.",
    );

    for (const line of EXECUTABLE_PLAN_VALIDATION_GUIDANCE_LINES) {
      expect(prompt).toContain(line);
    }
  });

  it("names the inspected test path when amending a bad test path", () => {
    const prompt = buildPlanAmendmentPrompt(
      "Plan must name the exact tests/main test file path it will create or update.",
      ["tests/main/currentDatetimeTool.test.ts"],
    );

    expect(prompt).toContain(
      "Use the already inspected test path exactly: tests/main/currentDatetimeTool.test.ts.",
    );
    expect(prompt).toContain(
      "Use the focused test command exactly: pnpm test tests/main/currentDatetimeTool.test.ts.",
    );
    expect(prompt).toContain("Do not invent a new test path");
  });

  it("names the requested tool when amending a plan that switched tasks", () => {
    const prompt = buildPlanAmendmentPrompt(
      "Plan switched away from the requested tool name: get_current_working_directory.",
      ["tests/main/currentDatetimeTool.test.ts"],
      ["get_current_working_directory"],
    );

    expect(prompt).toContain(
      "Keep the requested tool name exactly: get_current_working_directory.",
    );
    expect(prompt).toContain("Do not replace it with a different tool name");
    expect(prompt).toContain(
      "Use project instructions and grounded file evidence to derive placement, tests, and commands.",
    );
    expect(prompt).not.toContain("tests/main/currentWorkingDirectoryTool.test.ts");
    expect(prompt).not.toContain(
      "pnpm test tests/main/currentWorkingDirectoryTool.test.ts",
    );
  });

  it("does not inject derived host-tool amendment facts for arbitrary get_current names", () => {
    const prompt = buildPlanAmendmentPrompt(
      "Plan switched away from the requested tool name: get_current_hostname.",
      [],
      ["get_current_hostname"],
    );

    expect(prompt).toContain("get_current_hostname");
    expect(prompt).toContain(
      "Use project instructions and grounded file evidence to derive placement, tests, and commands.",
    );
    expect(prompt).not.toContain("tests/main/currentHostnameTool.test.ts");
    expect(prompt).not.toContain("pnpm test tests/main/currentHostnameTool.test.ts");
    expect(prompt).not.toContain(
      "Apply the get_current_ host-tool planning convention from the plan system prompt.",
    );
  });

  it("requires exact missing commands in both prompt and verify fields", () => {
    const prompt = buildPlanAmendmentPrompt(
      "Plan must name the exact test command it will run.",
    );

    expect(prompt).toContain(
      "The new step's prompt and verify fields must both contain each exact missing command or file path text.",
    );
    expect(prompt).toContain(
      "Do not return plan: done; the assembled plan did not pass validation yet.",
    );
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

describe("findRequestedToolNames", () => {
  it("extracts requested get_current tool names from the prompt", () => {
    expect(
      findRequestedToolNames(
        "Name the tool get_current_working_directory, not a generic one.",
      ),
    ).toEqual(["get_current_working_directory"]);
  });

  it("infers the current working directory tool name from plain language", () => {
    expect(
      findRequestedToolNames(
        "create a new LLM tool to retrieve the current working directory",
      ),
    ).toEqual(["get_current_working_directory"]);
  });
});

describe("findPlanTestPaths", () => {
  it("extracts normalized tests/main test paths from a plan", () => {
    expect(
      findPlanTestPaths(
        "Run pnpm test tests//main/currentDatetimeTool.test.ts and read tests/main/currentDatetimeTool.test.ts.",
      ),
    ).toEqual(["tests/main/currentDatetimeTool.test.ts"]);
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
  it("keeps a step alive when verify is emitted before the host asks", () => {
    const prompt = buildPrematureVerifyPrompt(
      "missing read_file evidence for: package.json",
    );

    expect(prompt).toContain("verify tag while executing a step body");
    expect(prompt).toContain("Only emit verify tags after the host sends");
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
