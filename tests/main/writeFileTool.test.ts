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
import { runTool } from "../../src/main/tools";
import {
  clearWorkspaceOverride,
  setWorkspaceOverride,
} from "../../src/main/workspace";

const TEST_CONVERSATION_ID = "write-file-tool-test";
const LARGE_SOURCE_TEXT = [
  "import { keep } from './keep';",
  "",
  "export function existingTool(): string {",
  "  return keep();",
  "}",
  "",
].join("\n").repeat(80);

let workspace = "";

afterEach(() => {
  clearWorkspaceOverride(TEST_CONVERSATION_ID);
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
