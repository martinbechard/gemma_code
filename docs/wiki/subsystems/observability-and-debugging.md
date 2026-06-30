---
type: "Subsystem"
title: "Observability And Debugging High-Level Design"
description: "Observability is centered on execution logs, MLX server logs, runtime activity chunks, setup status records, model cache inspection, and background task snapshots."
tags: ["subsystems"]
---

# Observability And Debugging High-Level Design

## Current Understanding

Observability is centered on execution logs, MLX server logs, runtime activity chunks, setup status records, model cache inspection, and background task snapshots.

## Authoritative Sources

- [Execution Logs And Background Tasks](../modules/execution-logs-and-background-tasks.md)
- [MLX Runtime](../modules/mlx-runtime.md)
- [Renderer UI](../modules/renderer-ui.md)
- [README execution logs section](../../../README.md)

## Related Code

- [src/main/executionLog.ts](../../../src/main/executionLog.ts)
- [src/main/backgroundTasks.ts](../../../src/main/backgroundTasks.ts)
- [src/main/mlx.ts](../../../src/main/mlx.ts)
- [src/renderer/src/components/Chat.tsx](../../../src/renderer/src/components/Chat.tsx)
- [src/renderer/src/components/Setup.tsx](../../../src/renderer/src/components/Setup.tsx)

## Related Tests

- [tests/main/executionLog.test.ts](../../../tests/main/executionLog.test.ts)
- [tests/main/backgroundTasks.test.ts](../../../tests/main/backgroundTasks.test.ts)
- [tests/main/mlxChatStream.test.ts](../../../tests/main/mlxChatStream.test.ts)
- [tests/renderer/components/ChatLogSummary.test.ts](../../../tests/renderer/components/ChatLogSummary.test.ts)

## Related Backlog Items

- Not yet identified.

## Related Wiki Pages

- [Architecture](../technical/architecture.md)
- [Execution Logs And Background Tasks](../modules/execution-logs-and-background-tasks.md)
- [Electron App Workflows](../functional/electron-app-workflows.md)

## Open Questions

No open wiki questions are recorded for this topic.

## Maintenance Notes

- Recheck when log events, log retention, setup statuses, runtime activity labels, or background task snapshots change.

## Parent Architecture

[Architecture](../technical/architecture.md) governs this subsystem.

## Scope

Includes debug execution logs, log snapshots, UI log viewer, MLX log tailing, setup error detail, runtime activity, and background task state.

## Current Data Anchors

- ExecutionLogEntry and ExecutionLogSnapshot are shared renderer-facing log contracts.
- BackgroundTaskSnapshot is the tool-facing background process contract.
- SetupStatus includes stage, message, progress, bytes, error, command, log file, and repair metadata.

## Constituent Modules

- [Execution Logs And Background Tasks](../modules/execution-logs-and-background-tasks.md) owns JSONL debug logs and task snapshots.
- [MLX Runtime](../modules/mlx-runtime.md) owns MLX log files and recent runtime log buffers.
- [Renderer UI](../modules/renderer-ui.md) owns setup error display and log viewer display.

## Interaction Model

The main process creates execution loggers per debug-enabled request, MLX captures runtime logs, tools record background task state, and the renderer reads bounded snapshots through preload.

## Lifecycle

Logs are created per run when enabled. Background tasks start from shell tools and remain listed until they exit, are killed, or the registry is cleared.

## Data Shapes And Contracts

ExecutionLogEntry, ExecutionLogSnapshot, RuntimeActivity, SetupStatus, and BackgroundTaskSnapshot carry observable runtime state.

## Configuration

Log viewer line limit, log chunk consolidation, MLX log retention, and background output retention are manifest constants.

## Implementation Order

Event shape changes should update shared types, main logging, renderer log display, and tests together.

## Invariants

- Runtime failures should carry enough context for action.
- Log snapshots are bounded.
- Background task output is bounded.

## Non-Goals

- This subsystem does not implement external telemetry.

## Definition Of Good

Developers can reconstruct model prompts, tool calls, runtime failures, verify decisions, and long-running command state from local evidence.

## Verification

Use execution log, background task, MLX stream, and renderer log summary tests.
