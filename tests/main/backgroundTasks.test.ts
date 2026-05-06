import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  clearBackgroundTaskRegistry,
  killBackgroundTask,
  listBackgroundTasks,
  startBackgroundTask,
} from "../../src/main/backgroundTasks";

let dir = "";

afterEach(() => {
  clearBackgroundTaskRegistry();
  if (dir) {
    rmSync(dir, { recursive: true, force: true });
    dir = "";
  }
});

function tempDir(): string {
  dir = mkdtempSync(join(tmpdir(), "background-task-test-"));
  return dir;
}

describe("backgroundTasks", () => {
  it("starts, lists, and kills a background process", async () => {
    const task = startBackgroundTask({
      conversationId: "conversation-a",
      command: "node -e \"setInterval(() => {}, 1000)\"",
      cwd: tempDir(),
    });

    expect(task.status).toBe("running");
    expect(listBackgroundTasks("conversation-a").map((t) => t.id)).toContain(
      task.id,
    );

    const killed = killBackgroundTask(task.id);

    expect(killed?.status).toBe("killed");
  });

  it("filters tasks by conversation id", () => {
    const cwd = tempDir();
    const a = startBackgroundTask({
      conversationId: "conversation-a",
      command: "node -e \"setInterval(() => {}, 1000)\"",
      cwd,
    });
    startBackgroundTask({
      conversationId: "conversation-b",
      command: "node -e \"setInterval(() => {}, 1000)\"",
      cwd,
    });

    expect(listBackgroundTasks("conversation-a").map((task) => task.id)).toEqual(
      [a.id],
    );
  });
});
