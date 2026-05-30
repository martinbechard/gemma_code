import { startBackgroundTask } from "../backgroundTasks";
import { ensureWorkspace, wsRunBash } from "../workspace";
import {
  formatBackgroundTask,
  projectScriptCommand,
} from "./projectScripts";
import type { ToolContext, ToolSpec } from "./types";

const PROJECT_SCRIPT_DEFAULT_TIMEOUT_MS = 120_000;
const PROJECT_SCRIPT_MAX_TIMEOUT_MS = 300_000;

export const runProjectScriptTool: ToolSpec = {
  name: "run_project_script",
  description:
    "Run an allowed package.json script by name. Allowed scripts: build, test, dev. Package managers: npm, pnpm. Do not use this for exact commands with extra arguments, such as a focused test file path; use run_bash instead.",
  params: [
    {
      name: "script",
      description: "script name: build, test, or dev",
      required: true,
    },
    {
      name: "manager",
      description: "package manager: npm or pnpm",
    },
    {
      name: "timeout_ms",
      description: "timeout in milliseconds",
    },
    {
      name: "background",
      description: "true to leave the script running as a background task",
    },
  ],
  example:
    '<action name="run_project_script">\n<script>build</script>\n<manager>npm</manager>\n</action>',
  mode: "code",
  run: runProjectScript,
};

async function runProjectScript(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  const script = String(args.script ?? "").trim();
  const manager = String(args.manager ?? "npm").trim();
  const background = args.background === true;
  if (!script) return "Error: missing <script>";
  try {
    const command = projectScriptCommand(script, manager);
    if (background) {
      const cwd = await ensureWorkspace(ctx.conversationId);
      const task = startBackgroundTask({
        conversationId: ctx.conversationId,
        command,
        cwd,
      });
      return `Started background task.\n${formatBackgroundTask(task)}`;
    }
    const result = await wsRunBash(
      ctx.conversationId,
      command,
      projectScriptTimeout(args),
    );
    ctx.onFileChange?.();
    const parts: string[] = [];
    parts.push(`command=${command}`);
    parts.push(`exit=${result.exitCode ?? "killed"} (${result.durationMs}ms)`);
    if (result.stdout) parts.push("stdout:\n" + result.stdout);
    if (result.stderr) parts.push("stderr:\n" + result.stderr);
    if (result.truncated) parts.push("[output was truncated]");
    return parts.join("\n");
  } catch (error) {
    return `Error: ${(error as Error).message}`;
  }
}

function projectScriptTimeout(args: Record<string, unknown>): number {
  const requested =
    typeof args.timeout_ms === "number"
      ? args.timeout_ms
      : PROJECT_SCRIPT_DEFAULT_TIMEOUT_MS;
  return Math.min(requested, PROJECT_SCRIPT_MAX_TIMEOUT_MS);
}
