---
type: "Subsystem"
title: "CLI Agent Runtime High-Level Design"
description: "The CLI agent runtime is a terminal adapter over the same local MLX, tool, workspace, and plan harness used by the Electron app."
tags: ["subsystems"]
---

# CLI Agent Runtime High-Level Design

## Current Understanding

The CLI agent runtime is a terminal adapter over the same local MLX, tool, workspace, and plan harness used by the Electron app. It adds command parsing, conversation snapshots, worktree isolation, and terminal approval flows.

## Authoritative Sources

- [CLI Runtime](../modules/cli-runtime.md)
- [Agent Harness](agent-harness.md)
- [Local Model Runtime](local-model-runtime.md)
- [CLI runtime implementation plan](../../../design/cli-runtime-implementation-plan.md)
- [README CLI section](../../../README.md)

## Related Code

- [src/cli](../../../src/cli)
- [src/main/mlx.ts](../../../src/main/mlx.ts)
- [src/main/tools](../../../src/main/tools)
- [src/main/plan](../../../src/main/plan)
- [src/main/workspace.ts](../../../src/main/workspace.ts)

## Related Tests

- [tests/cli](../../../tests/cli)
- [tests/main/plan](../../../tests/main/plan)

## Related Backlog Items

- Not yet identified.

## Related Wiki Pages

- [Architecture](../technical/architecture.md)
- [CLI Workflows](../functional/cli-workflows.md)
- [CLI Runtime](../modules/cli-runtime.md)
- [Open Decisions](../open-decisions.md)

## Open Questions

No open wiki questions are recorded for this topic.

## Maintenance Notes

- Recheck when CLI command grammar, defaults, worktree policy, conversation persistence, or terminal harness behavior changes.

## Parent Architecture

[Architecture](../technical/architecture.md) governs this subsystem.

## Scope

Includes CLI commands, setup/status, chat/code/plan/execute/continue flows, RUN_BASH gating, conversation snapshots, and worktree mode.

## Current Data Anchors

- ParsedArgs is the command contract.
- CliConversationSnapshot stores continuation state.
- Worktree paths and branch names derive from conversation ids.

## Constituent Modules

- [CLI Runtime](../modules/cli-runtime.md) owns CLI adapters.
- [Agent Harness](agent-harness.md) owns shared planning and execution behavior.
- [Local Model Runtime](local-model-runtime.md) owns model setup and chat streaming.
- [Tool And Workspace Runtime](tool-and-workspace-runtime.md) owns tools and workspace operations.

## Interaction Model

The entrypoint parses args, sets runtime paths, imports runtime modules, prepares the project root or worktree, runs setup if needed, drives the shared agent loop, prints terminal output, and saves continuation snapshots.

## Lifecycle

Each command starts from process argv and exits after setup/status/chat/code work. Worktree mode leaves a reviewable checkout behind.

## Data Shapes And Contracts

ParsedArgs, AgentRunOptions, ContinueRunOptions, CliConversationSnapshot, and MLXChatMessage define the main CLI data flow.

## Configuration

RUN_BASH enables shell tool execution. The CLI currently defines its own default model in args.

## Implementation Order

Argument parsing and snapshot compatibility should be updated before terminal workflows depend on new fields.

## Invariants

- Runtime paths are set before importing main modules.
- Worktree names are sanitized.
- Non-interactive approve mode refuses approval when stdin is not interactive.

## Non-Goals

- The CLI does not render React UI or use Electron IPC.

## Definition Of Good

Terminal users can inspect status, prepare local runtime, run chat/code workflows, approve plans, execute saved plans, continue saved conversations, and isolate runs in worktrees.

## Verification

Use [tests/cli](../../../tests/cli) and shared plan/tool tests.
