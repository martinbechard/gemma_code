# Electron App Runtime High-Level Design

## Current Understanding

The Electron app runtime combines the main process, preload bridge, renderer UI, shared types, workspace server, local MLX setup flow, and configured remote model setup flow into the desktop application experience.

## Authoritative Sources

- [Main Process](../modules/main-process.md)
- [Preload IPC Bridge](../modules/preload-ipc-bridge.md)
- [Renderer UI](../modules/renderer-ui.md)
- [Shared Types And Model Registry](../modules/shared-types-and-model-registry.md)
- [README app workflow](../../../README.md)

## Related Code

- [src/main/index.ts](../../../src/main/index.ts)
- [src/preload/index.ts](../../../src/preload/index.ts)
- [src/renderer](../../../src/renderer)
- [src/shared/types.ts](../../../src/shared/types.ts)
- [electron.vite.config.ts](../../../electron.vite.config.ts)

## Related Tests

- [tests/renderer](../../../tests/renderer)
- [tests/main/codeSystemPrompt.test.ts](../../../tests/main/codeSystemPrompt.test.ts)
- [tests/shared/modelRegistry.test.ts](../../../tests/shared/modelRegistry.test.ts)

## Related Backlog Items

- Not yet identified.

## Related Wiki Pages

- [Architecture](../technical/architecture.md)
- [Electron App Workflows](../functional/electron-app-workflows.md)
- [Local Model Setup](../functional/local-model-setup.md)
- [Main Process](../modules/main-process.md)
- [Renderer UI](../modules/renderer-ui.md)

## Open Questions

No open wiki questions are recorded for this topic.

## Maintenance Notes

- Recheck when IPC, setup UI, chat rendering, workspace UI, or Electron packaging changes.

## Parent Architecture

[Architecture](../technical/architecture.md) governs this subsystem.

## Scope

Includes desktop boot, setup, model switch, chat, code/build modes, workspace preview, conversation persistence, execution log viewing, and renderer-to-main IPC.

## Current Data Anchors

- App state phases are boot, setup, ready, and switching.
- Conversations persist in localStorage.
- ChatRequest, StreamChunk, ModelListResult, and ModelProvenance records cross the preload boundary.

## Constituent Modules

- [Main Process](../modules/main-process.md) owns Electron and runtime coordination.
- [Preload IPC Bridge](../modules/preload-ipc-bridge.md) owns the renderer API.
- [Renderer UI](../modules/renderer-ui.md) owns visible workflows.
- [Shared Types And Model Registry](../modules/shared-types-and-model-registry.md) owns cross-process records.

## Interaction Model

Renderer actions call preload API methods, preload invokes main IPC, main streams status and chat chunks, and renderer converts chunks into user-visible state.

## Lifecycle

The app configures runtime paths, creates the window, starts workspace services, runs local or remote setup, accepts chat/code requests, and stops local model/runtime resources during shutdown.

## Data Shapes And Contracts

SetupStatus, ChatRequest, StreamChunk, ModelListResult, ExecutionLogSnapshot, WorkspaceInfo, WorkspaceFile, and ModelProvenance cross the app boundary.

## Configuration

Electron uses app user-data path named for Gemma Code and app id configured in main. The model picker is loaded from the configured model catalog and filters local MLX models when local MLX support is unavailable.

## Implementation Order

IPC contract changes should update shared types, preload, main handlers, renderer callers, and tests together.

## Invariants

- Renderer remains context-isolated.
- Setup ready means local inference is warm or the selected remote endpoint credential is valid.
- Conversation and model state stay visible and recoverable.

## Non-Goals

- Electron app runtime does not own the CLI terminal presentation.

## Definition Of Good

The desktop app can set up local runtime, validate configured remote model credentials, run chat/code workflows, show streaming state, inspect logs, and navigate workspace output.

## Verification

Use renderer tests, main prompt/runtime tests, shared model tests, and build/typecheck when app boundaries change.
