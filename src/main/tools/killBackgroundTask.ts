import { killBackgroundTask } from "../backgroundTasks";
import { formatBackgroundTask } from "./projectScripts";
import type { ToolSpec } from "./types";

export const killBackgroundTaskTool: ToolSpec = {
  name: "kill_background_task",
  description: "Kill a background task by id.",
  params: [
    {
      name: "id",
      description: "background task id",
      required: true,
    },
  ],
  example:
    '<action name="kill_background_task">\n<id>task-1</id>\n</action>',
  mode: "code",
  run: killBackgroundTaskRunner,
};

async function killBackgroundTaskRunner(
  args: Record<string, unknown>,
): Promise<string> {
  const id = String(args.id ?? "").trim();
  if (!id) return "Error: missing <id>";
  const task = killBackgroundTask(id);
  if (!task) return `Error: background task not found: ${id}`;
  return `Killed background task.\n${formatBackgroundTask(task)}`;
}
