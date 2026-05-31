import { describe, expect, it } from "vitest";
import {
  createPlanStepEvidence,
  forcedVerifyFailureReason,
  hasGuardedAlreadyPresentEvidence,
  hasSatisfiedReadOnlyStepEvidence,
  hasSuccessfulRequiredCommandEvidence,
  isContradictedBySuccessfulEvidence,
  isMalformedActionSelfReport,
  isRecoverableEditFailureResult,
  parseBlockedReason,
  parseStepSummary,
  recordPlanToolEvidence,
  repeatedActionForcedFailureReason,
} from "../../../src/main/plan/evidence";

describe("plan step evidence", () => {
  it("blocks a verify pass when a step gathered no tool evidence", () => {
    const evidence = createPlanStepEvidence();

    expect(
      forcedVerifyFailureReason("The file was changed.", evidence),
    ).toContain("no tool evidence");
  });

  it("treats missing-result verify reasons as contradicted by successful search evidence", () => {
    const evidence = createPlanStepEvidence();
    recordPlanToolEvidence(
      evidence,
      "search_files",
      'Found 1 match for "current working directory" in src.\nsrc/main/tools.ts:785: "Return the active workspace root and the app process current working directory."',
      {
        query: "current working directory",
        path: "src",
      },
    );

    expect(
      isContradictedBySuccessfulEvidence(
        "The search results are not yet available to confirm the artifact has been identified.",
        "A specific artifact responsible for the CWD retrieval function has been identified.",
        evidence,
      ),
    ).toBe(true);
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

  it("blocks mutation steps when only read evidence was gathered", () => {
    const evidence = createPlanStepEvidence();

    recordPlanToolEvidence(
      evidence,
      "read_file",
      "function getCurrentWorkingDirectory() {}",
      { path: "src/main/tools.ts" },
    );

    expect(
      forcedVerifyFailureReason(
        'Remove the identified code implementing the "LLM tool to get the current working directory" from the codebase.\nThe code implementing the "LLM tool to get the current working directory" has been successfully removed from the application files.',
        evidence,
      ),
    ).toContain("missing mutation evidence");
  });

  it("blocks removal steps without post-mutation absence evidence", () => {
    const evidence = createPlanStepEvidence();

    recordPlanToolEvidence(
      evidence,
      "edit_file",
      "Edited src/main/tools.ts (2 replacements).",
      { path: "src/main/tools.ts" },
    );

    expect(
      forcedVerifyFailureReason(
        "Remove get_current_working_directory from the application files.",
        evidence,
      ),
    ).toContain("missing post-mutation absence evidence");
  });

  it("accepts removal steps with a post-mutation no-match search", () => {
    const evidence = createPlanStepEvidence();

    recordPlanToolEvidence(
      evidence,
      "write_file",
      "Error writing src/main/tools/index.ts: destructive overwrite blocked.",
      { path: "src/main/tools/index.ts" },
    );
    recordPlanToolEvidence(
      evidence,
      "edit_file",
      "Edited src/main/tools.ts (2 replacements).",
      { path: "src/main/tools.ts" },
    );
    recordPlanToolEvidence(
      evidence,
      "search_files",
      'No matches found for "get_current_working_directory" in src.',
      { query: "get_current_working_directory", path: "src" },
    );

    expect(
      forcedVerifyFailureReason(
        "Remove get_current_working_directory from the application files.",
        evidence,
      ),
    ).toBeNull();
  });

  it("blocks removal steps when a post-mutation search still finds the removed term in an affected file", () => {
    const evidence = createPlanStepEvidence();

    recordPlanToolEvidence(
      evidence,
      "edit_file",
      "Edited src/main/tools/index.ts (1 replacement).",
      { path: "src/main/tools/index.ts" },
    );
    recordPlanToolEvidence(
      evidence,
      "search_files",
      [
        'Found 2 matches for "get_current_working_directory" in src/main/tools.',
        "src/main/tools/index.ts:43:  get_current_working_directory: getCurrentWorkingDirectoryTool,",
        'src/main/tools/searchFiles.ts:56:    \'<action name="search_files">\\n<query>get_current_working_directory</query>\'',
      ].join("\n"),
      { query: "get_current_working_directory", path: "src/main/tools" },
    );

    expect(
      forcedVerifyFailureReason(
        "src/main/tools/index.ts no longer references get_current_working_directory.",
        evidence,
      ),
    ).toContain(
      'post-mutation search still found removed term "get_current_working_directory" in src/main/tools/index.ts',
    );
  });

  it("blocks removal verification when a refreshed file still contains the camelCase tool symbol", () => {
    const evidence = createPlanStepEvidence();

    recordPlanToolEvidence(
      evidence,
      "edit_file",
      [
        "Edited src/main/tools/index.ts (1 replacement).",
        "",
        "Files in context:",
        "- src/main/tools/index.ts",
        "",
        "Current file: src/main/tools/index.ts",
        "// getCurrentWorkingDirectoryTool removed",
        "export const TOOLS = {",
        "  get_current_working_directory: getCurrentWorkingDirectoryTool,",
        "};",
      ].join("\n"),
      { path: "src/main/tools/index.ts" },
    );

    expect(
      forcedVerifyFailureReason(
        "Remove usage of getCurrentWorkingDirectoryTool in src/main/tools/index.ts. src/main/tools/index.ts no longer references getCurrentWorkingDirectoryTool.",
        evidence,
      ),
    ).toContain("getCurrentWorkingDirectoryTool");
  });

  it("reports missing final removal evidence instead of failing only because an earlier write failed", () => {
    const evidence = createPlanStepEvidence();

    recordPlanToolEvidence(
      evidence,
      "write_file",
      "Wrote src/main/tools/getCurrentWorkingDirectory.ts (0 bytes, 1 lines).",
      { path: "src/main/tools/getCurrentWorkingDirectory.ts" },
    );
    recordPlanToolEvidence(
      evidence,
      "write_file",
      "Error writing src/main/tools/index.ts: destructive overwrite blocked.",
      { path: "src/main/tools/index.ts" },
    );
    recordPlanToolEvidence(
      evidence,
      "read_file",
      "import { getCurrentWorkingDirectoryTool } from './getCurrentWorkingDirectory';",
      { path: "src/main/tools/index.ts" },
    );

    expect(
      forcedVerifyFailureReason(
        'The code implementing the "LLM tool to get the current working directory" has been successfully removed from the application files.',
        evidence,
      ),
    ).toContain("missing post-mutation absence evidence");
  });

  it("accepts current-working-directory removal after post-mutation read absence", () => {
    const evidence = createPlanStepEvidence();

    recordPlanToolEvidence(
      evidence,
      "write_file",
      "Wrote src/main/tools.ts (100 bytes, 5 lines).",
      { path: "src/main/tools.ts" },
    );
    recordPlanToolEvidence(
      evidence,
      "read_file",
      "export const tools = { get_current_datetime: {} };",
      { path: "src/main/tools.ts" },
    );

    expect(
      forcedVerifyFailureReason(
        'The code implementing the "LLM tool to get the current working directory" has been successfully removed from the application files.',
        evidence,
      ),
    ).toBeNull();
  });

  it("accepts exact file deletion evidence without requiring repository-wide symbol absence", () => {
    const evidence = createPlanStepEvidence();

    recordPlanToolEvidence(
      evidence,
      "delete_file",
      "Deleted src/main/tools/getCurrentWorkingDirectory.ts.",
      { path: "src/main/tools/getCurrentWorkingDirectory.ts" },
    );

    expect(
      forcedVerifyFailureReason(
        "The file src/main/tools/getCurrentWorkingDirectory.ts is deleted from the workspace.",
        evidence,
      ),
    ).toBeNull();
  });

  it("ignores file-context paths when checking post-mutation read absence", () => {
    const evidence = createPlanStepEvidence();

    recordPlanToolEvidence(
      evidence,
      "delete_file",
      "Deleted src/main/tools/getCurrentWorkingDirectory.ts.",
      { path: "src/main/tools/getCurrentWorkingDirectory.ts" },
    );
    recordPlanToolEvidence(
      evidence,
      "edit_file",
      [
        "Edited src/main/tools/index.ts (1 replacement).",
        "",
        "Files in context:",
        "- src/main/tools/getCurrentWorkingDirectory.ts",
        "- src/main/tools/index.ts",
        "",
        "Current file: src/main/tools/index.ts",
        "export const tools = { get_current_datetime: {} };",
      ].join("\n"),
      { path: "src/main/tools/index.ts" },
    );
    recordPlanToolEvidence(
      evidence,
      "read_file",
      [
        "Files in context:",
        "- src/main/tools/getCurrentWorkingDirectory.ts",
        "- src/main/tools/index.ts",
        "",
        "Current file: src/main/tools/index.ts",
        "export const tools = { get_current_datetime: {} };",
      ].join("\n"),
      { path: "src/main/tools/index.ts" },
    );

    expect(
      forcedVerifyFailureReason(
        "src/main/tools/getCurrentWorkingDirectory.ts is deleted, and src/main/tools/index.ts no longer references the current working directory functionality.",
        evidence,
      ),
    ).toBeNull();
  });

  it("accepts removal evidence from refreshed write_file content", () => {
    const evidence = createPlanStepEvidence();

    recordPlanToolEvidence(
      evidence,
      "write_file",
      [
        "Wrote src/main/tools/index.ts (100 bytes, 5 lines).",
        "",
        "Files in context:",
        "- src/main/tools/index.ts",
        "",
        "Current file: src/main/tools/index.ts",
        "export const tools = { get_current_datetime: {} };",
      ].join("\n"),
      { path: "src/main/tools/index.ts" },
    );

    expect(
      forcedVerifyFailureReason(
        'The code implementing the "LLM tool to get the current working directory" has been successfully removed from the application files.',
        evidence,
      ),
    ).toBeNull();
  });

  it("does not accept truncated read output as removal absence evidence", () => {
    const evidence = createPlanStepEvidence();

    recordPlanToolEvidence(
      evidence,
      "write_file",
      "Wrote src/main/tools.ts (100 bytes, 5 lines).",
      { path: "src/main/tools.ts" },
    );
    recordPlanToolEvidence(
      evidence,
      "read_file",
      "export const tools = {};\n[…truncated]",
      { path: "src/main/tools.ts" },
    );

    expect(
      forcedVerifyFailureReason(
        'The code implementing the "LLM tool to get the current working directory" has been successfully removed from the application files.',
        evidence,
      ),
    ).toContain("missing post-mutation absence evidence");
  });

  it("does not accept unrelated file reads as removal absence evidence", () => {
    const evidence = createPlanStepEvidence();

    recordPlanToolEvidence(
      evidence,
      "edit_file",
      "Edited src/main/tools.ts (2 replacements).",
      { path: "src/main/tools.ts" },
    );
    recordPlanToolEvidence(
      evidence,
      "read_file",
      "export const unrelated = true;",
      { path: "src/main/index.ts" },
    );

    expect(
      forcedVerifyFailureReason(
        "Remove get_current_working_directory from src/main/tools.ts.",
        evidence,
      ),
    ).toContain("missing post-mutation absence evidence");
  });

  it("allows non-removal mutation criteria after a successful mutation", () => {
    const evidence = createPlanStepEvidence();

    recordPlanToolEvidence(
      evidence,
      "write_file",
      "Wrote src/main/tools.ts (100 bytes, 5 lines).",
      { path: "src/main/tools.ts" },
    );

    expect(
      forcedVerifyFailureReason("src/main/tools.ts has been updated.", evidence),
    ).toBeNull();
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

  it("recognizes stale malformed-action self reports", () => {
    expect(
      isMalformedActionSelfReport("Previous action tag was not properly closed"),
    ).toBe(true);
    expect(isMalformedActionSelfReport("focused test failed")).toBe(false);
  });

  it("parses explicit blocked step responses", () => {
    expect(parseBlockedReason("BLOCKED: missing list_files result")).toBe(
      "missing list_files result",
    );
    expect(
      parseBlockedReason("BLOCKED: missing\nlist_files result"),
    ).toBe("missing list_files result");
    expect(parseBlockedReason('<error reason="missing list_files result"/>')).toBe(
      "missing list_files result",
    );
    expect(parseBlockedReason("<error>missing\nlist_files result</error>")).toBe(
      "missing list_files result",
    );
    expect(parseBlockedReason("I am blocked because the result is missing")).toBeNull();
  });

  it("parses bounded step summaries", () => {
    expect(
      parseStepSummary("<summary>Read src/main/tools.ts.\nRemoved the stale tool.\nRan tests.</summary>"),
    ).toEqual({
      kind: "summary",
      text: "Read src/main/tools.ts.\nRemoved the stale tool.\nRan tests.",
    });
    expect(parseStepSummary("plain summary")).toBeNull();
    expect(parseStepSummary("<summary>one\n\ntwo\nthree\nfour</summary>")).toEqual({
      kind: "invalid",
      reason: "summary exceeds 3 lines",
    });
  });

  it("detects guarded existing tool evidence after reading required files", () => {
    const evidence = createPlanStepEvidence();
    const criterion = [
      "Read src/main/tools.ts and Gemma.md, add get_current_working_directory only if missing,",
      "and avoid editing those files if get_current_working_directory is already present.",
    ].join(" ");

    recordPlanToolEvidence(
      evidence,
      "read_file",
      "export const tools = { get_current_working_directory: {} };",
      { path: "src/main/tools.ts" },
    );
    expect(hasGuardedAlreadyPresentEvidence(criterion, evidence)).toBe(false);

    recordPlanToolEvidence(
      evidence,
      "read_file",
      "### get_current_working_directory",
      { path: "Gemma.md" },
    );
    expect(hasGuardedAlreadyPresentEvidence(criterion, evidence)).toBe(true);
  });

  it("treats guarded existing tool evidence as contradicting a missing-presence verify failure", () => {
    const evidence = createPlanStepEvidence();
    const criterion = [
      "Read src/main/tools.ts and Gemma.md, add get_current_working_directory only if missing,",
      "and avoid editing those files if get_current_working_directory is already present.",
    ].join(" ");

    recordPlanToolEvidence(
      evidence,
      "read_file",
      "get_current_working_directory",
      { path: "src/main/tools.ts" },
    );
    recordPlanToolEvidence(evidence, "read_file", "get_current_working_directory", {
      path: "Gemma.md",
    });

    expect(
      isContradictedBySuccessfulEvidence(
        "Could not confirm presence of get_current_working_directory in src/main/tools.ts and Gemma.md",
        criterion,
        evidence,
      ),
    ).toBe(true);
  });

  it("treats direct contains criteria as satisfied by exact tool evidence", () => {
    const evidence = createPlanStepEvidence();
    const criterion =
      "src/main/tools.ts and Gemma.md contain get_current_working_directory";

    recordPlanToolEvidence(evidence, "read_file", "get_current_working_directory", {
      path: "src/main/tools.ts",
    });
    recordPlanToolEvidence(evidence, "read_file", "get_current_working_directory", {
      path: "Gemma.md",
    });

    expect(hasGuardedAlreadyPresentEvidence(criterion, evidence)).toBe(true);
    expect(
      isContradictedBySuccessfulEvidence(
        "Could not confirm presence of get_current_working_directory in src/main/tools.ts and Gemma.md",
        criterion,
        evidence,
      ),
    ).toBe(true);
  });

  it("requires exact file evidence for inspected criteria", () => {
    const evidence = createPlanStepEvidence();
    const criterion = "src/main/tools.ts and Gemma.md have been inspected.";

    recordPlanToolEvidence(evidence, "read_file", "tools content", {
      path: "src/main/tools.ts",
    });
    expect(forcedVerifyFailureReason(criterion, evidence)).toContain(
      "missing file evidence for: Gemma.md",
    );

    recordPlanToolEvidence(evidence, "read_file", "gemma content", {
      path: "Gemma.md",
    });
    expect(forcedVerifyFailureReason(criterion, evidence)).toBeNull();
  });

  it("requires exact file evidence for reading or inspection criteria", () => {
    const evidence = createPlanStepEvidence();
    const criterion =
      "The reading or inspection of src/main/tools.ts and Gemma.md has been completed.";

    recordPlanToolEvidence(evidence, "read_file", "tools content", {
      path: "src/main/tools.ts",
    });
    expect(forcedVerifyFailureReason(criterion, evidence)).toContain(
      "missing file evidence for: Gemma.md",
    );

    recordPlanToolEvidence(evidence, "read_file", "gemma content", {
      path: "Gemma.md",
    });
    expect(forcedVerifyFailureReason(criterion, evidence)).toBeNull();
  });

  it("detects verify failures contradicted by successful command evidence", () => {
    const evidence = createPlanStepEvidence();
    const command = "pnpm test tests/main/currentWorkingDirectoryTool.test.ts";
    recordPlanToolEvidence(
      evidence,
      "run_bash",
      "exit=0 (1000ms)\nstdout:\npassed",
      { command },
    );

    expect(
      isContradictedBySuccessfulEvidence(
        command + " did not return expected results or failed to execute successfully.",
        command + " passes.",
        evidence,
      ),
    ).toBe(true);
  });

  it("detects successful required command evidence including bare test commands", () => {
    const evidence = createPlanStepEvidence();
    recordPlanToolEvidence(
      evidence,
      "run_bash",
      "exit=0 (1000ms)\nstdout:\npassed",
      { command: "pnpm test" },
    );
    recordPlanToolEvidence(
      evidence,
      "run_bash",
      "exit=0 (1000ms)\nstdout:\nbuilt",
      { command: "pnpm run build" },
    );

    expect(
      hasSuccessfulRequiredCommandEvidence(
        "pnpm test and pnpm run build pass.",
        evidence,
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
      "missing file evidence for: Gemma.md, package.json, tests/main/currentDatetimeTool.test.ts",
    );
  });

  it("blocks a step summary when a listed path has not been read yet", () => {
    const evidence = createPlanStepEvidence();

    recordPlanToolEvidence(evidence, "read_file", "tools source", {
      path: "src/main/tools.ts",
    });

    expect(
      forcedVerifyFailureReason(
        "List src/main/tools.ts and src/main/index.ts.",
        evidence,
      ),
    ).toContain("missing file evidence for: src/main/index.ts");
  });

  it("accepts list_files evidence for listed directories", () => {
    const evidence = createPlanStepEvidence();

    recordPlanToolEvidence(evidence, "list_files", "src/cli/agent.ts", {
      path: "src/cli",
    });
    recordPlanToolEvidence(evidence, "list_files", "src/main/tools.ts", {
      path: "src/main",
    });
    recordPlanToolEvidence(evidence, "read_file", "agent source", {
      path: "src/cli/agent.ts",
    });

    expect(
      forcedVerifyFailureReason(
        "The listing of src/cli and src/main has been retrieved and the contents of src/cli/agent.ts has been read.",
        evidence,
      ),
    ).toBeNull();
  });

  it("accepts workspace tree output from list_files as listed path evidence", () => {
    const evidence = createPlanStepEvidence();

    recordPlanToolEvidence(
      evidence,
      "list_files",
      [
        "src/",
        "src/main/",
        "src/main/index.ts (71754B)",
        "src/main/tools.ts (32171B)",
      ].join("\n"),
    );

    expect(
      forcedVerifyFailureReason(
        "List src/main/index.ts and src/main/tools.ts.",
        evidence,
      ),
    ).toBeNull();
  });

  it("recognizes completed read-only listing steps", () => {
    const evidence = createPlanStepEvidence();

    recordPlanToolEvidence(
      evidence,
      "list_files",
      [
        "src/",
        "src/main/",
        "src/main/index.ts (71754B)",
        "src/main/tools.ts (32171B)",
      ].join("\n"),
    );

    expect(
      hasSatisfiedReadOnlyStepEvidence(
        "List src/main/index.ts and src/main/tools.ts for inspection.",
        evidence,
      ),
    ).toBe(true);
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
        "> gemma-code@0.1.0 build",
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
    ).toContain("missing successful command evidence for: pnpm run build");
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

  it("accepts npm and pnpm build script commands as equivalent", () => {
    const evidence = createPlanStepEvidence();

    recordPlanToolEvidence(
      evidence,
      "run_project_script",
      ["command=npm run build", "exit=0 (1000ms)", "stdout:", "built"].join(
        "\n",
      ),
    );

    expect(
      forcedVerifyFailureReason("pnpm run build passes.", evidence),
    ).toBeNull();
  });

  it("requires the exact focused test command named by the criterion", () => {
    const evidence = createPlanStepEvidence();

    recordPlanToolEvidence(
      evidence,
      "run_project_script",
      [
        "command=pnpm run test",
        "exit=0 (1000ms)",
        "stdout:",
        "all tests passed",
      ].join("\n"),
    );

    expect(
      forcedVerifyFailureReason(
        "pnpm test tests/main/currentWorkingDirectoryTool.test.ts passes.",
        evidence,
      ),
    ).toContain(
      "missing successful command evidence for: pnpm test tests/main/currentWorkingDirectoryTool.test.ts",
    );
  });

  it("allows the exact focused test command when run_bash succeeds", () => {
    const evidence = createPlanStepEvidence();

    recordPlanToolEvidence(
      evidence,
      "run_bash",
      "exit=0 stdout: pass",
      { command: "pnpm test tests/main/currentWorkingDirectoryTool.test.ts" },
    );

    expect(
      forcedVerifyFailureReason(
        "pnpm test tests/main/currentWorkingDirectoryTool.test.ts passes.",
        evidence,
      ),
    ).toBeNull();
  });

  it("allows exact test commands outside tests/main when run_bash succeeds", () => {
    const evidence = createPlanStepEvidence();

    recordPlanToolEvidence(
      evidence,
      "run_bash",
      "exit=0 stdout: pass",
      { command: "npm test tests/renderer/components/Message.test.ts" },
    );

    expect(
      forcedVerifyFailureReason(
        "npm test tests/renderer/components/Message.test.ts passes.",
        evidence,
      ),
    ).toBeNull();
  });

  it("allows required exact commands when a successful run_bash command chains them", () => {
    const evidence = createPlanStepEvidence();

    recordPlanToolEvidence(
      evidence,
      "run_bash",
      "exit=0 stdout: pass",
      {
        command:
          "pnpm test tests/main/currentWorkingDirectoryTool.test.ts && pnpm run build",
      },
    );

    expect(
      forcedVerifyFailureReason(
        "pnpm test tests/main/currentWorkingDirectoryTool.test.ts and pnpm run build pass.",
        evidence,
      ),
    ).toBeNull();
  });

  it("allows a required exact command after an unrelated failed command", () => {
    const evidence = createPlanStepEvidence();

    recordPlanToolEvidence(
      evidence,
      "run_project_script",
      [
        "command=pnpm run test",
        "exit=1 (1000ms)",
        "stdout:",
        "unrelated full suite failure",
      ].join("\n"),
    );
    recordPlanToolEvidence(
      evidence,
      "run_bash",
      "exit=0 stdout: pass",
      { command: "pnpm test tests/main/currentWorkingDirectoryTool.test.ts" },
    );

    expect(
      forcedVerifyFailureReason(
        "pnpm test tests/main/currentWorkingDirectoryTool.test.ts passes.",
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

  it("turns a repeated failed command into a forced step-attempt failure", () => {
    const evidence = createPlanStepEvidence();

    recordPlanToolEvidence(evidence, "run_bash", "exit=1 stdout: failed");

    expect(
      repeatedActionForcedFailureReason({
        actionName: "run_bash",
        repeatedActionCount: 2,
        criterion: "pnpm test tests/main/tools.test.ts passes.",
        evidence,
      }),
    ).toContain("repeated run_bash action after unresolved failure");
  });
});
