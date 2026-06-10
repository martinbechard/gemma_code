# Gemma Code Article Draft

## Commit Reconstruction

### 1. Inherited Gemma Chat Baseline

This phase belongs to the original upstream Gemma Chat project by Ammaar Reshi. It matters for the article as inherited context, not as part of the Gemma Code work. The fork starts from a polished local Gemma app with MLX-LM, model switching, runtime fixes, branding, and the first vibe code without the internet framing.

- ae32c62 Upstream initial commit: establishes the baseline Gemma Chat app.
- e18e7df Replaces the original backend path with MLX-LM, adds model switching, and starts pushing the app toward a local-first coding surface.
- ac77e9d Updates the app icon to the blue Gemma star design, giving the project its own visual identity.
- d2d8bc0 Fixes Build mode so code generation starts immediately instead of drifting into plan-only responses.
- 3352e5b Tightens Python compatibility by requiring Python 3.10+ and pinning mlx-lm.
- 9d8ba2f Polishes the UI with a resizable canvas, Build tab default, Gemma avatar, and original author credit.
- fca308c Marks the v0.1.0 identity: vibe code without the internet.
- 84e0180 Updates README to match the early product framing.

### 2. Gemma Code Fork Begins: CLI And Planning Appear

This is where the fork's work begins. The project stops being only an inherited app and starts becoming a workflow harness. The CLI, planning protocol, prompt visibility, and approval flow arrive.

- bb61e6f Adds the first CLI, Gemma.md tool docs, workspace override support, and MLX 0.31.3 patch.
- a2c9944 Introduces the plan protocol with verification fields, nested plans, and tool-call drill-down.
- a65b1a0 Splits plan execution into propose and approve phases so execution is no longer automatic.
- 1e5d987 Splits the system prompt into mode-specific addenda and makes prompts visible for debugging.
- 233d1a9 Clarifies Code mode so new-code requests stop collapsing into nested planning loops.
- 91054fb Auto-loads the conversation model on startup and locks mode once a Code conversation starts.

### 3. Plan Assembly Becomes Incremental

The model's plan output proves too fragile as one big artifact, so the system starts assembling plans one step at a time, with validation before save.

- 7538923 Adds isolated CLI execution and a datetime tool, making command-line runs safer and more testable.
- 3c00cff Hardens YAML plan execution against malformed or unsafe plan structures.
- ef26257 Removes prompt marker noise that was leaking into model behavior.
- 86e4232 Adds a design note for iterative plan assembly.
- 30f7719 Defines the regression-test contract for iterative plan assembly.
- ddac8a8 Adds state tracking for assembling plans incrementally.
- 19c8823 Implements one-prompt-at-a-time plan assembly.
- 27d8c3c Updates Plan mode documentation to describe iterative prompt assembly.
- e33ca7e Validates assembled plans before saving them.

### 4. Harness Hardening

This phase is mostly failure-mode capture. The model loops, retries poorly, mishandles done markers, and needs more precise execution scaffolding.

- ff08bae Stabilizes plan execution tool flow after early execution failures.
- 5202b94 Fixes plan harness verification and improves logging.
- 09e9e30 Hardens retries during plan execution.
- 24085f3 Defaults the app to Gemma 4 E4B.
- ad35cdb Adds a structured marker for plan completion.
- 208a423 Documents the AI collaboration workflow.
- 9bb679a Fixes parsing for the plan assembly done sentinel.
- 5710b4e Hardens host-tool plan execution.
- 728c67c Improves recovery when host-tool prompts fail.
- 554ac51 Generalizes host-tool planning prompts so they are less request-specific.
- e661a24 Removes repeated host-tool planning guidance that was bloating prompts.
- 2eda127 Fixes generic plan assembly prompts.

### 5. Prompt Cleanup And Semantic Review

The harness becomes more general-purpose. Planning, execution, and semantic review are separated so each stage has a smaller job.

