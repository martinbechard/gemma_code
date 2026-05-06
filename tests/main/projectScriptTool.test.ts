import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { runTool, projectScriptCommand } from "../../src/main/tools";
import {
  clearWorkspaceOverride,
  setWorkspaceOverride,
} from "../../src/main/workspace";
import { clearBackgroundTaskRegistry } from "../../src/main/backgroundTasks";
import type { ToolContext } from "../../src/main/tools";

const TEST_CONVERSATION_ID = "project-script-tool-test";

let workspace = "";

afterEach(() => {
  clearBackgroundTaskRegistry();
  clearWorkspaceOverride(TEST_CONVERSATION_ID);
  if (workspace) {
    rmSync(workspace, { recursive: true, force: true });
    workspace = "";
  }
});

function createWorkspace(packageJson: string): ToolContext {
  workspace = mkdtempSync(join(tmpdir(), "project-script-tool-"));
  writeFileSync(join(workspace, "package.json"), packageJson, "utf8");
  setWorkspaceOverride(TEST_CONVERSATION_ID, workspace);
  return { conversationId: TEST_CONVERSATION_ID };
}

describe("projectScriptCommand", () => {
  it("builds npm run commands for allowed scripts", () => {
    expect(projectScriptCommand("build", "npm")).toBe("npm run build");
    expect(projectScriptCommand("test", "npm")).toBe("npm run test");
    expect(projectScriptCommand("dev", "npm")).toBe("npm run dev");
  });

  it("builds pnpm run commands for allowed scripts", () => {
    expect(projectScriptCommand("build", "pnpm")).toBe("pnpm run build");
  });

  it("rejects script names outside the allowlist", () => {
    expect(() => projectScriptCommand("lint", "npm")).toThrow(
      "Unsupported project script",
    );
  });

  it("rejects unsupported package managers", () => {
    expect(() => projectScriptCommand("build", "yarn")).toThrow(
      "Unsupported package manager",
    );
  });
});

describe("run_project_script tool", () => {
  it("runs an allowed npm package script in the workspace", async () => {
    const ctx = createWorkspace(
      JSON.stringify({
        scripts: {
          build: "node -e \"process.stdout.write('build-ok')\"",
        },
      }),
    );

    const result = await runTool(
      "run_project_script",
      { script: "build", manager: "npm" },
      ctx,
    );

    expect(result).toContain("command=npm run build");
    expect(result).toContain("exit=0");
    expect(result).toContain("build-ok");
  });

  it("does not run unsupported scripts", async () => {
    const ctx = createWorkspace(
      JSON.stringify({
        scripts: {
          lint: "node -e \"process.stdout.write('should-not-run')\"",
        },
      }),
    );

    const result = await runTool(
      "run_project_script",
      { script: "lint", manager: "npm" },
      ctx,
    );

    expect(result).toContain("Unsupported project script");
    expect(result).not.toContain("should-not-run");
  });

  it("can start, list, and kill a package script background task", async () => {
    const ctx = createWorkspace(
      JSON.stringify({
        scripts: {
          dev: "node -e \"setInterval(() => {}, 1000)\"",
        },
      }),
    );

    const started = await runTool(
      "run_project_script",
      { script: "dev", manager: "npm", background: true },
      ctx,
    );
    const id = started.match(/task-\d+/)?.[0];

    expect(started).toContain("Started background task");
    expect(id).toBeDefined();

    const listed = await runTool("list_background_tasks", {}, ctx);
    expect(listed).toContain(id);
    expect(listed).toContain("running");

    const killed = await runTool("kill_background_task", { id }, ctx);
    expect(killed).toContain("Killed background task");
    expect(killed).toContain(id);
  });
});
