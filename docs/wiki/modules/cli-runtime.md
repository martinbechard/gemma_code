---
type: "Topic"
title: "CLI Runtime Design"
description: "The CLI runtime exposes setup, status, chat, code, plan, approve, execute-plan, continue, and worktree workflows in the terminal while reusing the main model routing, MLX, remote..."
tags: ["modules"]
---

# CLI Runtime Design

## Current Understanding

The CLI runtime exposes setup, status, chat, code, plan, approve, execute-plan, continue, and worktree workflows in the terminal while reusing the main model routing, MLX, remote chat, tool, workspace, and plan modules.

## Authoritative Sources

- [CLI entrypoint](../../../src/cli/index.ts)
- [CLI agent runtime](../../../src/cli/agent.ts)
- [CLI setup runtime](../../../src/cli/setup.ts)
- [CLI worktree runtime](../../../src/cli/worktree.ts)
- [CLI runtime implementation plan](../../../design/cli-runtime-implementation-plan.md)
- [README CLI section](../../../README.md)

## Related Code

- [src/cli](../../../src/cli)
- [src/main/modelChat.ts](../../../src/main/modelChat.ts)
- [src/main/modelConfig.ts](../../../src/main/modelConfig.ts)
- [src/main/remoteChat.ts](../../../src/main/remoteChat.ts)
- [src/main/mlx.ts](../../../src/main/mlx.ts)
- [src/main/tools/index.ts](../../../src/main/tools/index.ts)
- [src/main/plan](../../../src/main/plan)
- [src/main/workspace.ts](../../../src/main/workspace.ts)

## Related Tests

- [tests/cli/args.test.ts](../../../tests/cli/args.test.ts)
- [tests/cli/agentPlanPrompts.test.ts](../../../tests/cli/agentPlanPrompts.test.ts)
- [tests/cli/conversation.test.ts](../../../tests/cli/conversation.test.ts)
- [tests/cli/worktree.test.ts](../../../tests/cli/worktree.test.ts)
- [tests/cli/processCleanup.test.ts](../../../tests/cli/processCleanup.test.ts)

## Related Backlog Items

- Not yet identified.

## Related Wiki Pages

- [CLI Agent Runtime](../subsystems/cli-agent-runtime.md)
- [CLI Workflows](../functional/cli-workflows.md)
- [Agent Harness](../subsystems/agent-harness.md)
- [Open Decisions](../open-decisions.md)

## Open Questions

No open wiki questions are recorded for this topic.

## Maintenance Notes

- Recheck this page when CLI commands, default model behavior, conversation snapshots, or worktree mode changes.

## Runtime Path

Primary files: [src/cli/index.ts](../../../src/cli/index.ts), [src/cli/agent.ts](../../../src/cli/agent.ts), [src/cli/setup.ts](../../../src/cli/setup.ts), [src/cli/args.ts](../../../src/cli/args.ts), [src/cli/worktree.ts](../../../src/cli/worktree.ts), and [src/cli/conversation.ts](../../../src/cli/conversation.ts).

## Parent Context

This module implements the [CLI Agent Runtime](../subsystems/cli-agent-runtime.md).

## Responsibilities

- Parse CLI commands and options.
- Set runtime paths before importing main runtime modules.
- Run setup and status checks against the local MLX runtime or configured remote endpoint credentials loaded from process environment or .env.
- Run chat and code prompts in terminal output.
- Assemble, review, approve, execute, and continue plans.
- Save and load CLI conversation snapshots.
- Optionally create isolated git worktrees for agent runs.
- Gate shell execution behind RUN_BASH.

## Callers

- Users invoke the package script shown in [README](../../../README.md).

## Dependencies

- Main runtime modules for model routing, MLX, remote chat, tools, workspace, plan engine, chat history, and background task cleanup.

## Public Contracts

- CLI commands are parsed by [src/cli/args.ts](../../../src/cli/args.ts).
- Conversation snapshots are JSON files under the CLI state directory.
- Worktree mode creates branches under the cli namespace and checkouts under the worktree directory.

## Internal Data And State

- CLI conversations persist messages, model, repository root, project root, and plan execution system prompt.

## Processing Rules

- setup installs or reuses MLX, starts the server, and warms inference for local models. For remote models it validates configured endpoint credentials from process environment or .env.
- status reports MLX installation and model cache readiness for local models. For remote models it reports endpoint kind and credential readiness.
- code defaults to plan-review-execute unless approve or freestyle mode changes the flow.
- continue requires a saved conversation snapshot.

## Invariants

- Runtime paths must be set before importing modules that read runtimePaths.
- Worktree paths and branch names are sanitized.
- RUN_BASH must be enabled before shell tools are allowed.

## Configuration

- CLI default model currently comes from [src/cli/args.ts](../../../src/cli/args.ts), while renderer/app default model comes from [models.config.json](../../../models.config.json).
- Remote provider credentials are shared with the Electron app through the project .env file. Already-set shell variables take precedence for the current CLI process.

## External Interfaces

- Terminal stdin/stdout, git worktree commands, local filesystem, local MLX server, configured remote model APIs, and shell process cleanup.

## UI And Notification Behavior

- Terminal output prints setup stages, runtime activities, tokens, tool calls, tool results, and fatal errors.

## Error Handling

- Parse errors print usage and exit with code 2. Fatal runtime errors print a final error line and exit nonzero.

## Verification

- Use CLI tests under [tests/cli](../../../tests/cli) plus relevant shared plan/tool tests.
