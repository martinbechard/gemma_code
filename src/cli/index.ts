// CLI entrypoint that reuses the runtime modules behind the Electron app.
// Usage:
//   npm run cli -- chat "your prompt"
//   npm run cli -- code "build a landing page for ..."
//   npm run cli -- setup
//   npm run cli -- status
//
// Set RUN_BASH=1 to allow the run_bash tool. Default is disabled for safety.
// Override the model with --model <hf-id>. Defaults to gemma-4-e2b.

import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { setRuntimePaths } from "../main/runtimePaths";

// Paths must be set BEFORE importing modules that reach for runtimePaths.
const REPO_ROOT = resolve(process.cwd());
setRuntimePaths({
  userData: join(homedir(), "Library", "Application Support", "gemma-chat"),
  appRoot: REPO_ROOT,
  packaged: false,
});

const { runChat } = await import("./agent");
const { runSetup, runStatus } = await import("./setup");

interface ParsedArgs {
  command: "chat" | "code" | "setup" | "status";
  model: string;
  prompt: string;
  enableBash: boolean;
}

const DEFAULT_MODEL = "mlx-community/gemma-4-e2b-it-4bit";

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  if (args.length === 0) {
    printUsage();
    process.exit(2);
  }
  const command = args[0];
  if (
    command !== "chat" &&
    command !== "code" &&
    command !== "setup" &&
    command !== "status"
  ) {
    printUsage();
    process.exit(2);
  }
  let model = DEFAULT_MODEL;
  const remaining: string[] = [];
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a === "--model") {
      model = args[++i] ?? DEFAULT_MODEL;
    } else {
      remaining.push(a);
    }
  }
  const prompt = remaining.join(" ").trim();
  if ((command === "chat" || command === "code") && !prompt) {
    process.stderr.write("Error: prompt required for chat/code commands\n");
    printUsage();
    process.exit(2);
  }
  return {
    command,
    model,
    prompt,
    enableBash: process.env.RUN_BASH === "1",
  };
}

function printUsage(): void {
  process.stderr.write(
    [
      "Usage:",
      "  cli setup [--model <hf-id>]",
      "  cli status [--model <hf-id>]",
      "  cli chat [--model <hf-id>] <prompt>",
      "  cli code [--model <hf-id>] <prompt>",
      "",
      `Default model: ${DEFAULT_MODEL}`,
      "Set RUN_BASH=1 to allow the run_bash tool.",
      "",
    ].join("\n"),
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
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
      });
      return;
    case "code":
      await runChat({
        mode: "code",
        model: args.model,
        prompt: args.prompt,
        enableBash: args.enableBash,
      });
      return;
  }
}

main().catch((e) => {
  process.stderr.write(`\nFATAL: ${(e as Error).message}\n`);
  process.exit(1);
});
