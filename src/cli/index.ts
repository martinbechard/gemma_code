// CLI entrypoint that reuses the runtime modules behind the Electron app.
// Usage:
//   npm run cli -- chat "your prompt"
//   npm run cli -- code "build a landing page for ..."
//   npm run cli -- execute-plan --plan plan.xml "your original prompt"
//   npm run cli -- continue --conversation .gemma-cli/conversations/cli-123.json "recap"
//   npm run cli -- setup
//   npm run cli -- status
//
// Set RUN_BASH=1 to allow the run_bash tool. Default is disabled for safety.
// Override the model with --model <hf-id>. Defaults to gemma-4-e2b.
// Pass --worktree to run the agent inside an isolated git worktree at
// .worktrees/<conversationId> on a fresh branch (chat/code only).

import { homedir } from "node:os";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { setRuntimePaths } from "../main/runtimePaths";
import { DEFAULT_MODEL, parseCliArgs } from "./args";

// Paths must be set BEFORE importing modules that reach for runtimePaths.
const REPO_ROOT = resolve(process.cwd());
setRuntimePaths({
  userData: join(homedir(), "Library", "Application Support", "gemma-chat"),
  appRoot: REPO_ROOT,
  packaged: false,
});

const { runChat, runContinue } = await import("./agent");
const { runSetup, runStatus } = await import("./setup");

function printUsage(): void {
  process.stderr.write(
    [
      "Usage:",
      "  cli setup [--model <hf-id>]",
      "  cli status [--model <hf-id>]",
      "  cli chat [--model <hf-id>] [--worktree] <prompt>",
      "  cli code [--model <hf-id>] [--worktree] <prompt>",
      "  cli execute-plan [--model <hf-id>] [--worktree] --plan <file> <prompt>",
      "  cli continue [--model <hf-id>] --conversation <file> <prompt>",
      "",
      `Default model: ${DEFAULT_MODEL}`,
      "Set RUN_BASH=1 to allow the run_bash tool.",
      "Pass --worktree to run inside an isolated git worktree at .worktrees/<id>.",
      "",
    ].join("\n"),
  );
}

async function main(): Promise<void> {
  let args;
  try {
    args = parseCliArgs(process.argv);
  } catch (e) {
    process.stderr.write(`Error: ${(e as Error).message}\n`);
    printUsage();
    process.exit(2);
  }
  switch (args.command) {
    case "setup":
      await runSetup(args.model);
      return;
    case "status":
      await runStatus(args.model);
      return;
    case "chat":
      await runChat({
        mode: "chat",
        model: args.model,
        prompt: args.prompt,
        enableBash: args.enableBash,
        worktree: args.worktree,
      });
      return;
    case "code":
      await runChat({
        mode: "code",
        model: args.model,
        prompt: args.prompt,
        enableBash: args.enableBash,
        worktree: args.worktree,
      });
      return;
    case "execute-plan":
      await runChat({
        mode: "code",
        model: args.model,
        prompt: args.prompt,
        enableBash: args.enableBash,
        worktree: args.worktree,
        initialPlanXml: readFileSync(args.planPath!, "utf8"),
      });
      return;
    case "continue":
      await runContinue({
        conversationPath: args.conversationPath!,
        prompt: args.prompt,
        model: args.model,
        enableBash: args.enableBash,
      });
      return;
  }
}

main().catch((e) => {
  process.stderr.write(`\nFATAL: ${(e as Error).message}\n`);
  process.exit(1);
});
