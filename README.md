<p align="center">
  <img src="gemma-extruded-app.png" alt="Gemma Code" width="180" />
</p>

<h1 align="center">Gemma Code</h1>

<p align="center">
  <strong>Local-first coding with Gemma on Apple Silicon.</strong><br/>
  An Electron app and CLI that run a Gemma coding agent through MLX on your Mac.<br/>
  Plan, verify, execute, inspect logs, and iterate without sending code to a cloud model.
</p>

---

## What This Is

Gemma Code is an experimental local coding agent built from the Gemma Chat app. It runs a Gemma model through MLX, exposes file and shell tools through a small XML action protocol, and supports both an Electron UI and a command-line workflow.

The project is used to explore what a small local model can do when the surrounding harness is precise: planning is explicit, execution is verified, file edits refresh context automatically, and every tool call can be inspected.

## Current Capabilities

- Electron desktop app for chat and code workflows.
- CLI entrypoint that reuses the same runtime as the app.
- Automatic plan, semantic review, execution, and verification flow for code tasks.
- Plan-only and execute-plan modes for inspecting or replaying plans.
- Isolated CLI worktrees for disposable full-workflow tests.
- File tools that keep a current file-context list after reads, writes, and edits.
- Edit and write protections for project source files.
- Per-run execution logs with actual prompts, model responses, tool calls, and tool results.
- Tool implementations split into one file per tool under src/main/tools.
- Local MLX setup, status checks, and server reuse.

## Requirements

- macOS on Apple Silicon.
- Python 3.10 through 3.13.
- Node 20 or newer.
- Git.

The first MLX run creates the local Python environment, installs MLX packages, and downloads the selected model.

## Install And Run

Clone the current repo:

```bash
git clone git@github.com:martinbechard/gemma_code.git
cd gemma_code
npm install
npm run dev
```

The app can also be started after a production build:

```bash
npm run build
npm run start
```

Build a distributable app:

```bash
npm run dist
```

## CLI

The CLI lives at src/cli/index.ts and is exposed through the package script:

```bash
npm run cli -- status
npm run cli -- setup
npm run cli -- chat "Explain this repository."
npm run cli -- code "Add a focused feature."
```

The default CLI model is:

```text
mlx-community/gemma-4-e2b-it-4bit
```

Use a specific model with:

```bash
npm run cli -- code --model mlx-community/gemma-4-e4b-it-4bit "Add a focused feature."
```

Allow shell execution with:

```bash
RUN_BASH=1 npm run cli -- code "Run the relevant verification."
```

Run inside an isolated git worktree:

```bash
RUN_BASH=1 npm run cli -- code --worktree "Remove an unused tool."
```

The worktree mode creates a branch under the cli namespace and a checkout under .worktrees. It leaves the worktree in place for review unless the run cleans it up.

Clean up CLI child processes:

```bash
npm run cleanup:cli
```

### CLI Commands

```text
cli setup [--model <hf-id>]
cli status [--model <hf-id>]
cli chat [--model <hf-id>] [--worktree] <prompt>
cli code [--model <hf-id>] [--worktree] [--auto|--approve] <prompt>
cli plan [--model <hf-id>] [--worktree] <prompt>
cli plan-ask-done [--model <hf-id>] [--worktree] <prompt>
cli execute-plan [--model <hf-id>] [--worktree] --plan <file> <prompt>
cli continue [--model <hf-id>] --conversation <file> <prompt>
```

### CLI Workflow

The code command now runs the same main workflow expected from the app:

1. Planning prompt asks for read-only inspection during planning.
2. The model emits executable plan steps one at a time inside Step tags.
3. Deterministic validation rejects placeholders, discovery-as-plan, duplicate names, partial tool removals, and weak removal verification.
4. A semantic review pass checks whether the plan fits the user request.
5. Execution resets to a fresh execution prompt.
6. Each step uses tools, gathers evidence, summarizes work, and then verifies.
7. Removal steps require successful mutation evidence plus post-mutation absence evidence.
8. Conversation snapshots are saved under .gemma-cli/conversations.

Use approve mode to stop after the reviewed plan:

```bash
npm run cli -- code --approve "Refactor a small module."
```

Generate a plan only:

```bash
npm run cli -- plan "Add a new focused tool."
```

Execute a saved plan:

```bash
npm run cli -- execute-plan --plan plan.yaml "Original user request."
```

Continue a saved CLI conversation:

```bash
npm run cli -- continue --conversation .gemma-cli/conversations/cli-example.json "Continue from here."
```

## App Workflow

The Electron app uses separate prompt contexts for planning, semantic review, execution, and verification. This matters because the execution model should not inherit planning scratch work as if it were current code evidence.

