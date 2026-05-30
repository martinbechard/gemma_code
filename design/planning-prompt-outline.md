# Planning Prompt Outline

**PROCESS: PLAN-PROMPT** Gemma.plan.md responsibilities
SYNOPSIS: Defines how the model prepares executable plan steps before code execution.
GAP: The prompt currently mixes planning, inspection, validation internals, and execution-mode rules.

**RULE: MODE-CONTRACT** Emit one YAML step or done
SYNOPSIS: The model returns one plan step per response, or the done sentinel when complete.
STATUS: keep
BECAUSE: This is the core iterative planning contract.

**RULE: READ-ONLY-PLANNING** Planning may inspect, but may not mutate
SYNOPSIS: Planning should allow file listing, search, and reading so the model can ground the plan.
STATUS: improve
BECAUSE: The current no-inspection wording contradicts the desire to locate files during planning.

**RULE: FRESH-EXECUTION-CONTEXT** Execution starts without planning chat history
SYNOPSIS: The final plan must carry the facts and instructions needed by execution.
STATUS: keep
BECAUSE: This explains why plan steps must be concrete.

**RULE: GROUNDING-FIRST** Start non-trivial work with project grounding
SYNOPSIS: The first planning action should inspect project instructions and request-relevant files.
STATUS: improve
BECAUSE: This should describe actual read-only planning inspection, not a future execution step.

**RULE: EXACT-TARGETS** Mutation steps name exact files and artifacts
SYNOPSIS: After grounding, steps that change, create, or delete files must name their targets.
STATUS: keep
BECAUSE: This is the rule that prevents vague plans such as changing identified files.

**RULE: NO-LOCATE-ONLY-EXECUTION** Do not defer locating targets to execution
SYNOPSIS: Execution steps should perform work, not merely determine where work belongs.
STATUS: keep
BECAUSE: Planning is responsible for producing executable instructions.

**RULE: ONLY-NEEDED-VERIFICATION** Include verification required by the request and project rules
SYNOPSIS: Tests, documentation checks, full suite, and build should appear only when needed.
STATUS: improve
BECAUSE: The current list can push small changes toward oversized plans.

**RULE: NO-FILLER-STEPS** No stop, conclude, cleanup, final-check, or repeated verification steps
SYNOPSIS: The plan ends when required work and verification are covered.
STATUS: keep
BECAUSE: This prevents non-executable tail steps.

**RULE: VALIDATION-SHAPE** Deterministic validation checks executable plan shape
SYNOPSIS: The prompt should mention only the validation rules the model can act on.
STATUS: improve
BECAUSE: Details about shape-only validation weaken the exact-target rule.

**RULE: NO-PLACEHOLDERS** Do not use placeholder names or wording
SYNOPSIS: Plan steps must use task-specific files, commands, artifacts, and evidence.
STATUS: keep
BECAUSE: This directly blocks generic plans.

**RULE: REVIEW-DETAILS** Fresh semantic review context
SYNOPSIS: The plan is reviewed after assembly.
STATUS: remove
BECAUSE: The full review protocol is harness internals and adds prompt bulk.

**RULE: CLARIFY-WHEN-BLOCKED** Ask one focused question when ambiguity changes behavior
SYNOPSIS: Planning should ask only when file set or intended behavior cannot be resolved.
STATUS: keep
BECAUSE: This is the right fallback for under-scoped requests.

**RULE: YAML-SHAPE** Plan step fields
SYNOPSIS: A step has name, prompt, and verify fields under plan.steps.
STATUS: keep
BECAUSE: The model needs the output contract.

**RULE: STEP-EXAMPLE** YAML example
SYNOPSIS: The example should model exact paths or be removed.
STATUS: improve
BECAUSE: The current agent.ts example undercuts the exact-path rule.

**RULE: PLAN-MODE-NO-ACTIONS** Do not emit action tags
SYNOPSIS: This should change if planning is allowed to inspect files.
STATUS: improve
BECAUSE: Planning cannot both inspect files and forbid all action tags.

**RULE: EXECUTION-MODE-NO-YAML** Do not emit YAML while executing an approved step
SYNOPSIS: This belongs in the execution prompt, not the planning prompt.
STATUS: remove
BECAUSE: It is irrelevant to the model while it is in plan mode.
