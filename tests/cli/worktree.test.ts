import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import {
  WORKTREES_DIR_NAME,
  worktreePathFor,
  worktreeBranchName,
  gitignoreNeedsWorktreesEntry,
  addWorktreesToGitignore,
  prepareProjectRootForRun,
  cleanupHint,
} from "../../src/cli/worktree";

function run(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise<void>((resolvePromise, rejectPromise) => {
    const proc = execFile(command, args, { cwd }, (error, _stdout, stderr) => {
      if (error) {
        rejectPromise(
          new Error(`${command} ${args.join(" ")} failed: ${stderr}`),
        );
        return;
      }
      resolvePromise();
    });
    proc.stdin?.end();
  });
}

async function createGitRepo(): Promise<string> {
  const repoRoot = await mkdtemp(join(tmpdir(), "gemma-chat-worktree-test-"));
  await run("git", ["init"], repoRoot);
  await run("git", ["config", "user.email", "cli-test@example.test"], repoRoot);
  await run("git", ["config", "user.name", "CLI Test"], repoRoot);
  await writeFile(join(repoRoot, ".gitignore"), "node_modules/\n", "utf-8");
  await writeFile(join(repoRoot, "README.md"), "test repo\n", "utf-8");
  await run("git", ["add", ".gitignore", "README.md"], repoRoot);
  await run("git", ["commit", "-m", "initial"], repoRoot);
  return repoRoot;
}

describe("worktreePathFor", () => {
  it("joins .worktrees/<id> under the repo root", () => {
    expect(worktreePathFor("/repo", "cli-123")).toBe(
      join("/repo", WORKTREES_DIR_NAME, "cli-123"),
    );
  });

  it("sanitises ids with unsafe characters so the path stays a single segment", () => {
    // The CLI generates ids like "cli-<timestamp>" but we still defend against
    // anything passed via tests or future callers; slashes must not escape.
    const result = worktreePathFor("/repo", "cli/../etc/passwd");
    expect(result.startsWith(join("/repo", WORKTREES_DIR_NAME) + "/")).toBe(
      true,
    );
    expect(result.includes("..")).toBe(false);
  });
});

describe("worktreeBranchName", () => {
  it("prefixes the conversation id with cli/", () => {
    expect(worktreeBranchName("cli-123")).toBe("cli/cli-123");
  });

  it("sanitises characters not allowed in git ref names", () => {
    // git refs disallow spaces, ~, ^, :, ?, *, [, \, and consecutive dots.
    const branch = worktreeBranchName("foo bar~baz");
    expect(branch.startsWith("cli/")).toBe(true);
    expect(/[\s~^:?*[\\]/.test(branch)).toBe(false);
    expect(branch.includes("..")).toBe(false);
  });
});

describe("gitignoreNeedsWorktreesEntry", () => {
  it("returns true on empty content", () => {
    expect(gitignoreNeedsWorktreesEntry("")).toBe(true);
  });

  it("returns true when .worktrees/ is absent", () => {
    expect(gitignoreNeedsWorktreesEntry("node_modules/\nout/\n")).toBe(true);
  });

  it("returns false when an exact .worktrees/ line is present", () => {
    expect(gitignoreNeedsWorktreesEntry("node_modules/\n.worktrees/\nout/\n")).toBe(
      false,
    );
  });

  it("returns false when the entry is present without a trailing slash", () => {
    expect(gitignoreNeedsWorktreesEntry("node_modules/\n.worktrees\nout/\n")).toBe(
      false,
    );
  });

  it("ignores commented-out matches", () => {
    expect(
      gitignoreNeedsWorktreesEntry("node_modules/\n# .worktrees/\nout/\n"),
    ).toBe(true);
  });

  it("matches surrounded by whitespace", () => {
    expect(gitignoreNeedsWorktreesEntry("  .worktrees/  \n")).toBe(false);
  });
});

describe("addWorktreesToGitignore", () => {
  it("appends a section header and the entry on first add", () => {
    const result = addWorktreesToGitignore("node_modules/\nout/\n");
    expect(result.endsWith(".worktrees/\n")).toBe(true);
    expect(result.startsWith("node_modules/\nout/\n")).toBe(true);
    expect(result).toContain("# CLI git worktrees (--worktree)");
  });

  it("ensures a separating blank line when the file does not end with one", () => {
    const result = addWorktreesToGitignore("node_modules/\nout/");
    expect(result).toContain("out/\n\n# CLI git worktrees");
  });

  it("does not duplicate when already present", () => {
    const original = "node_modules/\n.worktrees/\nout/\n";
    expect(addWorktreesToGitignore(original)).toBe(original);
  });

  it("handles empty input by writing the section as the only content", () => {
    const result = addWorktreesToGitignore("");
    expect(result).toContain("# CLI git worktrees (--worktree)");
    expect(result).toContain(".worktrees/");
    expect(result.endsWith("\n")).toBe(true);
  });
});

describe("prepareProjectRootForRun", () => {
  it("returns the current repo root when worktree mode is off", async () => {
    const repoRoot = await createGitRepo();

    const result = await prepareProjectRootForRun({
      repoRoot,
      conversationId: "cli-123",
      worktree: false,
    });

    expect(result.projectRoot).toBe(repoRoot);
    expect(result.createdWorktree).toBeNull();
    await expect(readFile(join(repoRoot, ".gitignore"), "utf-8")).resolves.toBe(
      "node_modules/\n",
    );
  });

  it("creates a git worktree and returns that path when worktree mode is on", async () => {
    const repoRoot = await createGitRepo();

    const result = await prepareProjectRootForRun({
      repoRoot,
      conversationId: "cli-456",
      worktree: true,
    });

    const expectedPath = join(repoRoot, WORKTREES_DIR_NAME, "cli-456");
    expect(result.projectRoot).toBe(expectedPath);
    expect(result.createdWorktree).toEqual({
      path: expectedPath,
      branch: "cli/cli-456",
    });
    await expect(
      readFile(join(expectedPath, "README.md"), "utf-8"),
    ).resolves.toBe("test repo\n");
    await expect(readFile(join(repoRoot, ".gitignore"), "utf-8")).resolves.toContain(
      ".worktrees/",
    );
  });
});

describe("cleanupHint", () => {
  it("prints the exact worktree and branch removal commands", () => {
    const hint = cleanupHint({
      path: "/repo/.worktrees/cli-123",
      branch: "cli/cli-123",
    });

    expect(hint).toContain("Worktree left in place for review:");
    expect(hint).toContain("git worktree remove --force /repo/.worktrees/cli-123");
    expect(hint).toContain("git branch -D cli/cli-123");
  });
});
