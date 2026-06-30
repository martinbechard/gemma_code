---
type: "Subsystem"
title: "Tool And Workspace Runtime High-Level Design"
description: "The tool and workspace subsystem gives the model controlled access to filesystem, shell, search, preview, web, time, background task, and file-context capabilities inside either a..."
tags: ["subsystems"]
---

# Tool And Workspace Runtime High-Level Design

## Current Understanding

The tool and workspace subsystem gives the model controlled access to filesystem, shell, search, preview, web, time, background task, and file-context capabilities inside either a sandbox workspace or a user-selected working directory.

## Authoritative Sources

- [Tool Runtime](../modules/tool-runtime.md)
- [Workspace Runtime](../modules/workspace-runtime.md)
- [Execution Logs And Background Tasks](../modules/execution-logs-and-background-tasks.md)
- [README tools and file context sections](../../../README.md)

## Related Code

- [src/main/tools](../../../src/main/tools)
- [src/main/workspace.ts](../../../src/main/workspace.ts)
- [src/main/backgroundTasks.ts](../../../src/main/backgroundTasks.ts)

## Related Tests

- [tests/main/toolsLayout.test.ts](../../../tests/main/toolsLayout.test.ts)
- [tests/main/writeFileTool.test.ts](../../../tests/main/writeFileTool.test.ts)
- [tests/main/writeFileStreaming.test.ts](../../../tests/main/writeFileStreaming.test.ts)
- [tests/main/searchFilesTool.test.ts](../../../tests/main/searchFilesTool.test.ts)
- [tests/main/backgroundTasks.test.ts](../../../tests/main/backgroundTasks.test.ts)

## Related Backlog Items

- Not yet identified.

## Related Wiki Pages

- [Architecture](../technical/architecture.md)
- [Tool Runtime](../modules/tool-runtime.md)
- [Workspace Runtime](../modules/workspace-runtime.md)

## Open Questions

No open wiki questions are recorded for this topic.

## Maintenance Notes

- Recheck when tool permissions, workspace path safety, file-context behavior, or shell/background execution changes.

## Parent Architecture

[Architecture](../technical/architecture.md) governs this subsystem.

## Scope

Includes tool registry, action parsing, prompt rendering, file tools, workspace safety, preview server, background task management, and file-context refresh.

## Current Data Anchors

- ToolSpec definitions own tool names, modes, parameters, examples, and run behavior.
- Workspace override map owns per-conversation active roots.
- File context is derived from successful read, edit, and write tool results.

## Constituent Modules

- [Tool Runtime](../modules/tool-runtime.md) owns registry and action protocol.
- [Workspace Runtime](../modules/workspace-runtime.md) owns filesystem boundaries and preview serving.
- [Execution Logs And Background Tasks](../modules/execution-logs-and-background-tasks.md) owns background command lifecycle.

## Interaction Model

The model emits an action, the harness parses it, runTool dispatches the tool, the tool uses workspace helpers or external interfaces, and the result is returned to the model and renderer.

## Lifecycle

The workspace server starts with the main process. Tools run during chat/code turns. Background tasks persist in memory until they exit, are killed, or cleanup runs.

## Data Shapes And Contracts

ToolContext provides conversation id and file-change callback. ToolCall and WorkspaceInfo are shared renderer-facing records.

## Configuration

RUN_BASH gates shell execution in CLI workflows. Tool visibility changes by chat, code, and plan modes.

## Implementation Order

Tool changes should update registry, prompt rendering expectations, file-context behavior, and tests together.

## Invariants

- Workspace paths must not escape active roots.
- File mutations refresh file context.
- Planning mode exposes read-only inspection tools.
- Shell execution remains explicitly gated where required.

## Non-Goals

- This subsystem does not choose model prompts or plan semantics.

## Definition Of Good

Tools are discoverable in prompts, safe at runtime boundaries, test-covered, and return enough evidence for plan verification.

## Verification

Use tool, workspace, and background task tests under [tests/main](../../../tests/main).
