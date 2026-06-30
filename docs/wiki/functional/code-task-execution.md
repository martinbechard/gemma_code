---
type: "Topic"
title: "Code Task Execution Functional Specification"
description: "Code task execution guides a user request through planning, semantic review, execution, tool evidence, verification, retries, and final completion."
tags: ["functional"]
---

# Code Task Execution Functional Specification

## Current Understanding

Code task execution guides a user request through planning, semantic review, execution, tool evidence, verification, retries, and final completion. The workflow is shared by Electron Code mode and CLI code/plan/execute-plan commands.

## Authoritative Sources

- [README CLI workflow](../../../README.md)
- [General purpose plan harness](../../../design/general-purpose-plan-harness.md)
- [Main process harness](../../../src/main/index.ts)
- [CLI agent](../../../src/cli/agent.ts)
- [Plan Engine](../modules/plan-engine.md)
- [Tool Runtime](../modules/tool-runtime.md)

## Related Code

- [src/main/index.ts](../../../src/main/index.ts)
- [src/cli/agent.ts](../../../src/cli/agent.ts)
- [src/main/plan](../../../src/main/plan)
- [src/main/tools/index.ts](../../../src/main/tools/index.ts)
- [Gemma.code.md](../../../Gemma.code.md)
- [Gemma.execute.md](../../../Gemma.execute.md)
- [Gemma.plan.md](../../../Gemma.plan.md)

## Related Tests

- [tests/main/plan](../../../tests/main/plan)
- [tests/main/actionParser.test.ts](../../../tests/main/actionParser.test.ts)
- [tests/main/codeSystemPrompt.test.ts](../../../tests/main/codeSystemPrompt.test.ts)
- [tests/cli/agentPlanPrompts.test.ts](../../../tests/cli/agentPlanPrompts.test.ts)

## Related Backlog Items

- Not yet identified.

## Related Wiki Pages

- [Agent Harness](../subsystems/agent-harness.md)
- [Plan Engine](../modules/plan-engine.md)
- [Tool Runtime](../modules/tool-runtime.md)
- [CLI Workflows](cli-workflows.md)
- [Electron App Workflows](electron-app-workflows.md)

## Open Questions

No open wiki questions are recorded for this topic.

## Maintenance Notes

- Recheck when plan assembly, semantic review, execution prompts, evidence requirements, or verify behavior changes.

## Parent Workflow

This page belongs to [Functional Workflows](index.md) and is used by Electron and CLI code surfaces.

## Actors

- User requests a code change or plan.
- Model proposes steps and executes tool actions.
- Harness validates plan shape, reviews semantics, records evidence, and verifies results.

## Entry Points

- Electron Code mode with auto planning.
- Electron Execute Plan affordance.
- CLI code.
- CLI plan.
- CLI plan-ask-done.
- CLI execute-plan.
- CLI code approve mode.

## Scope

Includes plan creation, read-only inspection, plan validation, semantic review, execution context reset, tool execution, step summary, verification, retries, and result streaming.

## Concepts

- Plan step: YAML record with name, prompt, and verify fields.
- Semantic review: structured model review that can pass or return a corrected plan.
- Step evidence: records of reads, searches, mutations, command runs, and failures.
- Verify result: explicit pass or fail response.

## Workflows

1. User submits a code task.
2. Harness builds planning prompt.
3. Model performs read-only inspection or emits one plan step.
4. Harness stores accepted steps until the plan is complete.
5. Harness validates the plan and runs semantic review.
6. User approves when requested or execution begins automatically.
7. Harness resets into execution prompt and runs each step.
8. Tool results create evidence.
9. Verify prompt checks the step criterion using visible evidence.
10. Harness advances, retries, or fails.

## States And Rules

- Planning can use read-only inspection tools.
- Execution uses tool actions and short summaries.
- Verification can use read-only tools but must not mutate files.
- Removal steps need mutation evidence and absence evidence.
- Repeated actions, malformed actions, weak evidence, and failed edits trigger recovery prompts or forced failures.

## Edge Cases

- Incomplete action tags get a nudge to resend one complete action.
- Failed edit_file can force reread or write_file recovery.
- Model self-reporting fake tool output is rejected.
- Plan validation rejects placeholder or non-executable steps.
- Verification fails when evidence is missing or contradicted.

## Verification

Type: Testable

Test files: [tests/main/plan](../../../tests/main/plan), [tests/main/actionParser.test.ts](../../../tests/main/actionParser.test.ts), [tests/cli/agentPlanPrompts.test.ts](../../../tests/cli/agentPlanPrompts.test.ts)

Status: Present

Scenario: Code task execution behavior is covered through plan parser, assembly, validation, execution state, request policy, evidence, and CLI prompt tests.

Steps:

1. Run plan and parser tests.
2. Run action parser tests.
3. Run CLI plan prompt tests.

Assertions:

- Plan syntax and shape are validated.
- Step and verify state progresses deterministically.
- Evidence rules can force failure or retry.
- CLI and app prompts use the same harness assumptions.
