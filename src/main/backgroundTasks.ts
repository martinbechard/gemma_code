import { spawn, type ChildProcessWithoutNullStreams } from "child_process";

const BACKGROUND_TASK_OUTPUT_LIMIT = 16_000;

export type BackgroundTaskStatus = "running" | "exited" | "killed" | "error";

export interface BackgroundTaskSnapshot {
  id: string;
  conversationId: string;
  command: string;
  cwd: string;
  pid?: number;
  status: BackgroundTaskStatus;
  exitCode: number | null;
  startedAt: number;
  endedAt?: number;
  stdout: string;
  stderr: string;
}

interface BackgroundTaskRecord extends BackgroundTaskSnapshot {
  process: ChildProcessWithoutNullStreams;
}

const tasks = new Map<string, BackgroundTaskRecord>();
let nextTaskId = 1;

export function startBackgroundTask(input: {
  conversationId: string;
  command: string;
  cwd: string;
}): BackgroundTaskSnapshot {
  const id = `task-${nextTaskId++}`;
  const proc = spawn("/bin/bash", ["-lc", input.command], {
    cwd: input.cwd,
    env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
    detached: true,
  });
  const record: BackgroundTaskRecord = {
    id,
    conversationId: input.conversationId,
    command: input.command,
    cwd: input.cwd,
    pid: proc.pid,
    status: "running",
    exitCode: null,
    startedAt: Date.now(),
    stdout: "",
    stderr: "",
    process: proc,
  };
  tasks.set(id, record);

  proc.stdout.on("data", (chunk: Buffer) => {
    record.stdout = appendLimited(record.stdout, chunk.toString("utf8"));
  });
  proc.stderr.on("data", (chunk: Buffer) => {
    record.stderr = appendLimited(record.stderr, chunk.toString("utf8"));
  });
  proc.on("error", (err) => {
    record.status = "error";
    record.endedAt = Date.now();
    record.stderr = appendLimited(record.stderr, String(err));
  });
  proc.on("close", (code) => {
    if (record.status === "running") {
      record.status = "exited";
    }
    record.exitCode = code;
    record.endedAt = Date.now();
  });

  return snapshot(record);
}

export function listBackgroundTasks(
  conversationId?: string,
): BackgroundTaskSnapshot[] {
  return Array.from(tasks.values())
    .filter((task) => !conversationId || task.conversationId === conversationId)
    .map(snapshot);
}

export function killBackgroundTask(id: string): BackgroundTaskSnapshot | null {
  const task = tasks.get(id);
  if (!task) return null;
  if (task.status === "running") {
    task.status = "killed";
    task.endedAt = Date.now();
    if (task.pid) {
      try {
        process.kill(-task.pid, "SIGTERM");
      } catch {
        task.process.kill("SIGTERM");
      }
    } else {
      task.process.kill("SIGTERM");
    }
  }
  return snapshot(task);
}

export function killBackgroundTasksForConversation(
  conversationId: string,
): BackgroundTaskSnapshot[] {
  return listBackgroundTasks(conversationId)
    .filter((task) => task.status === "running")
    .map((task) => killBackgroundTask(task.id))
    .filter((task): task is BackgroundTaskSnapshot => task !== null);
}

export function killAllBackgroundTasks(): BackgroundTaskSnapshot[] {
  return listBackgroundTasks()
    .filter((task) => task.status === "running")
    .map((task) => killBackgroundTask(task.id))
    .filter((task): task is BackgroundTaskSnapshot => task !== null);
}

export function clearBackgroundTaskRegistry(): void {
  killAllBackgroundTasks();
  tasks.clear();
}

function appendLimited(current: string, next: string): string {
  const combined = current + next;
  if (combined.length <= BACKGROUND_TASK_OUTPUT_LIMIT) return combined;
  return combined.slice(combined.length - BACKGROUND_TASK_OUTPUT_LIMIT);
}

function snapshot(record: BackgroundTaskRecord): BackgroundTaskSnapshot {
  return {
    id: record.id,
    conversationId: record.conversationId,
    command: record.command,
    cwd: record.cwd,
    pid: record.pid,
    status: record.status,
    exitCode: record.exitCode,
    startedAt: record.startedAt,
    endedAt: record.endedAt,
    stdout: record.stdout,
    stderr: record.stderr,
  };
}
