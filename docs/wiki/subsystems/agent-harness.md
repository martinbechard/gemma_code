# Agent Harness High-Level Design

## Current Understanding

The agent harness transforms user prompts into model chat requests, structured planning, semantic review, tool execution, evidence gathering, verification, and streamed UI or terminal events.

## Authoritative Sources

- [Main Process](../modules/main-process.md)
- [CLI Runtime](../modules/cli-runtime.md)
- [Tool Runtime](../modules/tool-runtime.md)
- [Plan Engine](../modules/plan-engine.md)
- [General purpose plan harness](../../../design/general-purpose-plan-harness.md)
- [README app workflow](../../../README.md)

## Related Code

- [src/main/index.ts](../../../src/main/index.ts)
- [src/cli/agent.ts](../../../src/cli/agent.ts)
- [src/main/tools/index.ts](../../../src/main/tools/index.ts)
- [src/main/plan](../../../src/main/plan)
- [Gemma prompt files](../../../Gemma.code.md)

## Related Tests

- [tests/main/actionParser.test.ts](../../../tests/main/actionParser.test.ts)
- [tests/main/plan](../../../tests/main/plan)
- [tests/cli/agentPlanPrompts.test.ts](../../../tests/cli/agentPlanPrompts.test.ts)
- [tests/main/codeSystemPrompt.test.ts](../../../tests/main/codeSystemPrompt.test.ts)

## Related Backlog Items

- Not yet identified.

## Related Wiki Pages

- [Architecture](../technical/architecture.md)
- [Code Task Execution](../functional/code-task-execution.md)
- [Tool Runtime](../modules/tool-runtime.md)
- [Plan Engine](../modules/plan-engine.md)

## Open Questions

No open wiki questions are recorded for this topic.

## Maintenance Notes

- Recheck when prompt modes, plan review, evidence forcing, verification, or tool protocol changes.

## Parent Architecture

[Architecture](../technical/architecture.md) governs this subsystem.

## Scope

Includes chat prompt assembly, code plan assembly, semantic review, execution prompts, tool loop, evidence checks, verification prompts, retries, and stream emission.

```mermaid
flowchart TB
  subgraph AgentHarnessSubsystem["Agent harness subsystem"]
    ChatPromptAssembly["Chat prompt assembly"]
    CodePlanAssembly["Code plan assembly"]
    SemanticReview["Semantic review"]
    ExecutionPrompts["Execution prompts"]
    ToolLoop["Tool loop"]
    EvidenceChecks["Evidence checks"]
    VerificationPrompts["Verification prompts"]
    RetryBehavior["Retry behavior"]
    StreamEmission["Stream emission"]
  end

  subgraph OutsideHarness["Outside this subsystem"]
    ToolImplementation["Individual tool implementation"]
    ProductRequirements["Product requirement decisions"]
  end

  ToolLoop --> ToolImplementation
  StreamEmission --> ProductRequirements
```

## Current Data Anchors

- User messages and tool results become model chat messages.
- Plan steps are YAML records with name, prompt, and verify fields.
- StreamChunk records carry model tokens, tool calls, plan nodes, reviews, harness messages, done, and errors.

```mermaid
flowchart LR
  UserMessages["User messages"] --> MlxMessages["Model chat messages"]
  ToolResults["Tool results"] --> MlxMessages
  PlanYaml["Plan YAML records"] --> PlanExecutionState["Plan execution state"]
  StreamChunk["StreamChunk records"] --> ElectronEvents["Electron stream events"]
  StreamChunk --> TerminalEvents["Terminal output events"]
```

## Constituent Components

- [Main Process](../modules/main-process.md) adapts harness output to Electron.
- [CLI Runtime](../modules/cli-runtime.md) adapts harness output to terminal workflows.
- [Tool Runtime](../modules/tool-runtime.md) provides action protocol and tool dispatch.
- [Plan Engine](../modules/plan-engine.md) provides plan, evidence, and verify behavior.

```mermaid
flowchart LR
  MainProcess["Main Process"] --> PlanEngine["Plan Engine"]
  MainProcess --> ToolRuntime["Tool Runtime"]
  CliRuntime["CLI Runtime"] --> PlanEngine
  CliRuntime --> ToolRuntime
  PlanEngine --> ToolRuntime
  ToolRuntime --> PlanEngine
```

## Interaction Model

The harness builds a system prompt, streams model output, parses actions, runs tools, records tool evidence, prompts for summaries and verification, and advances or retries based on evidence-backed results.

