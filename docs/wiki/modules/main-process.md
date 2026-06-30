---
type: "Topic"
title: "Main Process Design"
description: "The main process is the Electron adapter and runtime coordinator."
tags: ["modules"]
---

# Main Process Design

## Current Understanding

The main process is the Electron adapter and runtime coordinator. It owns app window setup, IPC handlers, configured model list loading, local and remote setup orchestration, chat stream coordination, workspace server startup, tool execution loops, plan harness integration, abort handling, debug log access, and the inactive app-level audio transcription IPC handler.

## Authoritative Sources

- [Main process source](../../../src/main/index.ts)
- [Shared types](../../../src/shared/types.ts)
- [Repository README](../../../README.md)
- [CLI runtime implementation plan](../../../design/cli-runtime-implementation-plan.md)
- [MLX transparency implementation plan](../../../design/mlx-transparency-implementation-plan.md)

## Related Code

- [src/main/index.ts](../../../src/main/index.ts)
- [src/main/modelConfig.ts](../../../src/main/modelConfig.ts)
- [src/main/modelChat.ts](../../../src/main/modelChat.ts)
- [src/main/remoteChat.ts](../../../src/main/remoteChat.ts)
- [src/main/mlx.ts](../../../src/main/mlx.ts)
- [src/main/tools/index.ts](../../../src/main/tools/index.ts)
- [src/main/plan](../../../src/main/plan)
- [src/main/workspace.ts](../../../src/main/workspace.ts)
- [src/main/executionLog.ts](../../../src/main/executionLog.ts)

## Related Tests

- [tests/main/codeSystemPrompt.test.ts](../../../tests/main/codeSystemPrompt.test.ts)
- [tests/main/remoteChat.test.ts](../../../tests/main/remoteChat.test.ts)
- [tests/main/mlxChatStream.test.ts](../../../tests/main/mlxChatStream.test.ts)
- [tests/shared/modelRegistry.test.ts](../../../tests/shared/modelRegistry.test.ts)
- [tests/main/actionParser.test.ts](../../../tests/main/actionParser.test.ts)
- [tests/main/plan](../../../tests/main/plan)

## Related Backlog Items

- Not yet identified.

## Related Wiki Pages

- [Electron App Runtime](../subsystems/electron-app-runtime.md)
- [Agent Harness](../subsystems/agent-harness.md)
- [Local Model Runtime](../subsystems/local-model-runtime.md)
- [Tool And Workspace Runtime](../subsystems/tool-and-workspace-runtime.md)

## Open Questions

No open wiki questions are recorded for this topic.

## Maintenance Notes

- Recheck this page when IPC handlers, setup flow, chat loop, or plan orchestration changes.
- Recheck the audio transcription notes if app-level MLX transcription is implemented or the renderer stops using renderer-side Whisper transcription.

## Runtime Path

Primary implementation: [src/main/index.ts](../../../src/main/index.ts).

## Parent Context

This module contributes to the [Architecture](../technical/architecture.md), [Electron App Runtime](../subsystems/electron-app-runtime.md), and [Agent Harness](../subsystems/agent-harness.md).

## Responsibilities

- Configure Electron application identity, user-data path, native theme, app window, and renderer loading.
- Expose IPC handlers for setup, model listing, model switching, repair, chat, abort, logs, tools, workspace operations, directory selection, and the app-level audio transcription placeholder.
- Build and emit mode-specific system prompts.
- Run local setup through MLX install, model validation, server start, download polling, cache repair detection, and warmup inference.
- Run remote setup by validating configured endpoint credentials before chat starts.
- Drive chat, planning, semantic review, execution, verification, tool calls, step evidence, and stream chunks.
- Forward workspace changes, raw chunks, file streaming, and runtime activities to the renderer.

## Callers

- Electron runtime calls app lifecycle handlers.
- [Preload IPC Bridge](preload-ipc-bridge.md) invokes IPC channels from the renderer.
- [Renderer UI](renderer-ui.md) consumes streamed status and chat events through preload.

## Dependencies

- [Shared Types And Model Registry](shared-types-and-model-registry.md) for configured model metadata and endpoint validation.
- [MLX Runtime](mlx-runtime.md) for local model setup and chat completion streaming.
- [src/main/modelChat.ts](../../../src/main/modelChat.ts) and [src/main/remoteChat.ts](../../../src/main/remoteChat.ts) for model routing and remote endpoint streaming.
- [Tool Runtime](tool-runtime.md) for prompt rendering, action parsing, and tool execution.
- [Plan Engine](plan-engine.md) for plan parsing, assembly, execution state, request policy, validation, and evidence checks.
- [Workspace Runtime](workspace-runtime.md) for sandbox and working-directory handling.
- [Execution Logs And Background Tasks](execution-logs-and-background-tasks.md) for logs and process cleanup.

## Public Contracts

- IPC handlers are the public renderer contract.
- Chat streaming emits shared [StreamChunk](../../../src/shared/types.ts) records.
- Setup emits shared [SetupStatus](../../../src/shared/types.ts) records.

## Internal Data And State

- The module owns the main BrowserWindow reference and active chat abort controllers.
- Per-request plan and evidence state live inside the chat handler.

## Processing Rules

- Local setup must prove warmup inference before sending ready.
- Remote setup must validate configured endpoint credentials before sending ready.
- Code auto mode assembles a plan before execution unless freestyle or execute-plan mode is selected.
- Tool actions are one-at-a-time and tool results are replayed into model context.
- Verification cannot mutate files and must rely on visible evidence.
- The audio:transcribe IPC handler currently returns empty text because app-level MLX transcription integration is not implemented. Working voice input is handled by the [Renderer UI](renderer-ui.md) through renderer-side Whisper transcription.

## Invariants

- Renderer code reaches runtime behavior only through preload IPC.
- Model setup errors should include actionable command and log file context when available.
- Workspace overrides must be cleared after request handling.

## Configuration

- Runtime paths are set from Electron app state.
- Model choice arrives through IPC request payloads.
- Model catalog data comes from the configured model JSON file.

## External Interfaces

- Electron IPC, local MLX server, configured remote model APIs, local filesystem, shell opening, directory dialogs, and the workspace HTTP preview server.

## UI And Notification Behavior

- Emits setup, chat, activity, workspace, raw chunk, and file streaming events for renderer display.

## Error Handling

- Repairable cache errors become setup status records with repair metadata.
- Chat errors stream error chunks and terminate the active channel.

## Verification

- Use [tests/main/codeSystemPrompt.test.ts](../../../tests/main/codeSystemPrompt.test.ts), [tests/main/mlxChatStream.test.ts](../../../tests/main/mlxChatStream.test.ts), [tests/main/remoteChat.test.ts](../../../tests/main/remoteChat.test.ts), [tests/main/actionParser.test.ts](../../../tests/main/actionParser.test.ts), [tests/shared/modelRegistry.test.ts](../../../tests/shared/modelRegistry.test.ts), and plan tests under [tests/main/plan](../../../tests/main/plan).
