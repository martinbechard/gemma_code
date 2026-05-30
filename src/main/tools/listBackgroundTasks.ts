import { listBackgroundTasks } from "../backgroundTasks";
import { formatBackgroundTask } from "./projectScripts";
import type { ToolContext, ToolSpec } from "./types";

export const listBackgroundTasksTool: ToolSpec = {
  name: "list_background_tasks",
  description: "List background tasks started in this workspace.",
  params: [],
  example: '<action name="list_background_tasks"></action>',
  mode: "code",
  run: listBackgroundTasksRunner,
};

async function listBackgroundTasksRunner(
  _args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  const tasks = listBackgroundTasks(ctx.conversationId);
  if (tasks.length === 0) return "No background tasks.";
  return tasks.map(formatBackgroundTask).join("\n\n");
}