```mermaid
sequenceDiagram
  actor User
  participant Surface as Electron or CLI
  participant Harness as Agent harness
  participant Model as MLX model stream
  participant Plan as Plan engine
  participant Tools as Tool runtime
  participant Workspace as Workspace or shell

  User->>Surface: Submit request
  Surface->>Harness: Build prompt context
  alt Chat mode
    Harness->>Model: Stream chat messages
  else Code auto mode
    Harness->>Plan: Assemble plan
    Plan->>Tools: Run read-only inspection
    Tools-->>Plan: Tool result
    Plan-->>Harness: Validated and reviewed plan
    Harness->>Model: Reset into execution prompt
  end
  loop Tool and verification rounds
    Model-->>Harness: Token stream or action block
    alt Tool action
      Harness->>Tools: Dispatch action
      Tools->>Workspace: Read or modify workspace
      Workspace-->>Tools: Result
      Tools-->>Harness: Tool result and evidence
      Harness->>Model: Continue with evidence
    else Step summary
      Harness->>Plan: Record step state
      Harness->>Model: Request verification
    else Verify result
      Harness->>Plan: Advance, retry, or abort
    end
  end
  Harness-->>Surface: Stream chunks, done, or error
  Surface-->>User: Display result
```

## Lifecycle

Chat mode runs a bounded tool loop. Code auto mode assembles and reviews a plan, resets into execution context, executes each step, verifies, and emits terminal done or error chunks.

```mermaid
stateDiagram-v2
  [*] --> RequestReceived
  RequestReceived --> ChatToolLoop: chat mode
  RequestReceived --> PlanAssembly: code auto mode
  PlanAssembly --> SemanticReview
  SemanticReview --> ExecutionContext
  ExecutionContext --> StepExecution
  StepExecution --> StepVerification
  StepVerification --> StepExecution: retry
  StepVerification --> Done: step passes and no work remains
  ChatToolLoop --> Done
  ChatToolLoop --> Error
  StepExecution --> Error
  Done --> [*]
  Error --> [*]
```

## Data Shapes And Contracts

PlanExecutionState owns plan node events. ToolCall records capture action name, args, result, errors, running state, and optional parent step id.

```mermaid
flowchart LR
  PlanYaml["Plan YAML records"] --> PlanExecutionState["PlanExecutionState"]
  ToolCall["ToolCall records"] --> PlanExecutionState
  ToolCall --> StreamChunk["StreamChunk records"]
  PlanExecutionState --> PlanNodeEvents["plan_node events"]
  PlanNodeEvents --> StreamChunk
  StreamChunk --> SurfaceOutput["Electron or CLI output"]
```

## Configuration

Maximum rounds, retry limits, repeated action thresholds, and incomplete step thresholds are constants in main and CLI harness files.

```mermaid
flowchart TB
  MainHarnessConstants["Main process harness constants"] --> HarnessLimits["Harness execution limits"]
  CliHarnessConstants["CLI harness constants"] --> HarnessLimits
  HarnessLimits --> MaximumRounds["Maximum rounds"]
  HarnessLimits --> RetryLimits["Retry limits"]
  HarnessLimits --> RepeatedActionThresholds["Repeated action thresholds"]
  HarnessLimits --> IncompleteStepThresholds["Incomplete step thresholds"]
```

## Implementation Order

Parser and evidence behavior should be updated before caller loops depend on new plan or verification semantics.

```mermaid
flowchart LR
  ParserBehavior["Parser behavior"] --> EvidenceBehavior["Evidence behavior"]
  EvidenceBehavior --> CallerLoops["Main and CLI caller loops"]
  CallerLoops --> VerificationSemantics["Plan verification semantics"]
```

## Invariants

- Planning inspection actions are not implementation steps.
- Execution should not rely on planning scratch work as current code evidence.
- Verification must fail without visible proof.
- Tool calls are associated with active plan steps when possible.

## Non-Goals

- The harness does not own individual tool implementation behavior.
- The harness does not decide product requirements beyond the user's prompt and project instructions.

## Definition Of Good

The same request semantics are available through Electron and CLI, with visible plan, tool, evidence, and verification behavior.

## Verification

Use [tests/main/plan](../../../tests/main/plan), [tests/main/actionParser.test.ts](../../../tests/main/actionParser.test.ts), [tests/cli/agentPlanPrompts.test.ts](../../../tests/cli/agentPlanPrompts.test.ts), and [tests/main/codeSystemPrompt.test.ts](../../../tests/main/codeSystemPrompt.test.ts).

```mermaid
flowchart LR
  PlanTests["tests/main/plan"] --> PlanEngine["Plan Engine"]
  ActionParserTests["tests/main/actionParser.test.ts"] --> ToolRuntime["Tool Runtime"]
  CliPromptTests["tests/cli/agentPlanPrompts.test.ts"] --> CliRuntime["CLI Runtime"]
  CodePromptTests["tests/main/codeSystemPrompt.test.ts"] --> MainProcess["Main Process"]
  PlanEngine --> HarnessBehavior["Agent harness behavior"]
  ToolRuntime --> HarnessBehavior
  CliRuntime --> HarnessBehavior
  MainProcess --> HarnessBehavior
```