- f236a2c Clarifies how user requests are represented in plan assembly prompts.
- a28b1bf Generalizes plan harness validation.
- 902d7fa Removes host persona language from harness prompts.
- e761c64 Splits code planning prompts from code execution prompts.
- fbaa710 Runs semantic review in an isolated context.
- 3be29b4 Adds a structured checklist for reviewing plans.
- 614daad Keeps the original user request visible after planning.
- 7f44ad3 Stabilizes recovery when plan execution tools fail.
- 09b8634 Adds a button to open execution logs.
- ea9f00c Accepts self-closing action tags.
- 8889724 Adds search_files and the execution log viewer.
- 28560ef Makes search_files independent of rg.
- d7aa3ed Requires mutation evidence for plan steps.
- 78f1f5b Stabilizes corrected plans returned by semantic review.
- 6977d51 Stops unsafe edit-recovery rewrites.
- bb59e12 Prefers write_file for code changes.
- b8acbfe Allows failed plan executions to be rerun.
- 4b80fd8 Keeps completed plans visible as done.
- 591f262 Aborts repeated no-action plan steps.
- dcb506f Improves summaries in the execution log viewer.
- 29c813c Clarifies model context in detailed logs.
- 7201d71 Allows regeneration from the original user request.
- 65e8ed2 Trims the plan execution step prompt.
- edc5d7f Adds structured step summaries and error handling.
- f457374 Compacts semantic review checklist output.

### 6. File Context And Tool Modularity

This is the infrastructure cleanup phase: file reads become tracked context, and the monolithic tools implementation is split into inspectable modules.

- 0608a20 Tracks file context for read tools so the agent can see which files are already in scope.
- 481f616 Splits the tool registry into modules under src/main/tools.

### 7. CLI Parity, Prompt Simplification, Exact Logs, Edit Workflow

The CLI is brought up to the same standard as the app. The workflow becomes: plan, review, reset context, execute, verify, and log the exact model calls.

- 565c7bc Fixes CLI tool imports and review parsing.
- c0b82e1 Aligns the CLI workflow with executable plans.
- 9d8e3db Resets CLI context before plan execution.
- d785fc3 Directs planning to resolve target files instead of leaving discovery to execution.
- 97352b9 Documents the planning prompt outline.
- adc930c Simplifies the planning prompt.
- 3c5312a Refines the planning prompt outline.
- 075f3df Clarifies rationale labels in the planning outline.
- ca40661 Tightens the planning outline rationale.
- 8fef118 Simplifies the planning prompt workflow.
- 6ddf8b5 Logs exact model calls in the execution viewer.
- aa8482d Creates a separate execution log per run.
- 6118431 Requires Step wrappers around planning steps.
- f7c15c6 Clarifies that planning should emit the first step now.
- 39369a4 Enables the edit workflow during plan execution.
- 427e052 Hardens the CLI plan execution workflow.

### 8. Project Presentation

The project gets a README that reflects what it has actually become: not just Gemma Chat, but Gemma Code.

- 781e2eb Updates README for the final Gemma Code workflow, including CLI usage, plan/review/execute flow, logs, file context, prompt files, and modular tools.

## Interpretation

The Gemma Code commit history does not read like ordinary feature development. It reads like a lab notebook.

Each check-in captures one specific thing the local model did that was almost right but not quite safe enough to trust. The small commits were not just backups. They were experimental control points. They let us pin down one failure mode before the next one arrived wearing a different hat.

The inherited project was already a working local Gemma app. The Gemma Code story begins when we added a CLI and forced the workflow to become honest. The app already had a complicated path through planning, semantic review, execution, verification, and context reset. If the CLI skipped those stages, it was not testing the product. It was testing a shortcut.

The other big story is context hygiene. A coding model does not just need access to files. It needs to know which version of the file is current. Keeping multiple reads of the same file in the conversation history created confusion that looked like bad reasoning, but was partly bad memory management. Once reads, writes, and edits became part of file context, the system had a cleaner source of truth.

The prompt work follows the same pattern. We kept trimming, splitting, and clarifying prompts because every extra instruction was another place for contradiction to hide. The planning prompt especially needed to become smaller and more precise: locate exact files during planning, emit one step at a time, and stop when the accepted plan is complete.

The log viewer is the final expression of that same instinct. We needed to see the actual prompt and the actual response. Not the UI summary. Not what we thought the prompt said. The real thing.

## Article Draft

# I accidentally built a workflow harness for my AI coding buddy

This project started with a fork.

The original project was Gemma Chat by Ammaar Reshi. It ran local models. It had a nice little interface. It could talk. It could help. It could maybe write code if you squinted and were feeling generous.

Then I forked it and tried to make it actually code.

That is when the project stopped being a chat app and became something stranger: a system for discovering all the ways a local coding model can be almost right.

The inherited history had already done the normal application work: move from Ollama to MLX-LM, add model switching, polish the UI, fix the runtime, and make the app look like something I might actually want to use.

My part of the story starts when the CLI arrived.

A CLI sounds like a convenience feature. It was not. It was the beginning of accountability.

