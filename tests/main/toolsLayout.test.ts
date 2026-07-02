import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TOOLS } from "../../src/main/tools";

const TOOL_SHIM_PATH = join(process.cwd(), "src", "main", "tools.ts");
const TOOL_MODULE_DIR = join(process.cwd(), "src", "main", "tools");
const TOOL_MODULE_NAMES = [
  "calc",
  "deleteFile",
  "editFile",
  "fetchUrl",
  "getCurrentDatetime",
  "getCurrentWorkingDirectory",
  "git",
  "killBackgroundTask",
  "listBackgroundTasks",
  "listFiles",
  "openPreview",
  "readFile",
  "runBash",
  "runProjectScript",
  "searchFiles",
  "uuid",
  "webSearch",
  "writeFile",
] as const;

describe("tools module layout", () => {
  it("keeps each registered tool in its own module", () => {
    expect(readFileSync(TOOL_SHIM_PATH, "utf8").trim()).toBe(
      'export * from "./tools/index";',
    );
    expect(existsSync(join(TOOL_MODULE_DIR, "index.ts"))).toBe(true);
    expect(Object.keys(TOOLS).sort()).toEqual([
      "calc",
      "delete_file",
      "edit_file",
      "fetch_url",
      "generate_uuid",
      "get_current_datetime",
      "get_current_working_directory",
      "git",
      "kill_background_task",
      "list_background_tasks",
      "list_files",
      "open_preview",
      "read_file",
      "run_bash",
      "run_project_script",
      "search_files",
      "web_search",
      "write_file",
    ]);
    for (const moduleName of TOOL_MODULE_NAMES) {
      expect(existsSync(join(TOOL_MODULE_DIR, `${moduleName}.ts`))).toBe(true);
    }
  });
});
