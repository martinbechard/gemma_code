import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
const MLX_SERVER_PORT = "11434";
const TERMINATE_SIGNAL = "SIGTERM";

export interface ProcessInfo {
  pid: number;
  ppid: number;
  command: string;
}

export function parseProcessList(output: string): ProcessInfo[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const match = line.match(/^(\d+)\s+(\d+)\s+(.+)$/);
      if (!match) return null;
      return {
        pid: Number(match[1]),
        ppid: Number(match[2]),
        command: match[3],
      };
    })
    .filter((processInfo): processInfo is ProcessInfo => processInfo !== null);
}

export function findCliCleanupTargets(
  processes: ProcessInfo[],
  currentPid: number,
): ProcessInfo[] {
  const byParent = new Map<number, ProcessInfo[]>();
  for (const processInfo of processes) {
    const siblings = byParent.get(processInfo.ppid) ?? [];
    siblings.push(processInfo);
    byParent.set(processInfo.ppid, siblings);
  }

  const selected = new Map<number, ProcessInfo>();
  const addTree = (root: ProcessInfo): void => {
    if (root.pid === currentPid) return;
    selected.set(root.pid, root);
    for (const child of byParent.get(root.pid) ?? []) {
      addTree(child);
    }
  };

  for (const processInfo of processes) {
    if (isGemmaCliProcess(processInfo)) {
      addTree(processInfo);
    }
  }

  for (const processInfo of processes) {
    if (processInfo.pid !== currentPid && isCliMlxServerProcess(processInfo)) {
      selected.set(processInfo.pid, processInfo);
    }
  }

  return Array.from(selected.values()).sort((a, b) => b.pid - a.pid);
}

export async function cleanupCliProcesses(): Promise<ProcessInfo[]> {
  const { stdout } = await execFileAsync("ps", ["-axo", "pid=,ppid=,command="]);
  const targets = findCliCleanupTargets(parseProcessList(stdout), process.pid);
  for (const target of targets) {
    try {
      process.kill(target.pid, TERMINATE_SIGNAL);
    } catch {
      // The process may already have exited after ps returned.
    }
  }
  return targets;
}

function isGemmaCliProcess(processInfo: ProcessInfo): boolean {
  return processInfo.command.includes("src/cli/index.ts");
}

function isCliMlxServerProcess(processInfo: ProcessInfo): boolean {
  return (
    processInfo.command.includes("-m mlx_lm server") &&
    processInfo.command.includes(`--port ${MLX_SERVER_PORT}`)
  );
}