Once the model could be run from the command line, I could ask a simple question: can it do the same workflow outside the UI that it does inside the app? Not can it produce some code-like text, but can it plan, execute, verify, and leave behind enough evidence that I can understand what happened?

The answer was: absolutely not. Which was useful.

So the project grew a planning protocol. At first it was a plan blob. Then the blob became structured YAML. Then the YAML needed verification fields. Then planning had to split into propose and approve. Then the app had to show the prompt, because debugging an invisible prompt is just superstition with extra steps.

This was the first big lesson: if you are building around an AI coding model, the prompt is not an implementation detail. The prompt is part of the product surface.

Then the planning got weirder.

The model would make plans, then make plans inside the plans. It would decide it was done, then continue. It would return a step it had already returned, get rejected for the duplicate, and then try the same thing again with the confidence of a machine that has never had to feel embarrassment.

So we moved to iterative plan assembly. One step at a time. Validate before saving. Reject malformed output. Add a done sentinel. Then fix the done sentinel. Then wrap steps in Step tags because apparently prose near YAML is how you summon chaos.

This is where the commit history starts looking obsessive, but it was not random fiddling. The small check-ins were experimental control points. Each commit pinned down one failure mode before the next one could contaminate the investigation.

A model looped on duplicate plan steps. Commit.

The review stage got too verbose and broke parsing. Commit.

The execution stage retried a dangerous rewrite. Commit.

The model claimed verification failed because there had been a tool error earlier, even though the final state was correct. Commit.

The app read the same file multiple times and kept stale versions in the conversation history, so the model was effectively coding in a haunted house full of old files. Commit.

That last one mattered more than it sounds. Coding agents live inside context. If context contains three versions of the same file, the model does not have more information. It has a time machine with no labels. So file reads became tracked context. New reads replace old reads. Writes and edits update the known file state. The conversation should contain the current file, not a museum exhibit of every mistake that led there.

Around the same time, the tools file got split apart.

This is one of those refactors that sounds like housekeeping until you are trying to debug a tool call at 1 a.m. A single giant tools file is fine until every behavior you care about is hiding in it. Splitting tools into a folder, one file per tool, made the system inspectable. It let the tool registry become a registry instead of a junk drawer.

The other major thread was parity between the app and the CLI.

The app workflow had become more sophisticated than the CLI workflow. In the app, we had planning, semantic review, context resets, execution, verification, and logs. The CLI had to run that same workflow, otherwise it was not a real test surface. It was just a smaller lie.

So the CLI got aligned with the full app flow. Planning resets before execution. The execution agent gets the accepted plan, not the planning conversation. The semantic review runs in its own context. Logs are written per execution instead of accumulating into one enormous archaeological dig. And most importantly, the logs include the exact prompts sent to the model and the exact responses that came back.

That sounds obvious. It was not obvious enough at the beginning.

When you are debugging an AI system, what I think I asked and what I actually sent are different things. The model can only respond to the second one. If the logs do not preserve the actual prompt and response, you are not debugging. You are doing literary criticism of vibes.

The funniest part is that the project's direction kept being set by tiny model failures.

A prompt said emit one YAML plan step but not clearly enough that this meant one at a time. So the model duplicated steps.

A planning prompt said not to inspect files at the same time we wanted planning to locate the files to change. So the model politely obeyed the contradiction, which is very rude behavior from software.

A verification stage treated previous tool failures as fatal even when the final state was correct. So verification had to become about final evidence, with failures downgraded to warnings when appropriate.

Every one of these sounded small. Every one exposed a design principle.

The final shape is much clearer now. Gemma Code is not just a chat UI. It is a local coding workflow with explicit stages:

- Plan the work.
- Review the plan.
- Reset context.
- Execute against exact files.
- Verify the final state.
- Log the actual model calls.
- Keep file context current.
- Make the CLI and app run the same workflow.

That may sound like overhead, but it is really the opposite. The overhead is what happens when an AI assistant casually rewrites the wrong file, forgets what it read, invents a plan that cannot execute, or claims failure because it remembers being confused earlier.

The harness is there to make the model smaller in the right ways.

Less improvisation.

Less stale context.

Less hidden prompt magic.

Less trust me, bro verification.

More evidence.

That is probably the real project now. Not can Gemma write code? but what structure does Gemma need around it to become a useful coding partner?

The answer, so far, is: a surprising amount.

But also, not an impossible amount. Just enough rails. Just enough logging. Just enough refusal to accept charming nonsense as progress.

Which, now that I say it out loud, may be the whole job.
