# CLI Runtime Implementation Plan

## Goal

Add a first-class command line interface that reuses the existing MLX setup, model-cache transparency, chat streaming, tool execution, and workspace behavior without duplicating the Electron app logic.

## Architecture

The implementation should make Electron and the CLI thin adapters over shared TypeScript runtime modules. The MLX lifecycle, setup progress, model cache inspection, chat loop, tool calls, workspace writes, and error reporting should live in reusable modules that do not depend on BrowserWindow or IPC.

The Python component remains the external mlx-lm server process. There is no separate Python application server to split out.

## Recommended Work Split

Use five agent-sized tasks. Steps 1 through 3 remove Electron coupling. Step 4 adds the CLI. Step 5 verifies both surfaces and updates documentation.

## Task 1: Extract App Paths From Electron

### Purpose

Make the MLX and workspace modules usable outside Electron.

### Files

- Modify: src/main/mlx.ts
- Modify: src/main/workspace.ts
- Create: src/main/runtimePaths.ts

### Prompt

```text
Refactor the repo so MLX and workspace code no longer directly depends on Electron app.getPath.

Create a small runtime path module that provides userData, mlx data dir, model cache dir, and workspace root. It must support both Electron and CLI callers.

Keep behavior identical for Electron. Do not add compatibility layers we do not need. Use manifest constants for numeric values. Do not use any. Run npm run typecheck and npm run build after changes.
```

### Acceptance Criteria

- MLX paths and workspace paths are resolved through the new runtime path module.
- Electron still stores data under the same app userData location.
- CLI callers can set or derive a userData location without importing Electron.
- npm run typecheck passes.
- npm run build passes.

## Task 2: Extract Setup Runtime From Electron IPC

### Purpose

Move MLX setup orchestration out of the Electron main process.

### Files

- Modify: src/main/index.ts
- Modify: src/shared/types.ts
- Create: src/main/mlxRuntime.ts

### Prompt

```text
Extract the MLX setup/runtime orchestration from src/main/index.ts into a reusable module.

The reusable API should expose setupModel or ensureModelReady with typed callbacks for SetupStatus updates. It should preserve current behavior: install MLX, validate cache, start server, poll byte progress, wait for complete cache, warmup inference, and surface repairable model errors.

Update Electron IPC handlers to call the new module. Keep UI behavior unchanged. No any types. Run npm run typecheck and npm run build.
```

### Acceptance Criteria

- Electron setup, model switch, and model repair flows call the shared setup runtime.
- SetupStatus events remain unchanged for the renderer.
- Repairable model cache errors still include model and reason.
- Download byte progress remains visible.
- npm run typecheck passes.
- npm run build passes.

## Task 3: Extract Chat Agent Loop

### Purpose

Let both Electron and CLI use the same chat and tool execution loop.

### Files

- Modify: src/main/index.ts
- Modify: src/main/tools.ts
- Modify: src/shared/types.ts
- Create: src/main/chatRuntime.ts

### Prompt

```text
Extract handleChat from Electron index.ts into a reusable chat runtime module.

The module should accept a ChatRequest and typed callbacks for StreamChunk output, raw chunks, file streaming, and workspace changed events. Electron should remain an adapter that forwards those callbacks over IPC.

Preserve existing tool behavior, live write_file streaming, abort behavior, runtime activities, and max tool rounds. Do not change renderer behavior. No any. Run npm run typecheck and npm run build.
```

### Acceptance Criteria

- Chat streaming logic is reusable without Electron IPC.
- Electron chat behavior remains unchanged.
- Tool calls, tool results, and runtime activities still stream to the renderer.
- Live file streaming still updates workspace files.
- Abort behavior remains intact.
- npm run typecheck passes.
- npm run build passes.

## Task 4: Add CLI Entrypoint

### Purpose

Create actual terminal commands over the shared runtime.

### Files

- Modify: package.json
- Modify: tsconfig.node.json
- Create: src/cli/index.ts
- Modify build configuration only if needed for the CLI output.

### Initial Commands

- gemma-chat setup --model MODEL
- gemma-chat status --model MODEL
- gemma-chat chat --model MODEL PROMPT
- gemma-chat code --model MODEL PROMPT

### Prompt

```text
Add a TypeScript CLI entrypoint that uses the reusable runtime modules.

Support setup, status, chat, and code commands. The CLI should print setup stages, byte progress, runtime activity, streamed model tokens, tool calls, tool results, and final errors clearly in the terminal.

Use only simple argument parsing unless the repo already has a CLI library. Add package scripts for building and running the CLI locally. No any. Run npm run typecheck and npm run build.
```

### Acceptance Criteria

- setup starts or installs MLX and shows staged progress.
- status reports MLX availability and model cache state.
- chat streams model output to stdout.
- code uses the existing code-agent tool loop and writes to the workspace.
- Terminal output distinguishes setup progress, runtime activity, tokens, tools, and errors.
- npm run typecheck passes.
- npm run build passes.

## Task 5: Verify Electron And CLI

### Purpose

Make sure the refactor did not break the app and that the CLI is practical to use.

### Files

- Modify: README.md
- Modify: design/cli-runtime-implementation-plan.md if implementation discoveries change the plan.

### Prompt

```text
Verify the Electron app and new CLI both use the same runtime behavior.

Run npm run typecheck and npm run build. Then manually test CLI status/setup/chat commands against the local MLX server path. Update README with the CLI commands, model download behavior, cache-progress behavior, and the known Hugging Face resume caveat.

Keep docs steady-state: do not use wording like revised or enhanced. Do not use inline markdown backticks except fenced code blocks if editing markdown files, per AGENTS.md.
```

### Acceptance Criteria

- npm run typecheck passes.
- npm run build passes.
- CLI status/setup/chat are manually exercised.
- Electron still opens and can send a chat request.
- README documents the CLI commands and download progress behavior.
- Documentation does not depend on knowledge of earlier app versions.

## Suggested Agent Dispatch

Run Task 1 first because all later CLI work depends on non-Electron paths.

Run Task 2 and Task 3 in sequence unless the workers coordinate carefully, because both modify src/main/index.ts.

Run Task 4 after Tasks 1 through 3 are merged.

Run Task 5 last as the verification and documentation pass.

## Effort Estimate

A minimal CLI that only talks to an already-running MLX server is a few hours.

A useful first-class CLI with setup, status, byte progress, chat, and code mode is about one to two days.

Near-GUI parity with polished terminal behavior, model repair wording, workspace preview coordination, and documentation is about three to five days.
