import { cleanupCliProcesses } from "./processCleanup";

const killed = await cleanupCliProcesses();

if (killed.length === 0) {
  process.stdout.write("[cleanup] No CLI or MLX child processes found.\n");
} else {
  process.stdout.write(`[cleanup] Sent SIGTERM to ${killed.length} process(es):\n`);
  for (const processInfo of killed) {
    process.stdout.write(
      `[cleanup] ${processInfo.pid} ppid=${processInfo.ppid} ${processInfo.command}\n`,
    );
  }
}
