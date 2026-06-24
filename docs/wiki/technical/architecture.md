# Gemma Code Architecture

## Current Understanding

Gemma Code is a local-first coding agent for macOS on Apple Silicon. It has an Electron desktop app and a TypeScript CLI that share a local MLX model runtime, tool protocol, workspace runtime, and structured planning harness.

## Authoritative Sources

- [README](../../../README.md)
- [Agent instructions](../../../AGENTS.md)
- [Module Designs](../modules/index.md)
- [Subsystem Designs](../subsystems/index.md)
- [Source tree](../../../src)
- [Tests](../../../tests)
- [CLI runtime implementation plan](../../../design/cli-runtime-implementation-plan.md)
- [General purpose plan harness](../../../design/general-purpose-plan-harness.md)
- [MLX transparency implementation plan](../../../design/mlx-transparency-implementation-plan.md)

## Related Code

- [src/main](../../../src/main)
- [src/cli](../../../src/cli)
- [src/renderer](../../../src/renderer)
- [src/preload](../../../src/preload)
- [src/shared](../../../src/shared)
- [electron.vite.config.ts](../../../electron.vite.config.ts)
- [package.json](../../../package.json)

## Related Tests

- [tests/main](../../../tests/main)
- [tests/cli](../../../tests/cli)
- [tests/renderer](../../../tests/renderer)
- [tests/shared](../../../tests/shared)

## Related Backlog Items

- Not yet identified.

## Related Wiki Pages

- [Subsystem Designs](../subsystems/index.md)
- [Module Designs](../modules/index.md)
- [Functional Workflows](../functional/index.md)
- [Code Map](../code/index.md)
- [Open Decisions](../open-decisions.md)

## Open Questions

No open wiki questions are recorded for this topic.

## Maintenance Notes

- Recheck this page when runtime surfaces, dependency direction, model setup, plan harness behavior, or packaging changes.

## Purpose

The architecture defines how Gemma Code keeps model execution local while still providing a practical coding-agent harness through desktop and terminal surfaces.

## Scope

Included: local model runtime, Electron app, CLI, shared agent harness, tools, workspaces, execution logs, and tests. Not included: external cloud inference services or remote deployment architecture.

## System Context

Users run Gemma Code locally. The Electron app provides setup, model selection, chat/code workflows, workspace preview, and logs. The CLI provides setup/status/chat/code/plan flows in the terminal. Both surfaces call the local MLX server and operate on local files.

## Technology Stack

- TypeScript for application, CLI, runtime, tests, and shared contracts.
- Electron, Vite, and React for the desktop app.
- Node APIs for filesystem, child processes, HTTP preview, and CLI execution.
- MLX LM and MLX VLM Python packages for local model serving.
- Vitest for regression coverage.
- YAML parsing for plan documents and semantic review responses.

## File Organization

- [src/main](../../../src/main) owns Electron main process, MLX, tools, workspaces, plan engine, logs, and background tasks.
- [src/cli](../../../src/cli) owns terminal adapters.
- [src/renderer](../../../src/renderer) owns React UI.
- [src/preload](../../../src/preload) owns context-isolated IPC API.
- [src/shared](../../../src/shared) owns cross-process types and model registry.
- [tests](../../../tests) mirrors main, CLI, renderer, and shared behavior.
- [design](../../../design) contains implementation plans and analysis notes.
- [docs/wiki](..) contains the maintained documentation surface.

## Architectural Layers

1. User surfaces: Electron renderer and CLI terminal.
2. Adapters: preload IPC bridge, Electron main IPC handlers, CLI entrypoint and agent adapter.
3. Harness core: prompts, plan engine, tool action parser, evidence, verification, chat history.
4. Runtime services: MLX runtime, workspace runtime, execution logs, background tasks.
5. External local systems: Python venv, MLX server, Hugging Face cache, filesystem, shell, git worktrees.

Renderer code may depend on shared types and preload API, but not Node runtime APIs. CLI and Electron adapters may depend on shared runtime modules. Shared runtime modules should avoid depending on BrowserWindow.

## Key Components

- [Local Model Runtime](../subsystems/local-model-runtime.md) owns MLX installation, cache validation, server lifecycle, warmup, and streaming.
- [Agent Harness](../subsystems/agent-harness.md) owns prompt, plan, tool, evidence, and verification flow.
- [Tool And Workspace Runtime](../subsystems/tool-and-workspace-runtime.md) owns tool execution and safe local file/workspace access.
- [Electron App Runtime](../subsystems/electron-app-runtime.md) owns desktop UI and IPC integration.
- [CLI Agent Runtime](../subsystems/cli-agent-runtime.md) owns terminal workflows and worktree isolation.
- [Observability And Debugging](../subsystems/observability-and-debugging.md) owns logs, runtime status, and background process visibility.

## Data Flow

A user request starts in the renderer or CLI, becomes a ChatRequest or CLI run option, is converted into MLX chat messages, streams through the model, is parsed for actions or plan artifacts, runs tools against the active workspace, records evidence and logs, and emits stream chunks or terminal output back to the user surface.

## Lifecycle Flow

App startup sets runtime paths, creates the Electron window, starts workspace services, and initializes setup state. Setup locates or installs MLX, validates model cache, starts the model server, warms inference, and reports ready. Chat/code requests run bounded tool loops and stop on done, error, abort, or plan failure. Shutdown stops the server, workspace server, and background tasks.

## Cross-Cutting Concerns

- Local-first privacy: model inference and file operations run locally.
- Evidence-backed verification: code execution steps require visible tool evidence before verify passes.
- Source path safety: workspace helpers block path escapes.
- Context isolation: renderer communicates through preload only.
- Observability: execution logs, setup statuses, runtime activities, and MLX logs provide local debug evidence.
- Shared contracts: stream, setup, model, workspace, and log types live in shared TypeScript.

## Design Principles

- Keep Electron and CLI as adapters over shared runtime behavior.
- Prefer explicit planning and verification for code tasks.
- Keep model setup state actionable and visible.
- Keep tool access narrow, evidence-producing, and workspace-bound.
- Keep documentation source-backed and linked to code and tests.

## Invariants

- Code and tests outrank wiki summaries.
- Ready model state requires successful local warmup inference.
- Renderer code does not receive raw Electron IPC access.
- Tool actions are parsed from explicit XML action blocks.
- Verification should not rely on hidden state or intended behavior.

## Risks And Trade-Offs

- A local model can be slower or less capable than cloud models, so the harness compensates with strict prompts, tools, and verification.
- MLX and model cache behavior depend on upstream Python packages and Hugging Face cache layout.
- Sharing runtime modules between Electron and CLI reduces duplication but requires adapter boundaries to stay clean.
- The current CLI default model differs from the shared app default; see [Open Decisions](../open-decisions.md).

## Verification

Architecture conformance is verified by [tests/main](../../../tests/main), [tests/cli](../../../tests/cli), [tests/renderer](../../../tests/renderer), [tests/shared](../../../tests/shared), plus package scripts for typecheck, build, and tests when source code changes.
