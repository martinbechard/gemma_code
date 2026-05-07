import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { codeSystemPrompt, runTool } from "../../src/main/tools";
import {
  clearWorkspaceOverride,
  setWorkspaceOverride,
} from "../../src/main/workspace";

const TEST_CONVERSATION_ID = "current-working-directory-tool-test";

let workspacePath = "";

beforeEach(() => {
  workspacePath = mkdtempSync(join(tmpdir(), "current-working-directory-"));
  setWorkspaceOverride(TEST_CONVERSATION_ID, workspacePath);
});

afterEach(() => {
  clearWorkspaceOverride(TEST_CONVERSATION_ID);
  rmSync(workspacePath, { recursive: true, force: true });
});

describe("get_current_working_directory tool", () => {
  it("returns the workspace root and process current working directory", async () => {
    const result = await runTool(
      "get_current_working_directory",
      {},
      { conversationId: TEST_CONVERSATION_ID },
    );

    expect(result).toContain(`Workspace root: ${workspacePath}`);
    expect(result).toContain(`Process cwd: ${process.cwd()}`);
  });

  it("is advertised in code system prompts", () => {
    expect(codeSystemPrompt("/tmp/workspace", "http://127.0.0.1")).toContain(
      "### get_current_working_directory",
    );
  });
});
