import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { clearFileContextForConversation, runTool } from "../../src/main/tools";
import {
  clearWorkspaceOverride,
  setWorkspaceOverride,
} from "../../src/main/workspace";

const TEST_CONVERSATION_ID = "write-file-tool-test";
const CONTEXT_CONVERSATION_ID = "file-context-tool-test";
const LARGE_SOURCE_TEXT = [
  "import { keep } from './keep';",
  "",
  "export function existingTool(): string {",
  "  return keep();",
  "}",
  "",
].join("\n").repeat(80);
const CONTEXT_SOURCE_PATH = "src/main/context.ts";
const CONTEXT_SOURCE_TEXT = "export const label = 'before';\n";
const CONTEXT_UPDATED_TEXT = "export const label = 'after';\n";

let workspace = "";

afterEach(() => {
  clearWorkspaceOverride(TEST_CONVERSATION_ID);
  clearWorkspaceOverride(CONTEXT_CONVERSATION_ID);
  clearFileContextForConversation(TEST_CONVERSATION_ID);
  clearFileContextForConversation(CONTEXT_CONVERSATION_ID);
  if (workspace) {
    rmSync(workspace, { recursive: true, force: true });
    workspace = "";
  }
});

function createWorkspace(): string {
  workspace = mkdtempSync(join(tmpdir(), "write-file-tool-"));
  setWorkspaceOverride(TEST_CONVERSATION_ID, workspace);
  return workspace;
}

function writeWorkspaceFile(path: string, content: string): void {
  const absolutePath = join(workspace, path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content, "utf8");
}

describe("write_file tool", () => {
  it("blocks destructive overwrites of existing project source files", async () => {
    createWorkspace();
    writeWorkspaceFile("src/main/tools.ts", LARGE_SOURCE_TEXT);

    const result = await runTool(
      "write_file",
      {
        path: "src/main/tools.ts",
        content: "export const get_current_working_directory = {};",
      },
      { conversationId: TEST_CONVERSATION_ID },
    );

    expect(result).toContain("destructive overwrite blocked");
    expect(readFileSync(join(workspace, "src/main/tools.ts"), "utf8")).toBe(
      LARGE_SOURCE_TEXT,
    );
  });

  it("allows creating a new protected project file", async () => {
    createWorkspace();

    const result = await runTool(
      "write_file",
      {
        path: "tests/main/newTool.test.ts",
        content: "import { describe, it } from 'vitest';\n",
      },
      { conversationId: TEST_CONVERSATION_ID },
    );

    expect(result).toContain("Wrote tests/main/newTool.test.ts");
  });
});

describe("edit_file tool", () => {
  it("blocks generic old strings that expand into large snippets in protected files", async () => {
    createWorkspace();
    writeWorkspaceFile(
      "src/main/tools.ts",
      LARGE_SOURCE_TEXT + "\nconst value = undefined;\n",
    );

    const result = await runTool(
      "edit_file",
      {
        path: "src/main/tools.ts",
        old_string: "undefined",
        new_string: [
          "export const get_current_working_directory = {",
          "  name: 'get_current_working_directory',",
          "  description: 'wrong shape',",
          "};",
        ].join("\n").repeat(8),
      },
      { conversationId: TEST_CONVERSATION_ID },
    );

    expect(result).toContain("unsafe edit blocked");
    expect(readFileSync(join(workspace, "src/main/tools.ts"), "utf8")).toBe(
      LARGE_SOURCE_TEXT + "\nconst value = undefined;\n",
    );
  });

  it("rereads the updated file into context after a successful edit", async () => {
    createWorkspace();
    setWorkspaceOverride(CONTEXT_CONVERSATION_ID, workspace);
    writeWorkspaceFile(CONTEXT_SOURCE_PATH, CONTEXT_SOURCE_TEXT);

    const result = await runTool(
      "edit_file",
      {
        path: CONTEXT_SOURCE_PATH,
        old_string: "before",
        new_string: "after",
      },
      { conversationId: CONTEXT_CONVERSATION_ID },
    );

    expect(result).toContain("Edited src/main/context.ts");
    expect(result).toContain("Files in context:");
    expect(result).toContain("- src/main/context.ts");
    expect(result).toContain(CONTEXT_UPDATED_TEXT.trim());
  });
});

describe("read_file tool", () => {
  it("adds read files to the displayed file context list", async () => {
    createWorkspace();
    setWorkspaceOverride(CONTEXT_CONVERSATION_ID, workspace);
    writeWorkspaceFile(CONTEXT_SOURCE_PATH, CONTEXT_SOURCE_TEXT);

    const result = await runTool(
      "read_file",
      { path: CONTEXT_SOURCE_PATH },
      { conversationId: CONTEXT_CONVERSATION_ID },
    );

    expect(result).toContain("Files in context:");
    expect(result).toContain("- src/main/context.ts");
    expect(result).toContain(CONTEXT_SOURCE_TEXT.trim());
  });
});