The current app flow is:

1. Resolve the mode-specific system prompt.
2. In planning mode, allow only read-only inspection tools.
3. Store accepted plan steps and show them in the UI.
4. Run semantic review in a separate review context.
5. Reset into the execution prompt before applying changes.
6. Group tool calls and verification under plan step blocks.
7. Log the actual prompts and responses for later inspection.

## Tools

Tools are organized as individual files under src/main/tools, with src/main/tools/index.ts acting as the public tool entrypoint and prompt renderer.

Current tool modules include:

```text
calc
deleteFile
editFile
fetchUrl
getCurrentDatetime
getCurrentWorkingDirectory
killBackgroundTask
listBackgroundTasks
listFiles
openPreview
readFile
runBash
runProjectScript
searchFiles
webSearch
writeFile
```

Supporting modules handle file content cleanup, file context tracking, protected overwrite rules, project instructions, project scripts, time, and shared tool types.

## File Context And Edits

When read_file reads a file, the tool result shows the full list of files currently in context and the current file content.

When edit_file or write_file succeeds, the tool automatically rereads the updated file and returns the refreshed file context. This keeps the latest version visible to the model and avoids carrying multiple stale versions of the same file through the conversation.

For protected project files, write_file blocks destructive overwrites when the replacement is much smaller than the existing file. edit_file also blocks generic or misleading replacements, including removal comments that still mention removed symbols.

## Execution Logs

Debug logging creates a new execution log file for each run instead of appending forever to one large file. Logs are written under the app user-data debug directory, using filenames that start with execution-log.

The log records:

- system prompts
- harness prompts
- model stream chunks
- assembled plans
- semantic review output
- tool calls
- tool results
- evidence checks
- verify results

The log viewer reads the latest execution log and shows a bounded tail so the UI remains usable.

## Prompt Files

Prompt behavior is file-backed:

```text
Gemma.chat.md
Gemma.code.md
Gemma.build.md
Gemma.plan.md
Gemma.execute.md
Gemma.md
```

The planning prompt keeps planning focused on inspection and executable steps. The execution prompt is stricter about applying mutations, rereading changed files, gathering absence evidence after removals, and avoiding comments that merely say code was removed.

## Model Runtime

The runtime uses MLX-LM through an app-managed Python environment. The CLI and Electron app share the same runtime setup and can reuse an already-running MLX server.

Check runtime status:

```bash
npm run cli -- status
```

Prepare runtime and warm up inference:

```bash
npm run cli -- setup
```

Run the standalone MLX smoke test:

```bash
node scripts/test-mlx.mjs
```

Use a specific model:

```bash
node scripts/test-mlx.mjs mlx-community/gemma-4-e2b-it-4bit
```

## Development

Run tests:

```bash
npm test
```

Run type checks:

```bash
npm run typecheck
```

Build:

```bash
npm run build
```

The repository also works with pnpm in local development:

```bash
pnpm test
pnpm run build
```

## Architecture

```text
src/
  cli/
    args.ts              CLI argument parser
    index.ts             CLI entrypoint
    agent.ts             CLI agent loop
    cleanup.ts           CLI process cleanup
    conversation.ts      CLI conversation snapshots
    setup.ts             CLI MLX setup and status
  main/
    index.ts             Electron main process and app agent loop
    mlx.ts               MLX install, server lifecycle, and chat streaming
    workspace.ts         Per-conversation workspace and file operations
    executionLog.ts      Per-run execution logs
    plan/                Plan parsing, assembly, review, execution, evidence
    tools/               One file per tool plus the tool index
  preload/
    index.ts             contextBridge API surface
  renderer/src/
    components/          Chat UI, plan blocks, messages, preview, sidebar
    lib/                 Renderer helpers
  shared/
    types.ts             Shared IPC and renderer types
```

## Tool Protocol

The model calls tools by emitting XML action blocks. The harness executes one action at a time, appends the result, and then lets the model continue.

```xml
<action name="read_file">
<path>src/main/tools/index.ts</path>
</action>
```

```xml
<action name="edit_file">
<path>src/main/tools/index.ts</path>
<old_string>old text</old_string>
<new_string>new text</new_string>
</action>
```

The action parser ignores action examples inside Markdown code fences and handles multiline fields such as old_string, new_string, and content.

## Credits

- [Gemma](https://ai.google.dev/gemma) by Google DeepMind
- [MLX](https://github.com/ml-explore/mlx) by Apple Machine Learning Research
- [transformers.js](https://github.com/huggingface/transformers.js) by Hugging Face

Original Gemma Chat app by [@ammaar](https://x.com/ammaar).

## License

MIT
