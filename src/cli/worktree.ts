// Helpers for the CLI's --worktree option, which creates a git worktree at
// .worktrees/<conversationId> on a fresh branch so the agent can edit files
// in isolation from the user's main checkout. The pure helpers in this file
// are unit-tested; createWorktree shells out to `git` and is exercised
// end-to-end by the CLI itself.

import { spawn } from "node:child_process";
import { readFile, writeFile, access } from "node:fs/promises";
import { join } from "node:path";

export const WORKTREES_DIR_NAME = ".worktrees";

const GITIGNORE_HEADER = "# CLI git worktrees (--worktree)";
const GITIGNORE_ENTRY = ".worktrees/";

function sanitiseSegment(s: string): string {
  // Defend against ids containing path separators or git-ref-illegal chars.
  // Allow letters, digits, dash, underscore, dot; replace everything else
  // with "_". Collapse runs of dots so ".." can never appear.
  return s.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/\.{2,}/g, "_");
}

export function worktreePathFor(repoRoot: string, conversationId: string): string {
  return join(repoRoot, WORKTREES_DIR_NAME, sanitiseSegment(conversationId));
}

export function worktreeBranchName(conversationId: string): string {
  return `cli/${sanitiseSegment(conversationId)}`;
}

export function gitignoreNeedsWorktreesEntry(content: string): boolean {
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line === ".worktrees" || line === ".worktrees/") return false;
  }
  return true;
}

export function addWorktreesToGitignore(content: string): string {
  if (!gitignoreNeedsWorktreesEntry(content)) return content;
  if (content.length === 0) {
    return `${GITIGNORE_HEADER}\n${GITIGNORE_ENTRY}\n`;
  }
  const needsNewline = !content.endsWith("\n");
  const needsBlank = !content.endsWith("\n\n");
  const sep = needsNewline ? "\n\n" : needsBlank ? "\n" : "";
  return `${content}${sep}${GITIGNORE_HEADER}\n${GITIGNORE_ENTRY}\n`;
}

export interface CreatedWorktree {
  path: string;
  branch: string;
}

export interface PreparedProjectRoot {
  projectRoot: string;
  createdWorktree: CreatedWorktree | null;
}

async function runGit(args: string[], cwd: string): Promise<void> {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const proc = spawn("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d: Buffer) => {
      stderr += d.toString("utf-8");
    });
    proc.on("error", (err) => rejectPromise(err));
    proc.on("exit", (code) => {
      if (code === 0) resolvePromise();
      else
        rejectPromise(
          new Error(`git ${args.join(" ")} exited ${code}: ${stderr.trim()}`),
        );
    });
  });
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

export async function ensureGitignored(repoRoot: string): Promise<boolean> {
  const path = join(repoRoot, ".gitignore");
  let content = "";
  try {
    content = await readFile(path, "utf-8");
  } catch {
    await writeFile(path, addWorktreesToGitignore(""), "utf-8");
    return true;
  }
  const next = addWorktreesToGitignore(content);
  if (next === content) return false;
  await writeFile(path, next, "utf-8");
  return true;
}

export async function createWorktree(opts: {
  repoRoot: string;
  conversationId: string;
}): Promise<CreatedWorktree> {
  const path = worktreePathFor(opts.repoRoot, opts.conversationId);
  const branch = worktreeBranchName(opts.conversationId);

  if (await pathExists(path)) {
    throw new Error(
      `Worktree path already exists: ${path}. Remove it with \`git worktree remove ${path}\` and \`git branch -D ${branch}\` before retrying.`,
    );
  }

  // `git worktree add -b <branch> <path>` creates the new branch off HEAD
  // and checks it out into <path>. Fails fast if the branch name already
  // exists (we surface git's error to the user).
  await runGit(["worktree", "add", "-b", branch, path], opts.repoRoot);
  return { path, branch };
}

export async function prepareProjectRootForRun(opts: {
  repoRoot: string;
  conversationId: string;
  worktree: boolean;
}): Promise<PreparedProjectRoot> {
  if (!opts.worktree) {
    return {
      projectRoot: opts.repoRoot,
      createdWorktree: null,
    };
  }

  await ensureGitignored(opts.repoRoot);
  const createdWorktree = await createWorktree({
    repoRoot: opts.repoRoot,
    conversationId: opts.conversationId,
  });
  return {
    projectRoot: createdWorktree.path,
    createdWorktree,
  };
}

export function cleanupHint(wt: CreatedWorktree): string {
  return [
    "Worktree left in place for review:",
    `  ${wt.path}`,
    `  branch: ${wt.branch}`,
    "To discard changes:",
    `  git worktree remove --force ${wt.path}`,
    `  git branch -D ${wt.branch}`,
  ].join("\n");
}
