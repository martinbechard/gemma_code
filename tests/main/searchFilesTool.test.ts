import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runTool } from "../../src/main/tools";
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
});
