import type { BackgroundTaskSnapshot } from "../backgroundTasks";

const PROJECT_SCRIPT_ALLOWED_NAMES = ["build", "test", "dev"] as const;
const PROJECT_SCRIPT_MANAGERS = ["npm", "pnpm"] as const;

type ProjectScriptName = (typeof PROJECT_SCRIPT_ALLOWED_NAMES)[number];
type ProjectScriptManager = (typeof PROJECT_SCRIPT_MANAGERS)[number];

export function projectScriptCommand(script: string, manager: string): string {
  if (!PROJECT_SCRIPT_ALLOWED_NAMES.includes(script as ProjectScriptName)) {
    throw new Error(
      `Unsupported project script "${script}". Allowed: ${PROJECT_SCRIPT_ALLOWED_NAMES.join(", ")}`,
    );
  }
  if (!PROJECT_SCRIPT_MANAGERS.includes(manager as ProjectScriptManager)) {
    throw new Error(
      `Unsupported package manager "${manager}". Allowed: ${PROJECT_SCRIPT_MANAGERS.join(", ")}`,
    );
  }
  return `${manager} run ${script}`;
}

export function formatBackgroundTask(task: BackgroundTaskSnapshot): string {
  const parts = [
    `${task.id} ${task.status} pid=${task.pid ?? "unknown"} command=${task.command}`,
  ];
  if (task.stdout) parts.push("stdout:\n" + task.stdout);
  if (task.stderr) parts.push("stderr:\n" + task.stderr);
  return parts.join("\n");
}
