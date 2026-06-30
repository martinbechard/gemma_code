---
type: "Topic"
title: "Plan Engine Design"
description: "The plan engine turns a user coding request into executable plan steps, validates plan shape and semantics, tracks step and verify state, records evidence, and enforces..."
tags: ["modules"]
---

# Plan Engine Design

## Current Understanding

The plan engine turns a user coding request into executable plan steps, validates plan shape and semantics, tracks step and verify state, records evidence, and enforces verification rules before advancing.

## Authoritative Sources

- [Plan parser](../../../src/main/plan/parser.ts)
- [Plan assembly](../../../src/main/plan/assembly.ts)
- [Plan execution state](../../../src/main/plan/executionState.ts)
- [Plan evidence](../../../src/main/plan/evidence.ts)
- [General purpose plan harness design](../../../design/general-purpose-plan-harness.md)

## Related Code

- [src/main/plan](../../../src/main/plan)
- [src/main/index.ts](../../../src/main/index.ts)
- [src/cli/agent.ts](../../../src/cli/agent.ts)

## Related Tests

- [tests/main/plan/parser.test.ts](../../../tests/main/plan/parser.test.ts)
- [tests/main/plan/assembly.test.ts](../../../tests/main/plan/assembly.test.ts)
- [tests/main/plan/executionState.test.ts](../../../tests/main/plan/executionState.test.ts)
- [tests/main/plan/evidence.test.ts](../../../tests/main/plan/evidence.test.ts)
- [tests/main/plan/validation.test.ts](../../../tests/main/plan/validation.test.ts)
- [tests/cli/agentPlanPrompts.test.ts](../../../tests/cli/agentPlanPrompts.test.ts)

## Related Backlog Items

- Not yet identified.

## Related Wiki Pages

- [Agent Harness](../subsystems/agent-harness.md)
- [Code Task Execution](../functional/code-task-execution.md)
- [Main Process](main-process.md)
- [CLI Runtime](cli-runtime.md)

## Open Questions

No open wiki questions are recorded for this topic.

## Maintenance Notes

- Recheck this page when plan syntax, validation policy, semantic review, evidence rules, or verify prompts change.

## Runtime Path

Primary folder: [src/main/plan](../../../src/main/plan).

## Parent Context

This module implements the structured planning and execution portion of the [Agent Harness](../subsystems/agent-harness.md).

## Responsibilities

- Parse YAML plans, Step wrappers, and verify tags.
- Build planning prompts and collect step-by-step plan assembly.
- Validate plan shape, placeholder text, duplicate names, and executable step wording.
- Run semantic review and corrected-plan handling.
- Drive step and verify phases through a state machine.
- Collect read, search, mutation, command, failure, and absence evidence.
- Force failures when evidence is missing or contradicted.

## Callers

- [Main Process](main-process.md) uses the plan engine for app Code auto and execute-plan flows.
- [CLI Runtime](cli-runtime.md) uses the same engine for code, plan, approve, and execute-plan commands.

## Dependencies

- YAML parsing, shared plan types, tool request policy, and model-generated plan/review responses.

## Public Contracts

- Parsed plans contain steps with name, prompt, and verify fields.
- Plan execution emits plan, step, and verify node events.
- Evidence helpers return reasons the harness can use to retry or fail steps.

## Internal Data And State

- PlanExecutionState owns nested frames, retry counts, current phase, generated node ids, and buffered events.
- Evidence state owns per-step action observations.

## Processing Rules

- Planning inspection actions are not plan steps.
- Mutation steps must name exact files or artifacts.
- Verification can gather read-only evidence but must not mutate files.
- Removal verification requires mutation evidence and post-mutation absence evidence.

## Invariants

- A completed plan must contain at least one executable step.
- Verify pass requires visible evidence, not intent.
- Failed verification retries only up to the configured retry count.

## Configuration

- Retry limits are configured by main and CLI harness constants.

## External Interfaces

- Model responses, tool result strings, YAML parser, and emitted stream chunks.

## UI And Notification Behavior

- Plan nodes and plan review data are surfaced through chat stream chunks and rendered in the app.

## Error Handling

- Malformed plans, incomplete steps, repeated actions, failed edits, and weak verification become correction prompts, retries, or forced failures.

## Verification

- Use the focused plan tests under [tests/main/plan](../../../tests/main/plan) and [tests/cli/agentPlanPrompts.test.ts](../../../tests/cli/agentPlanPrompts.test.ts).
