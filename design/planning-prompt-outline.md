# Planning Prompt Minimal Outline

## Keep In The Prompt

- Plan one step at a time.
  - KEEP
  - The prompt should say to emit one plan step per response, or plan: done when complete.
  - BECAUSE: The harness accumulates one fragment at a time and asks for the next fragment.

- Allow read-only inspection during planning.
  - KEEP
  - The prompt should allow listing, searching, reading files, and safe read-only commands before writing a plan step.
  - BECAUSE: The planner must look at the real project to choose correct files and avoid guessed plans.

- Forbid mutation during planning.
  - KEEP
  - The prompt should forbid editing, writing, creating, deleting, and mutating shell commands.
  - BECAUSE: Planning decides what should happen; execution performs approved changes later.

- Mention execution context reset.
  - KEEP
  - The prompt should say execution starts from the approved plan, not the full planning chat.
  - BECAUSE: Any fact needed later must be captured in a plan step or discovered again by a step.

- Require exact target files after inspection.
  - KEEP
  - The prompt should say mutation steps must name exact files or artifacts.
  - BECAUSE: Execution steps like change the identified files are not executable after context reset.

- Forbid locator-only execution steps.
  - KEEP
  - The prompt should say not to add execution steps whose only purpose is locate, determine, or identify targets.
  - BECAUSE: Target discovery belongs in planning inspection, not in an approved execution step.

- Require executable verification.
  - KEEP
  - The prompt should say include only verification needed by the request and project rules.
  - BECAUSE: The final plan must prove the work was done without bloating every plan with every possible check.

- Forbid filler steps.
  - KEEP
  - The prompt should forbid report, summarize, conclude, cleanup, final-check, and repeated verification steps.
  - BECAUSE: These do not change or verify the project and waste execution turns.

- Forbid placeholders.
  - KEEP
  - The prompt should reject placeholder names and wording such as relevant files, needed files, and example file names.
  - BECAUSE: Placeholders hide missing project knowledge and produce non-executable plans.

- Define the YAML shape.
  - KEEP
  - The prompt should define plan.steps with one item containing name, prompt, and verify.
  - BECAUSE: The harness parser needs a stable shape.

- Define the done signal.
  - KEEP
  - The prompt should show plan: done.
  - BECAUSE: The harness needs a clear stop signal for plan assembly.

- Ask a clarifying question only when inspection cannot resolve ambiguity.
  - KEEP
  - The prompt should allow one focused question when file set or behavior remains ambiguous.
  - BECAUSE: A guessed plan is worse than pausing on a real ambiguity.

## Remove From The Prompt

- Semantic review protocol.
  - REMOVE
  - This includes review context, OriginalRequest blocks, checklist enums, and corrected plan schema.
  - WHY REMOVE: The planner does not need harness internals to produce the next step.

- Deterministic validator internals.
  - REMOVE
  - This includes shape-only validation details and duplicate-name validation details.
  - WHY REMOVE: The planner only needs the output contract and executable-step rules.

- No-action-tags rule as currently written.
  - REMOVE
  - The current wording forbids the inspection we want planning to perform.
  - WHY REMOVE: It directly contradicts read-only planning inspection.

- Broad checklist of docs, focused verification, full suite, and build.
  - REMOVE
  - Replace it with required verification only.
  - WHY REMOVE: It encourages oversized plans for small changes.

- Execution-mode warning not to emit YAML while executing a step.
  - REMOVE
  - WHY REMOVE: It belongs in the execute prompt, not the planning prompt.

- Specific example paths from one task.
  - REMOVE
  - WHY REMOVE: Examples can bias unrelated tasks and undercut the exact-target rule.
