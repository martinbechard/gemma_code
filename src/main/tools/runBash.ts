import { wsRunBash } from "../workspace";
import type { ToolContext, ToolSpec } from "./types";

const RUN_BASH_DEFAULT_TIMEOUT_MS = 60_000;

export const runBashTool: ToolSpec = {
  name: "run_bash",
  description:
    "Run a bash command inside the workspace directory. Use for exact commands with arguments, npm install, git, formatters, and quick checks.",
  params: [
    {
      name: "command",
      description: "shell command",
      required: true,
      multiline: true,
    },
  ],
  example: '<action name="run_bash">\n<command>ls -la</command>\n</action>',
  mode: "code",
  run: runBash,
};

async function runBash(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  const command = String(args.command ?? "").trim();
  const timeout =
    typeof args.timeout_ms === "number"
      ? args.timeout_ms
      : RUN_BASH_DEFAULT_TIMEOUT_MS;
  if (!command) return "Error: missing <command>";
  try {
    const result = await wsRunBash(ctx.conversationId, command, timeout);
    ctx.onFileChange?.();
    const parts: string[] = [];
    parts.push(`exit=${result.exitCode ?? "killed"} (${result.durationMs}ms)`);
    if (result.stdout) parts.push("stdout:\n" + result.stdout);
    if (result.stderr) parts.push("stderr:\n" + result.stderr);
    if (result.truncated) parts.push("[output was truncated]");
    return parts.join("\n");
  } catch (error) {
    return `Error: ${(error as Error).message}`;
  }
}
