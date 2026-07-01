import { wsRunBash } from "../workspace";
import type { ToolContext, ToolSpec } from "./types";

const GIT_DEFAULT_TIMEOUT_MS = 120_000;

export const gitTool: ToolSpec = {
  name: "git",
  description:
    "Perform git operations in the workspace. Use this for version control tasks like checking status, staging changes, committing, managing branches, and viewing history.",
  params: [
    {
      name: "command",
      description: "The git sub-command to execute (e.g., status, add, commit, branch, log, diff, checkout, merge)",
      required: true,
    },
    {
      name: "args",
      description: "Additional arguments or flags for the command (e.g., '.' for add, '-m \"commit message\"' for commit, or 'main' for checkout)",
      required: false,
    },
  ],
  example: '<action name="git">\n<command>status</command>\n</action>',
  mode: "code",
  run: runGit,
};

async function runGit(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  const command = String(args.command ?? "").trim();
  const gitArgs = String(args.args ?? "").trim();
  const timeout = GIT_DEFAULT_TIMEOUT_MS;

  if (!command) return "Error: missing <command>";

  const fullCommand = `git ${command}${gitArgs ? " " + gitArgs : ""}`;
  
  try {
    const result = await wsRunBash(ctx.conversationId, fullCommand, timeout);
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