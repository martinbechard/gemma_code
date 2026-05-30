import { ensureWorkspace } from "../workspace";
import type { ToolContext, ToolSpec } from "./types";

export const getCurrentWorkingDirectoryTool: ToolSpec = {
  name: "get_current_working_directory",
  description:
    "Return the active workspace root and the app process current working directory.",
  params: [],
  example: '<action name="get_current_working_directory"></action>',
  mode: "code",
  run: getCurrentWorkingDirectory,
};

async function getCurrentWorkingDirectory(
  _args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  const workspacePath = await ensureWorkspace(ctx.conversationId);
  return [
    `Workspace root: ${workspacePath}`,
    `Process cwd: ${process.cwd()}`,
  ].join("\n");
}
