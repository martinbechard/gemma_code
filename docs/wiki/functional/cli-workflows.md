---
type: "Topic"
title: "CLI Workflows Functional Specification"
description: "The CLI lets terminal users check local or remote model/runtime status, prepare local runtime or validate remote credentials, chat, run code workflows, generate plans, pause for..."
tags: ["functional"]
---

# CLI Workflows Functional Specification

## Current Understanding

The CLI lets terminal users check local or remote model/runtime status, prepare local runtime or validate remote credentials, download local model caches, chat, run code workflows, generate plans, pause for approval, execute saved plans, continue saved conversations, and run inside isolated git worktrees.

## Authoritative Sources

- [README CLI section](../../../README.md)
- [CLI entrypoint](../../../src/cli/index.ts)
- [CLI args](../../../src/cli/args.ts)
- [CLI agent](../../../src/cli/agent.ts)
- [CLI setup](../../../src/cli/setup.ts)
- [CLI worktree](../../../src/cli/worktree.ts)
- [Local model download script](../../../scripts/download-local-models.sh)
- [CLI runtime implementation plan](../../../design/cli-runtime-implementation-plan.md)

## Related Code

- [src/cli/index.ts](../../../src/cli/index.ts)
- [src/cli/args.ts](../../../src/cli/args.ts)
- [src/cli/agent.ts](../../../src/cli/agent.ts)
- [src/cli/setup.ts](../../../src/cli/setup.ts)
- [src/cli/conversation.ts](../../../src/cli/conversation.ts)
- [src/cli/worktree.ts](../../../src/cli/worktree.ts)
- [scripts/download-local-models.sh](../../../scripts/download-local-models.sh)

## Related Tests

- [tests/cli/args.test.ts](../../../tests/cli/args.test.ts)
- [tests/cli/setup.test.ts](../../../tests/cli/setup.test.ts)
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
- download-model
- status
- chat
- code
- plan
- plan-ask-done
- execute-plan
- continue

## Scope

Includes CLI command parsing, setup/status output, local model cache download output, terminal chat/code output, approval prompt, plan files, continuation snapshots, RUN_BASH gating, and worktree mode.

## Concepts

- RUN_BASH: environment flag that allows shell execution tools.
- Worktree mode: isolated git worktree under the worktree directory and cli branch namespace.
- Conversation snapshot: saved JSON state used by continue.
- Approve mode: code command mode that stops after reviewed plan.
- Download model command: local MLX command that uses the shared model download manager and Hugging Face snapshot_download from the managed Python environment to fill the app model cache, persist requested/progress state, print percent complete, transferred bytes, throughput, and estimated time, and leave any running Electron MLX server alone.
- Local model download script: sequential package-script helper that downloads Gemma 3 Text 12B, Gemma 3 12B 6-bit, and Ornith 1.0 9B through the CLI download model command.

## Workflows

1. User runs a CLI command through the package script.
2. CLI parses command, flags, model, prompt, and required file paths.
3. CLI sets runtime paths.
4. setup/status execute local runtime checks or remote credential validation.
5. download-model validates the selected local model, records shared download state, calls Hugging Face snapshot_download into the app cache, and reports progress in the terminal without starting the MLX server.
6. chat/code/plan commands prepare workspace or worktree and run the shared agent loop.
7. continue loads a conversation snapshot and resumes from it.

## States And Rules

- Prompt is required for chat, code, plan, plan-ask-done, execute-plan, and continue.
- download-model does not require a prompt and only supports local MLX models.
- execute-plan requires a plan file.
- continue requires a conversation file.
- worktree applies only to chat, code, plan, plan-ask-done, and execute-plan.
- approve and freestyle apply only to code.
- RUN_BASH must be set to allow shell execution.
- CLI and Electron local model downloads share the same app cache and model-downloads.json state file.

## Edge Cases

- Unknown command prints usage and exits with parse error.
- Non-interactive approval refuses plan approval.
- Existing worktree path fails fast with cleanup instructions.
- Existing MLX server on the canonical port can continue serving the Electron app while CLI model downloads populate other cache folders.
- Local model download confirms cache readiness after snapshot_download completes.
- If CLI download-model is interrupted, the partial Hugging Face cache remains on disk and the shared download state lets Electron show the model as resumable.

## Verification

Type: Testable

Test files: [tests/cli](../../../tests/cli)

Status: Present

Scenario: CLI command parsing, model download progress formatting, planning prompts, snapshots, worktrees, and cleanup behavior are covered by focused tests.

Steps:

1. Run CLI tests.
2. Exercise args, download progress formatting, plan prompts, conversation snapshots, worktree helpers, and cleanup helpers.

Assertions:

- Invalid command combinations are rejected.
- download-model parses without a prompt and formats percent, byte, throughput, and ETA progress.
- Worktree paths and branches are sanitized.
- Conversation snapshots validate shape.
- Agent plan prompt helpers preserve expected behavior.
