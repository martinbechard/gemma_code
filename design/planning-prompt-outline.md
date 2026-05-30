# Planning Prompt Minimal Outline

## Keep In The Prompt

- Plan one step at a time.
  - KEEP
  - The prompt should say to emit one plan step per response, or plan: done when complete.
  - WHY DOES THE LLM NEED TO KNOW? Without this, it may emit a full plan, prose, or multiple steps that the harness will not treat as the next planning fragment.

- Allow read-only inspection during planning.
  - KEEP
  - The prompt should allow listing, searching, reading files, and safe read-only commands before writing a plan step.
  - WHY DOES THE LLM NEED TO KNOW? Without this, it may guess file names or avoid the inspection needed to produce a grounded plan.

- Forbid mutation during planning.
  - KEEP
  - The prompt should forbid editing, writing, creating, deleting, and mutating shell commands.
  - WHY DOES THE LLM NEED TO KNOW? Without this, it may start implementing before the user has approved the plan.

- Mention execution context reset.
  - KEEP
  - The prompt should say execution starts from the approved plan, not the full planning chat.
  - WHY DOES THE LLM NEED TO KNOW? Without this, it may rely on planning-chat details that the execution model will not see.

- Require exact target files after inspection.
  - KEEP
  - The prompt should say mutation steps must name exact files or artifacts.
  - WHY DOES THE LLM NEED TO KNOW? Without this, it may write vague mutation steps that cannot be executed reliably in a fresh context.

- Forbid locator-only execution steps.
  - KEEP
  - The prompt should say not to add execution steps whose only purpose is locate, determine, or identify targets.
  - WHY DOES THE LLM NEED TO KNOW? Without this, it may spend approved execution turns rediscovering what planning should already have resolved.

- Require executable verification.
  - KEEP
  - The prompt should say include only verification needed by the request and project rules.
  - WHY DOES THE LLM NEED TO KNOW? Without this, it may omit proof of completion or add excessive verification that does not fit the request.

- Forbid filler steps.
  - KEEP
  - The prompt should forbid report, summarize, conclude, cleanup, final-check, and repeated verification steps.
  - WHY DOES THE LLM NEED TO KNOW? Without this, it may add non-work steps that look orderly but do not advance the task.

- Forbid placeholders.
  - KEEP
  - The prompt should reject placeholder names and wording such as relevant files, needed files, and example file names.
  - WHY DOES THE LLM NEED TO KNOW? Without this, it may mask uncertainty with generic wording instead of inspecting or asking.

- Define the YAML shape.
  - KEEP
  - The prompt should define plan.steps with one item containing name, prompt, and verify.
  - WHY DOES THE LLM NEED TO KNOW? Without this, it may produce valid-looking text that cannot be parsed into an executable step.

- Define the done signal.
  - KEEP
  - The prompt should show plan: done.
  - WHY DOES THE LLM NEED TO KNOW? Without this, it may keep inventing steps after the plan is already complete.

- Ask a clarifying question only when inspection cannot resolve ambiguity.
  - KEEP
  - The prompt should allow one focused question when file set or behavior remains ambiguous.
  - WHY DOES THE LLM NEED TO KNOW? Without this, it may fabricate intent or target files when inspection cannot answer the question.

## Remove From The Prompt

- Semantic review protocol.
  - REMOVE
  - This includes review context, OriginalRequest blocks, checklist enums, and corrected plan schema.
  - WHY REMOVE: It teaches the LLM about a later harness phase instead of helping it decide the next planning action.

- Deterministic validator internals.
  - REMOVE
  - This includes shape-only validation details and duplicate-name validation details.
  - WHY REMOVE: It distracts the LLM with implementation details; the useful part is the required output shape.

- No-action-tags rule as currently written.
  - REMOVE
  - The current wording forbids the inspection we want planning to perform.
  - WHY REMOVE: It would stop the LLM from gathering the evidence needed to plan correctly.

- Broad checklist of docs, focused verification, full suite, and build.
  - REMOVE
  - Replace it with required verification only.
  - WHY REMOVE: It pushes the LLM to add boilerplate checks instead of choosing verification from the actual request.

- Execution-mode warning not to emit YAML while executing a step.
  - REMOVE
  - WHY REMOVE: It describes a mode the LLM is not currently in, so it adds noise to planning.

- Specific example paths from one task.
  - REMOVE
  - WHY REMOVE: They can cause the LLM to copy irrelevant paths instead of inspecting the current request.
