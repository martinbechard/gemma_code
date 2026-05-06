import { describe, expect, it } from "vitest";
import {
  buildCodeNoProgressPrompt,
  buildEditFailureRecoveryPrompt,
  buildPlanAmendmentPrompt,
  buildPrematureVerifyPrompt,
  buildRepeatedActionPrompt,
  buildRepeatedEditFailureRecoveryPrompt,
  buildRepeatedRecoveryReadPrompt,
  createPlanInspectionEvidence,
  findPlanTestPaths,
  findRequestedToolNames,
  recordPlanInspectionEvidence,
  type AgentRunOptions,
} from "../../src/cli/agent";

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

    expect(prompt).toContain("one exact tests/main/*.test.ts");
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

    expect(prompt).toContain("emit exactly one YAML plan step");
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
    expect(prompt).toContain("WorkingDirectory");
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

describe("buildPlanAmendmentPrompt", () => {
  it("asks for one additional YAML plan step without more tools", () => {
    const prompt = buildPlanAmendmentPrompt(
      "Plan must include grounding, test, implementation, and verification steps.",
    );

    expect(prompt).toContain("Do not use tools");
    expect(prompt).toContain("one additional well-formed YAML plan step");
    expect(prompt).toContain("name, prompt, and verify");
  });

  it("names the inspected test path when amending a bad test path", () => {
    const prompt = buildPlanAmendmentPrompt(
      "Plan must name the exact tests/main test file path it will create or update.",
      ["tests/main/currentDatetimeTool.test.ts"],
    );

    expect(prompt).toContain(
      "Use the already inspected test path exactly: tests/main/currentDatetimeTool.test.ts.",
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

    expect(prompt).toContain("old_string was not found");
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
