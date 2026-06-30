---
type: "Topic"
title: "CLI Workflows Functional Specification"
description: "The CLI lets terminal users check local or remote model/runtime status, prepare local runtime or validate remote credentials, chat, run code workflows, generate plans, pause for..."
tags: ["functional"]
---

# CLI Workflows Functional Specification

## Current Understanding

The CLI lets terminal users check local or remote model/runtime status, prepare local runtime or validate remote credentials, chat, run code workflows, generate plans, pause for approval, execute saved plans, continue saved conversations, and run inside isolated git worktrees.

## Authoritative Sources

- [README CLI section](../../../README.md)
- [CLI entrypoint](../../../src/cli/index.ts)
- [CLI args](../../../src/cli/args.ts)
- [CLI agent](../../../src/cli/agent.ts)
- [CLI setup](../../../src/cli/setup.ts)
- [CLI worktree](../../../src/cli/worktree.ts)
- [CLI runtime implementation plan](../../../design/cli-runtime-implementation-plan.md)

## Related Code

- [src/cli/index.ts](../../../src/cli/index.ts)
- [src/cli/args.ts](../../../src/cli/args.ts)
- [src/cli/agent.ts](../../../src/cli/agent.ts)
- [src/cli/setup.ts](../../../src/cli/setup.ts)
- [src/cli/conversation.ts](../../../src/cli/conversation.ts)
- [src/cli/worktree.ts](../../../src/cli/worktree.ts)

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
- [CLI Runtime](../modules/cli-runtime.md)
- [Local Model Setup](local-model-setup.md)
- [Open Decisions](../open-decisions.md)

## Open Questions

No open wiki questions are recorded for this topic.

## Maintenance Notes

- Recheck when CLI commands, flags, default model, worktree behavior, or conversation snapshots change.

## Parent Workflow

This page belongs to [Functional Workflows](index.md).

## Actors

- User runs npm script commands from a terminal.
- CLI adapter sets runtime paths, parses arguments, and calls shared runtime modules.
- Git supplies worktree isolation when requested.

## Entry Points

- setup
- status
- chat
- code
- plan
- plan-ask-done
- execute-plan
- continue

## Scope

Includes CLI command parsing, setup/status output, terminal chat/code output, approval prompt, plan files, continuation snapshots, RUN_BASH gating, and worktree mode.

## Concepts

- RUN_BASH: environment flag that allows shell execution tools.
- Worktree mode: isolated git worktree under the worktree directory and cli branch namespace.
- Conversation snapshot: saved JSON state used by continue.
- Approve mode: code command mode that stops after reviewed plan.

## Workflows

1. User runs a CLI command through the package script.
2. CLI parses command, flags, model, prompt, and required file paths.
3. CLI sets runtime paths.
4. setup/status execute local runtime checks or remote credential validation.
5. chat/code/plan commands prepare workspace or worktree and run the shared agent loop.
6. continue loads a conversation snapshot and resumes from it.

## States And Rules

- Prompt is required for chat, code, plan, plan-ask-done, execute-plan, and continue.
- execute-plan requires a plan file.
- continue requires a conversation file.
- worktree applies only to chat, code, plan, plan-ask-done, and execute-plan.
- approve and freestyle apply only to code.
- RUN_BASH must be set to allow shell execution.

## Edge Cases

- Unknown command prints usage and exits with parse error.
- Non-interactive approval refuses plan approval.
- Existing worktree path fails fast with cleanup instructions.
- Existing MLX server on the canonical port can be reused.

## Verification

Type: Testable

Test files: [tests/cli](../../../tests/cli)

Status: Present

Scenario: CLI command parsing, planning prompts, snapshots, worktrees, and cleanup behavior are covered by focused tests.

Steps:

1. Run CLI tests.
2. Exercise args, plan prompts, conversation snapshots, worktree helpers, and cleanup helpers.

Assertions:

- Invalid command combinations are rejected.
- Worktree paths and branches are sanitized.
- Conversation snapshots validate shape.
- Agent plan prompt helpers preserve expected behavior.
