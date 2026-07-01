# Query Fragment: Code Mode Semantic Review Loop

## Query Asked

The Code Mode sequence diagram should show that semantic review can loop before execution starts.

## Answer Summary

Code Mode plan assembly enters a semantic review phase before execution. The review response can pass, return a valid corrected plan, or be rejected. Rejected semantic review responses cause the harness to send a plan semantic review retry prompt back to the model until the retry cap is reached. A valid pass or corrected plan is saved, emitted as reviewed, and then used for execution or proposal display depending on the code submode.

## Wiki Pages Consulted

- [Code Task Execution Functional Specification](../../docs/wiki/functional/code-task-execution.md)
- [Agent Harness High-Level Design](../../docs/wiki/subsystems/agent-harness.md)
- [Plan Engine Module Design](../../docs/wiki/modules/plan-engine.md)

## Authoritative Sources Consulted

- [Main process harness](../../src/main/index.ts)
- [Plan assembly and semantic review parser](../../src/main/plan/assembly.ts)
- [Plan assembly tests](../../tests/main/plan/assembly.test.ts)

## Durable Concepts Detected

- Semantic review is a bounded retry loop when review output is rejected.
- A needs_correction semantic review can provide a complete corrected plan.
- Execution starts from the accepted original plan or the valid corrected plan, not from the earlier assembled plan unconditionally.

## Candidate Wiki Destinations

- Update [Code Task Execution Functional Specification](../../docs/wiki/functional/code-task-execution.md) with semantic review retry and corrected-plan handling.
- Update [Plan Engine Module Design](../../docs/wiki/modules/plan-engine.md) with rejected semantic review response behavior.
- Consider updating [Agent Harness High-Level Design](../../docs/wiki/subsystems/agent-harness.md) if its interaction diagram should show review retries.

## Existing Pages To Link

- [Agent Harness High-Level Design](../../docs/wiki/subsystems/agent-harness.md)
- [Plan Engine Module Design](../../docs/wiki/modules/plan-engine.md)
- [Code Task Execution Functional Specification](../../docs/wiki/functional/code-task-execution.md)

## Open Questions

No open questions.

## Privacy And Sensitivity Notes

No private, proprietary, sensitive, PII, or company-internal content was captured.

## Ingest Rationale

The existing wiki captures semantic review and corrected-plan handling, but the retry loop for rejected semantic review responses is only clear in source code and tests.
