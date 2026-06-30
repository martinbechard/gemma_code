---
type: "Topic"
title: "Tool Runtime Design"
description: "The tool runtime defines available tools, renders tool instructions into prompts, parses XML action blocks from model output, protects action boundaries during streaming, and..."
tags: ["modules"]
---

# Tool Runtime Design

## Current Understanding

The tool runtime defines available tools, renders tool instructions into prompts, parses XML action blocks from model output, protects action boundaries during streaming, and dispatches typed tool implementations.

## Authoritative Sources

- [Tool runtime entrypoint](../../../src/main/tools/index.ts)
- [Tool modules](../../../src/main/tools)
- [README tools section](../../../README.md)
- [Action parser tests](../../../tests/main/actionParser.test.ts)

## Related Code

- [src/main/tools/index.ts](../../../src/main/tools/index.ts)
- [src/main/tools](../../../src/main/tools)
- [src/main/tools/types.ts](../../../src/main/tools/types.ts)
- [src/main/tools/constants.ts](../../../src/main/tools/constants.ts)

## Related Tests

- [tests/main/actionParser.test.ts](../../../tests/main/actionParser.test.ts)
- [tests/main/toolsLayout.test.ts](../../../tests/main/toolsLayout.test.ts)
- [tests/main/writeFileTool.test.ts](../../../tests/main/writeFileTool.test.ts)
- [tests/main/writeFileStreaming.test.ts](../../../tests/main/writeFileStreaming.test.ts)
- [tests/main/searchFilesTool.test.ts](../../../tests/main/searchFilesTool.test.ts)
- [tests/main/projectScriptTool.test.ts](../../../tests/main/projectScriptTool.test.ts)

## Related Backlog Items

- Not yet identified.

## Related Wiki Pages

- [Tool And Workspace Runtime](../subsystems/tool-and-workspace-runtime.md)
- [Agent Harness](../subsystems/agent-harness.md)
- [Workspace Runtime](workspace-runtime.md)

## Open Questions

No open wiki questions are recorded for this topic.

## Maintenance Notes

- Recheck this page when tools are added, action parsing changes, or file-protection rules move.

## Runtime Path

Primary implementation: [src/main/tools/index.ts](../../../src/main/tools/index.ts). Tool implementations live under [src/main/tools](../../../src/main/tools).

## Parent Context

This module implements the tool side of the [Agent Harness](../subsystems/agent-harness.md) and [Tool And Workspace Runtime](../subsystems/tool-and-workspace-runtime.md).

## Responsibilities

- Register tool names and tool specs.
- Render chat, code, and plan-mode tool help.
- Load project instructions into system prompts.
- Parse complete and recoverable action blocks.
- Ignore action-like text inside markdown fences and thinking blocks.
- Preserve streaming boundaries so partial action tags are not prematurely emitted.
- Dispatch tool calls and normalize tool errors.

## Callers

- [Main Process](main-process.md) and [CLI Runtime](cli-runtime.md) use prompts, parsing, and dispatch.

## Dependencies

- Individual tool modules, project instruction loading, timezone support, and shared tool types.

## Public Contracts

- [TOOLS](../../../src/main/tools/index.ts) maps tool names to specs.
- [findNextAction](../../../src/main/tools/index.ts) returns parsed actions, incomplete state, or no action.
- [runTool](../../../src/main/tools/index.ts) returns a plain result string.

## Internal Data And State

- The registry is static. Per-conversation file context is owned by tool support modules.

## Processing Rules

- Planning mode exposes read-only inspection tools.
- Code mode can hide edit_file when write_file is configured as the file-change path.
- Exactly one action block is expected per model response.
- content and command bodies are parsed as multiline literal values.

## Invariants

- Unknown tools return an error listing available tools.
- Action parsing must recover from some missing closing content or command tags without swallowing embedded actions.

## Configuration

- [USE_WRITE_FILE_FOR_FILE_CHANGES](../../../src/main/tools/constants.ts) changes prompt-visible file mutation guidance.

## External Interfaces

- Tool modules may use filesystem, shell, network, preview, or background-task interfaces depending on the tool.

## UI And Notification Behavior

- Tool calls and results are streamed through shared chat chunks and rendered by the UI.

## Error Handling

- Tool exceptions become error strings instead of uncaught loop failures.

## Verification

- Use [tests/main/actionParser.test.ts](../../../tests/main/actionParser.test.ts), [tests/main/toolsLayout.test.ts](../../../tests/main/toolsLayout.test.ts), and focused tool tests under [tests/main](../../../tests/main).
