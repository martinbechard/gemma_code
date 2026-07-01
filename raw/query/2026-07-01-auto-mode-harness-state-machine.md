# Query Fragment: Auto Mode Harness State Machine

## Query Asked

Create a separate harness state machine showing how Code Auto mode moves from planning through plan validation and review into execution, including planning response alternatives and per-step verification behavior.

## Answer Summary

Code Auto mode starts with plan assembly. Each planning turn expects exactly one allowed response form: a read-only inspection action, one Step-wrapped YAML plan step, a focused question, or the plan done sentinel. Read-only tool calls feed planning context and are not saved as steps. Accepted Step records accumulate in memory. The done sentinel moves the accumulated plan into deterministic validation and semantic review. Once the reviewed plan is accepted, execution uses PlanExecutionState. Each step body runs first, then its verify counterpart runs. A passing verify advances to the next step. A failing verify retries the same step with the failure reason until the retry cap aborts.

## Wiki Pages Consulted

- [Code Task Execution Functional Specification](../../docs/wiki/functional/code-task-execution.md)
- [Agent Harness High-Level Design](../../docs/wiki/subsystems/agent-harness.md)
- [Plan Engine Module Design](../../docs/wiki/modules/plan-engine.md)

## Authoritative Sources Consulted

- [Main process harness](../../src/main/index.ts)
- [Plan assembly](../../src/main/plan/assembly.ts)
- [Plan execution state](../../src/main/plan/executionState.ts)
- [Plan assembly tests](../../tests/main/plan/assembly.test.ts)
- [Plan execution state tests](../../tests/main/plan/executionState.test.ts)

## Durable Concepts Detected

- Auto mode planning is iterative by default, not a complete plan response.
- Planning accepts one read-only tool action, one Step-wrapped plan step, one focused question, or the plan done sentinel per turn.
- Read-only planning tools create context but do not become executable plan steps.
- Execution runs each step body and verify counterpart as a pair.
- A verify pass is the gate that advances to the next step.
- A verify fail retries the same step until the retry cap aborts the plan.

## Candidate Wiki Destinations

- Update [Code Task Execution Functional Specification](../../docs/wiki/functional/code-task-execution.md) with the planning response alternatives and step-verify execution gate.
- Update [Plan Engine Module Design](../../docs/wiki/modules/plan-engine.md) with the explicit Auto mode state machine behavior.
- Consider updating [Agent Harness High-Level Design](../../docs/wiki/subsystems/agent-harness.md) if the lifecycle diagram should show the iterative planning and step verification loops.

## Existing Pages To Link

- [Code Task Execution Functional Specification](../../docs/wiki/functional/code-task-execution.md)
- [Plan Engine Module Design](../../docs/wiki/modules/plan-engine.md)
- [Agent Harness High-Level Design](../../docs/wiki/subsystems/agent-harness.md)

## Open Questions

No open questions.

## Privacy And Sensitivity Notes

No private, proprietary, sensitive, PII, or company-internal content was captured.

## Ingest Rationale

The existing wiki describes plan assembly, semantic review, and verification, but it does not fully spell out the planning response alternatives or the state-machine rule that every executed step must pass its verify counterpart before the harness advances.
