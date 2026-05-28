import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isToolErrorResult, runTool } from "../../src/main/tools";
import {
  clearWorkspaceOverride,
  setWorkspaceOverride,
} from "../../src/main/workspace";

const TEST_CONVERSATION_ID = "search-files-tool-test";

let workspace = "";

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "search-files-tool-"));
  setWorkspaceOverride(TEST_CONVERSATION_ID, workspace);
});

afterEach(() => {
  clearWorkspaceOverride(TEST_CONVERSATION_ID);
  rmSync(workspace, { recursive: true, force: true });
});

function writeWorkspaceFile(path: string, content: string): void {
  const absolutePath = join(workspace, path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content, "utf8");
}

describe("search_files tool", () => {
  it("finds literal references while excluding generated directories", async () => {
    writeWorkspaceFile(
      "src/main/tools.ts",
      "export const get_current_working_directory = 'needle';\n",
    );
    writeWorkspaceFile(
      ".gemma-cli/conversations/session.json",
      "get_current_working_directory should be ignored\n",
    );
    writeWorkspaceFile(
      "node_modules/pkg/index.ts",
      "get_current_working_directory should also be ignored\n",
    );

    const result = await runTool(
      "search_files",
      {
        query: "get_current_working_directory",
        path: ".",
        file_glob: "*.ts",
      },
      { conversationId: TEST_CONVERSATION_ID },
    );

    expect(result).toContain("Found 1 match");
    expect(result).toContain("src/main/tools.ts:1:");
    expect(result).not.toContain(".gemma-cli");
    expect(result).not.toContain("node_modules");
  });

  it("reports no matches as usable search evidence", async () => {
    writeWorkspaceFile("src/main/tools.ts", "export const other = true;\n");

    const result = await runTool(
      "search_files",
      { query: "get_current_working_directory", path: "src" },
      { conversationId: TEST_CONVERSATION_ID },
    );

    expect(result).toContain(
      'No matches found for "get_current_working_directory" in src.',
    );
  });

  it("supports path-aware globs without requiring external search binaries", async () => {
    writeWorkspaceFile(
      "src/renderer/Chat.tsx",
      "const get_current_working_directory = true;\n",
    );
    writeWorkspaceFile(
      "tests/renderer/Chat.test.tsx",
      "const get_current_working_directory = false;\n",
    );

    const result = await runTool(
      "search_files",
      {
        query: "get_current_working_directory",
        path: ".",
        file_glob: "src/**/*.tsx",
      },
      { conversationId: TEST_CONVERSATION_ID },
    );

    expect(result).toContain("Found 1 match");
    expect(result).toContain("src/renderer/Chat.tsx:1:");
    expect(result).not.toContain("tests/renderer/Chat.test.tsx");
    expect(result).not.toContain("rg is required");
  });

  it("marks error-looking tool results as tool errors", async () => {
    const result = await runTool(
      "search_files",
      { query: "get_current_working_directory", path: "../outside" },
      { conversationId: TEST_CONVERSATION_ID },
    );

    expect(result).toContain("Error: search_files path must be relative");
    expect(isToolErrorResult(result)).toBe(true);
    expect(isToolErrorResult("No matches found for query in src.")).toBe(false);
  });
});
