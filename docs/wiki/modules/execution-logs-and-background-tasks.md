# Execution Logs And Background Tasks Design

## Current Understanding

Execution logging records per-run JSONL debug events, consolidates adjacent model and stream chunks, and provides bounded snapshots for the UI. Background task management tracks long-running shell commands spawned by tools and allows listing, killing, and cleanup by conversation.

## Authoritative Sources

- [Execution log source](../../../src/main/executionLog.ts)
- [Background task source](../../../src/main/backgroundTasks.ts)
- [Run bash tool](../../../src/main/tools/runBash.ts)
- [README execution logs section](../../../README.md)

## Related Code

- [src/main/executionLog.ts](../../../src/main/executionLog.ts)
- [src/main/backgroundTasks.ts](../../../src/main/backgroundTasks.ts)
- [src/main/tools/runBash.ts](../../../src/main/tools/runBash.ts)
- [src/main/tools/listBackgroundTasks.ts](../../../src/main/tools/listBackgroundTasks.ts)
- [src/main/tools/killBackgroundTask.ts](../../../src/main/tools/killBackgroundTask.ts)

## Related Tests

- [tests/main/executionLog.test.ts](../../../tests/main/executionLog.test.ts)
- [tests/main/backgroundTasks.test.ts](../../../tests/main/backgroundTasks.test.ts)
- [tests/main/mlxChatStream.test.ts](../../../tests/main/mlxChatStream.test.ts)

## Related Backlog Items

- Not yet identified.

## Related Wiki Pages

- [Observability And Debugging](../subsystems/observability-and-debugging.md)
- [Tool Runtime](tool-runtime.md)
- [Renderer UI](renderer-ui.md)

## Open Questions

No open wiki questions are recorded for this topic.

## Maintenance Notes

- Recheck this page when log file naming, event types, consolidation, viewer limits, or background task lifecycle changes.

## Runtime Path

Primary files: [src/main/executionLog.ts](../../../src/main/executionLog.ts) and [src/main/backgroundTasks.ts](../../../src/main/backgroundTasks.ts).

## Parent Context

This module implements [Observability And Debugging](../subsystems/observability-and-debugging.md).

## Responsibilities

- Create one execution log per debug-enabled run.
- Append structured events with timestamp, conversation id, mode, model, event, and data.
- Consolidate adjacent token and reasoning chunks to keep logs readable.
- Return bounded log snapshots with line numbers and truncation status.
- Spawn background shell tasks with bounded stdout and stderr capture.
- List, kill, and clear background tasks.

## Callers

- [Main Process](main-process.md) creates execution loggers and exposes log IPC.
- Run-bash and background-task tools use task management.
- [Renderer UI](renderer-ui.md) reads execution log snapshots.

## Dependencies

- Runtime paths, filesystem, child process, and shared log types.

## Public Contracts

- ExecutionLogSnapshot is returned to preload and renderer.
- BackgroundTaskSnapshot is returned by background task tools.

## Internal Data And State

- Execution log module tracks the active log path and sequence.
- Background task module tracks task records in memory.

## Processing Rules

- Adjacent stream and model chunks consolidate by event and text field.
- Log snapshots return the latest bounded lines.
- Background task output keeps only the newest bounded characters.

## Invariants

- Execution log files are JSONL.
- Background process groups are terminated where possible.
- Killing a task returns the latest snapshot.

## Configuration

- Log line limits, output retention, prefixes, and extensions are manifest constants.

## External Interfaces

- Local filesystem and shell processes.

## UI And Notification Behavior

- The UI log viewer shows log snapshots and can open the current execution log.

## Error Handling

- Malformed log lines are returned as unknown entries with raw content.
- Process spawn errors mark background tasks with error status.

## Verification

- Use [tests/main/executionLog.test.ts](../../../tests/main/executionLog.test.ts) and [tests/main/backgroundTasks.test.ts](../../../tests/main/backgroundTasks.test.ts).
