# Article Critique Report: Working With Gemma Locally

## Executive Summary

The article has a strong core: it tells the story of turning Gemma Chat from a local vibe-coding demo into a practical Gemma Code workflow with CLI execution, planning, logging, and file-context hygiene. The voice is good: skeptical, practical, slightly exasperated, and grounded in real debugging.

The main opportunity is to make the article more useful to readers who do not already understand local LLMs. Right now, some sections assume the reader already knows why MLX matters, why a small model needs a harness, why tool calls are fragile, and why a frontier model might delegate work to a local model. Those are the most valuable insights in the article. They should be made explicit.

The article should move from “here is what happened while I built this” toward “here is what this taught me about making local AI useful.”

## Best Current Strengths

- The opening motivation is clear: avoid spending frontier-model subscription or API tokens on menial coding tasks.
- The MLX section gives concrete performance numbers instead of hand-wavy “it is fast now” claims.
- The runtime explanation is accessible: Electron front end, Node main process, Python MLX server, XML tool actions.
- The “starting pains” section has good texture. The MLX-LM version mismatch shows readers that local AI is not magic. It is software, and software has broken dependencies.
- The CLI section is the strongest product insight. It turns the article from a review of Gemma Chat into a story about creating a local worker that a stronger AI could drive.
- The context hygiene section is excellent and should probably be elevated. It is one of the most generalizable lessons for people building or using coding agents.

## Main Audience Problem

The likely reader may think of vibe coding tools as a magical chat box that writes code. They may not understand that useful coding agents are really a stack:

- a model
- a prompt
- a runtime
- a set of tools
- a workspace
- a memory or context policy
- a verification loop
- logs
- a human or stronger model supervising the work

The article currently reveals those pieces gradually, but it does not always pause to explain why each one matters. Add short “what this means if you are new to local LLMs” moments throughout.

## Recommended Thesis

Consider making the thesis more explicit near the top:

Local models are not about replacing frontier models. They are about changing the economics of agentic work. A frontier model can remain the planner, reviewer, and supervisor, while a cheap local model does the repetitive file inspection, small edits, retries, and verification loops.

That is the real promise of the Gemma CLI: not “free Claude,” but “a local coding worker that can be driven by a better model.”

## Suggested Reader-Friendly Framing

### Current Frame

You are recounting attempts to use and extend Gemma Chat.

### Stronger Frame

You are investigating whether a local LLM can become a subordinate coding worker.

This distinction matters. The first sounds like a project diary. The second gives readers a conceptual hook:

- Frontier model: expensive but smart supervisor.
- Local model: cheap but unreliable worker.
- Harness: the management layer that makes the worker useful.
- CLI: the interface that lets another AI invoke the worker task by task.

## Section-Level Critique

### Opening

The opening is good, but it could be sharper. The line about avoiding use of AI subscriptions on menial tasks is the article’s most commercially resonant point. Move that idea closer to the first paragraph and make it the central question.

Suggested emphasis:

- “Can I use a paid frontier model only for the parts that require judgment?”
- “Can a local model do the repetitive coding chores once the work is decomposed?”
- “Can I turn a vibe-coding app into a local agent worker?”

This will resonate with readers who are already discovering that per-token pricing makes agentic coding expensive.

### The Power Of MLX

This section is useful, but it needs one plain-language bridge before the performance numbers.

Add a simple explanation:

MLX matters because Apple Silicon Macs do not have a separate NVIDIA-style GPU memory setup. The CPU and GPU share memory, and MLX is designed around that. That makes it a better fit for running models locally on an M-series Mac than older local setups that were not as Mac-native.

Then keep the Ollama comparison, but make the timing clear:

- You tried Ollama earlier and found it too slow.
- Ollama later added MLX support.
- That is evidence that the ecosystem is moving toward MLX on Macs.

Avoid making it sound like MLX-LM and Ollama are direct competitors in all contexts. Ollama is more of a packaged local model manager/server. MLX-LM is closer to the Apple Silicon runtime layer.

### Gemma Chat First Look

This section can do more explanatory work. The original app architecture is a great chance to demystify vibe coding.

Make the point:

A vibe-coding app is not just a model. It is a loop:

- user asks for something
- model emits text
- host app detects tool commands inside that text
- host app writes files or runs commands
- model sees the result
- preview updates

This helps non-technical readers understand why agent apps are fragile. The model is not directly “editing your computer.” The app is parsing model output and deciding what to do.

### Starting Pains

This is a good reality-check section. Keep the detail, but add the reader takeaway.

Suggested takeaway:

Local AI gives you control, but it also gives you ownership of the runtime. With cloud APIs, the provider hides model-serving problems from you. With local LLMs, you own the Python environment, the model cache, the server process, the GPU memory, and sometimes even the compatibility bugs between model checkpoints and runtime versions.

That is a useful, honest counterweight to “free local AI.”

### Using Local Folders

This is an important transition, but the article should make the conceptual shift clearer:

The original app was a sandboxed builder. You wanted a repo-aware coding agent.

Explain the difference:

- Sandbox builder: good for new toy apps, demos, and previews.
- Repo-aware coding agent: needs to read existing files, preserve context, make small edits, run tests, and avoid damaging unrelated code.

That distinction is useful for readers because many vibe-coding tools are optimized for greenfield generation, not maintenance work.

### REPL / CLI

This section should probably be renamed. “REPL” does not capture the strategic point. Consider:

- The CLI Is The Product
- From App To Worker
- Making Gemma Callable
- Turning Gemma Into A Local Sub-Agent

This is where the article’s biggest idea appears. The CLI is not just convenient. It is what lets a frontier model orchestrate the local model.

Add the architecture:

- A frontier model receives the user’s broad request.
- It decomposes the work into small tasks.
- It invokes the Gemma CLI for tasks that are cheap, local, or repetitive.
- Gemma performs file inspection or edits.
- Logs and verification evidence go back to the frontier model.
- The frontier model decides whether to continue, retry, or escalate.

This is the “cost reduction” story. Make it explicit.

### Gemma.md

This section is good, but it can be generalized:

Prompt externalization is not just convenience. It is how you turn model behavior into a maintainable artifact.

Readers will understand this if you compare it to configuration:

- If the behavior is buried in code, you debug by spelunking.
- If the behavior is in a prompt file, you can inspect, revise, diff, and test it.

This is especially important for smaller local models because small prompt contradictions can create large behavior failures.

### Build Mode Versus Code Mode

This section contains the key insight that small local models need scaffolding. It should be framed less as disappointment and more as a design discovery.

Suggested framing:

The small model was not bad. It was under-managed.

That is a powerful line because it avoids the common binary debate of “local models are useless” versus “local models are amazing.” The more useful claim is:

Small models can be useful when the task is decomposed, the context is controlled, and the harness keeps them from wandering.

### Step By Step

This section should explain why one-step-at-a-time planning worked.

For unfamiliar readers:

Asking a small model to produce a complete plan in one response is like asking a junior developer to design the whole migration in one breath. Asking for one step at a time lets the harness validate each piece before continuing.

The important concept is that the harness changes the shape of the task. It does not make the model smarter. It makes the work easier to perform correctly.

### Context Hygiene

This is one of the best sections and should be expanded slightly.

Make the point:

Agent context is not memory in the human sense. It is a pile of text. If that pile contains old versions of a file, the model can easily reason from the wrong version.

This is a very useful insight for readers. It explains why agents can appear confused even when they are “following the conversation.”

Suggested practical rule:

If a tool reads or edits files, the harness should maintain a current file-context view and avoid replaying stale file contents.

This is helpful advice that goes beyond the specific project.

### Logging

This section is currently too short for how important it is.

Expand the lesson:

When working with agents, logs are not optional debugging decoration. They are the only way to know the difference between:

- what you thought you asked
- what the harness actually sent
- what the model actually returned
- what tools actually ran
- what changed on disk

This will resonate with readers who have had an AI agent behave strangely but no way to reconstruct why.

## Missing Section: The Cost Architecture

Add a section near the end that explains the target workflow explicitly.

Possible heading:

The Cost Architecture

Core idea:

The expensive model should not be typing every line. It should be supervising. The local model should handle low-risk, well-scoped tasks that can be verified.

Suggested content:

- Frontier model creates or reviews plans.
- Gemma CLI executes narrow tasks locally.
- The harness logs every prompt, response, and tool result.
- The frontier model reviews the evidence.
- If Gemma fails, the frontier model can retry with a narrower instruction or take over.

This makes the article valuable to people thinking about AI coding costs, not just local model hobbyists.

## Missing Section: What Local Models Are Good For

Add a practical list. This is the kind of advice readers will remember.

Good local-model tasks:

- list files
- inspect a small set of files
- summarize a module
- make a narrow edit
- update repetitive text
- run tests and report failures
- collect evidence for a stronger model
- draft boilerplate once the plan is clear

Bad local-model tasks, unless heavily scaffolded:

- infer an architecture from a large repo
- perform broad refactors without file targets
- decide when a complex task is complete
- recover from ambiguous failures
- reason across many stale file versions
- invent a plan and execute it without review

This helps the reader understand that the design is not “local model replaces paid model.” The design is “local model gets the right jobs.”

## Missing Section: What The Harness Actually Adds

Readers may not know what “harness” means. Add a small explanatory section.

A harness is the layer around the model that:

- constrains what the model is allowed to do
- gives it tools
- parses tool requests
- feeds results back
- tracks files in context
- retries or rejects malformed outputs
- verifies final state
- logs evidence

Without the harness, the model is just text completion. With the harness, it can participate in a workflow.

## Commit-History Gaps Worth Adding

The current article covers MLX setup, the initial CLI, prompt externalization, planning, validation, context hygiene, and logging. The commit history shows several additional lessons that would be useful to readers because they expose what practical agent work really requires.

### Gap 1: Isolation And Undoability

Relevant commits:

- 7538923 Add isolated CLI execution and datetime tool
- 427e052 Harden CLI plan execution workflow
- addb311 Isolate Gemma Code runtime and add thinking toggle

The article mentions CLI work, but not enough about isolation. This matters because a local coding agent operating on real files is exciting right up until it edits the wrong thing. Readers should understand that using a local model on a real repo creates a new safety problem.

Suggested lesson:

Once Gemma could work outside the sandbox, the next question became “how do I let it touch real files without making every experiment scary?” The answer was isolation: run risky CLI work in a worktree, keep the app runtime separate from the original Gemma Chat runtime, and make it possible to inspect or discard changes.

Why readers care:

This turns the article from “I made a CLI” into “I made a CLI I could afford to let an AI use.”

Suggested insert:

The moment a local model can write to a real repo, the problem changes. It is no longer a demo. It is a liability with a text box. So the CLI needed isolation: separate working copies for experiments, clear cleanup behavior, and later a separate app identity so Gemma Code would not accidentally talk to the original Gemma Chat runtime. Local does not automatically mean safe. Local just means the blast radius is your machine.

### Gap 2: Approve-Before-Execute

Relevant commits:

- a65b1a0 Split plan execution into propose plus approve phases
- 4b80fd8 Keep completed plans visible as done
- b8acbfe Allow rerunning failed plan executions

The current article says planning and execution became separate, but it does not emphasize the human-control angle. For readers unfamiliar with coding agents, this is a big deal: the system should not jump from “I have an idea” to “I modified your repo.”

Suggested lesson:

Planning is not only for the model. Planning is also an interface for consent.

Why readers care:

It gives a concrete design principle for agentic tools: put a reviewable artifact between intention and mutation.

Suggested insert:

Splitting plan from execution was not just an implementation detail. It was a trust boundary. The model could propose what it wanted to do, but the harness could stop there and let me inspect the plan before it touched files. That is one of the big differences between a toy vibe-coding loop and something I might let loose in a real codebase.

### Gap 3: Evidence-Based Verification

Relevant commits:

- d7aa3ed Require mutation evidence for plan steps
- edc5d7f Add structured step summary and error handling
- 5202b94 Fix plan harness verification and logging

The draft mentions verification, but not the most important part: the agent should not be allowed to declare success just because it feels done. It needs evidence.

Suggested lesson:

Verification must be grounded in observed state, not model confidence.

Why readers care:

This is one of the clearest ways to demystify agentic coding. The model can say anything; the harness has to ask “what changed, what command ran, and what evidence proves it?”

Suggested insert:

I also learned that “verify” cannot mean “ask the model whether it thinks it succeeded.” It has to mean evidence. Did the file change? Did the symbol disappear? Did the test run? Did the search come back empty? Otherwise verification is just the model complimenting its own homework.

### Gap 4: Search And Absence Evidence

Relevant commits:

- 8889724 Add search tool and execution log viewer
- 28560ef Make search_files independent of rg
- d7aa3ed Require mutation evidence for plan steps

The current article talks about reading and editing files, but not about search. Search is important because many coding tasks are really about proving absence: the old tool is gone, the old import is gone, the obsolete symbol is gone.

Suggested lesson:

Agents need tools for negative evidence, not just file writing.

Why readers care:

This is practical advice for anyone building or evaluating coding agents. A model cannot reliably prove removal from memory; it needs repository search.

Suggested insert:

One surprisingly important tool was search. If the task is “remove this tool,” success is not just deleting one file. It is proving that no references remain. That means the harness needs a way to search the repo and feed absence evidence back to the model. Otherwise “done” just means “I stopped looking.”

### Gap 5: Loop Control

Relevant commits:

- 9bb679a Fix plan assembly done sentinel parsing
- 591f262 Abort repeated no-action plan steps
- 6118431 Require Step wrapper for planning steps
- f7c15c6 Clarify first planning step prompt

The draft has the funny duplicate-plan-step story, but it could make the broader lesson clearer: agents can get stuck in procedural loops, and the harness must detect that.

Suggested lesson:

Local models need stop conditions as much as they need prompts.

Why readers care:

It explains why “just prompt it better” is not enough. Some failures require mechanical guardrails.

Suggested insert:

Some of the strangest bugs were not wrong answers. They were loops. Gemma would repeat a step, get rejected, then repeat the same step with a new name, like a tiny bureaucrat trapped in a form. The fix was not a more inspirational prompt. It was mechanical: unique step names, explicit done markers, Step wrappers, and abort rules for repeated no-action turns.

### Gap 6: Prompt Complexity As A Bug Source

Relevant commits:

- 97352b9 Document planning prompt outline
- adc930c Simplify planning prompt
- 3c5312a Refine planning prompt outline
- 075f3df Clarify planning outline rationale labels
- ca40661 Tighten planning outline rationale
- 8fef118 Simplify planning prompt workflow

The article mentions ruthlessly focused prompts, but this commit cluster deserves more attention. It is highly useful to readers who assume more instructions are always better.

Suggested lesson:

Long prompts are not automatically safer. They can create contradictions.

Why readers care:

This is a practical insight for anyone using local or smaller models. Smaller models especially suffer when the prompt mixes process instructions, role-play, irrelevant constraints, and contradictory goals.

Suggested insert:

One counterintuitive discovery was that the planning prompt was too big. I kept wanting to add instructions, but the model was not failing because it lacked prose. It was failing because the prose contained contradictions. The fix was to make the prompt smaller and more exact: inspect enough to identify files, emit one step at a time, and stop when the plan is complete.

### Gap 7: Semantic Review As A Separate Context

Relevant commits:

- fbaa710 Isolate plan semantic review context
- 3be29b4 Add structured plan review checklist
- f457374 Compact semantic review checklist output
- 78f1f5b Stabilize semantic review corrected plans

The article mentions validation, but it does not explain why review needed a separate context. This is a useful agent-design lesson.

Suggested lesson:

Review is cleaner when it is not mixed with the messy planning conversation.

Why readers care:

It shows why agents need stage boundaries. A review model should judge the artifact, not inherit all the confusion that produced it.

Suggested insert:

The validation phase eventually needed its own clean context. That sounds fussy, but it mattered. If the reviewer inherits the whole messy planning conversation, it can repeat the same confusion. If it only sees the user request and the proposed plan, it can act more like a reviewer and less like an accomplice.

### Gap 8: Recoverability

Relevant commits:

- b8acbfe Allow rerunning failed plan executions
- 7201d71 Regenerate from user requests
- 7f44ad3 Stabilize plan execution tool recovery
- 39369a4 Enable edit workflow during plan execution

The draft explains failures, but not enough about recoverability. Practical users need to know that agent runs fail, and the product should make failure cheap.

Suggested lesson:

The right question is not “will the agent fail?” It will. The question is whether the workflow can recover without starting over.

Why readers care:

This makes the article more realistic and more useful for teams evaluating agent tools.

Suggested insert:

I eventually stopped treating failure as exceptional. Failed runs became part of the workflow. The app needed to rerun failed executions, regenerate from the original user request, and recover from tool failures without dragging every stale mistake forward. A local agent is much easier to trust when failure is cheap and visible.

### Gap 9: Anti-Foot-Gun File Mutation

Relevant commits:

- 6977d51 Stop unsafe edit recovery rewrites
- bb59e12 Prefer write_file for code changes
- 39369a4 Enable edit workflow during plan execution

The current context hygiene section talks about stale reads, but there is another important user-facing lesson: file mutation tools need guardrails.

Suggested lesson:

Tool design matters as much as model quality.

Why readers care:

This explains why a local agent is not just a model plus shell access. The host tools need safety behavior.

Suggested insert:

Some safety work had nothing to do with the model itself. It was about tool behavior. A bad recovery path could turn a failed edit into a destructive rewrite. So the file tools needed rules: block suspicious overwrites, prefer targeted edits when possible, reread after changes, and return the new file state. The host tools are part of the intelligence of the system.

### Gap 10: Visibility For The Human

Relevant commits:

- 09b8634 Add execution log open button
- dcb506f Improve execution log viewer summaries
- 29c813c Clarify detailed log model context
- 6ddf8b5 Log exact model calls in execution viewer
- aa8482d Create execution log per run
- 1ebf67e Show files in context in chat UI

The article mentions logs, but it can add that visibility is not only for debugging after the fact. It is also how the human keeps a mental model of what the agent knows.

Suggested lesson:

If the model has context, the human should be able to see that context too.

Why readers care:

This makes the UI insight practical. Agent UX is not just chat bubbles; it is state visibility.

Suggested insert:

Eventually I realized that hiding context from the human was almost as bad as hiding it from the model. If Gemma had read three files, I needed to see that without opening every tool card. If the exact prompt had been sent, I needed to inspect it. Agent UX is not just a nicer chat bubble. It is making the invisible workflow visible enough to trust.

### Gap 11: Runtime Interference Between Apps

Relevant commits:

- addb311 Isolate Gemma Code runtime and add thinking toggle

This happened after the current article draft and is worth including because it is a very local-LLM-specific lesson. The original app and the fork shared app identity, app data, and server port, which meant they could interfere with each other.

Suggested lesson:

Local model apps share local resources unless you deliberately isolate them.

Why readers care:

This is a non-obvious cost of local-first tooling. Cloud apps have tenant isolation. Local experiments often start with shared ports, shared caches, and shared app names.

Suggested insert:

One final very local bug: I accidentally had the original Gemma Chat and my fork running near each other. They shared the same app identity, app data path, and MLX server port. That meant it was possible to think I was testing Gemma Code while actually talking to the wrong local server. This is the kind of problem cloud APIs hide from you. Locally, you own the plumbing, including the pipes that cross.

### Gap 12: Thinking Output As A Debugging Mode

Relevant commits:

- addb311 Isolate Gemma Code runtime and add thinking toggle

The article currently mentions weird model output and chain-like responses, but it does not yet frame thinking output as a deliberate debugging choice.

Suggested lesson:

Reasoning traces can be useful diagnostically, but they should be optional and clearly separated from actions.

Why readers care:

This avoids presenting raw model thoughts as magic insight. It frames them as debugging material that must not accidentally trigger tools.

Suggested insert:

I also added a thinking toggle. Not because I want to worship the model’s inner monologue, but because sometimes the intermediate reasoning explains why it is going off the rails. The important part was keeping that thinking separate from executable tool actions. If a model says “maybe I should read this file” inside a thinking block, the harness must not treat that as a real command.

## Most Valuable Missing Lessons For Readers

If space is limited, prioritize these five additions:

1. The CLI needs isolation before it is safe to drive against real repos.
2. Plan approval is a trust boundary, not just a workflow feature.
3. Verification must be evidence-based, especially for file removals.
4. Prompt complexity can create contradictions; smaller prompts can work better.
5. Visibility matters: logs, files in context, and exact model calls make agents debuggable.

## Specific Style Suggestions

- Keep the “diddly-squat” line. It is funny and human. Just follow it with the practical lesson so the reader does not get lost in the MLX-LM details.
- Fix small typos: “enventually” should be “eventually”; “surperfluous” should be “superfluous”; “One of the the” should be “One of the”.
- Avoid overloading the article with commit-by-commit reconstruction. The current draft wisely does not do that. Keep the commits in the background.
- Use short explanatory pivots after technical passages: “The takeaway is...” or “In non-runtime-nerd terms...”
- Be careful with “GPT 5.5” if the final audience might challenge model naming. If that is private shorthand, consider saying “a frontier model” or “a paid frontier model.”
- “Vibe coding” is useful, but define the contrast: vibe coding is generation-first; agentic coding is workflow-first.

## Suggested Revised Outline

1. Why I cared: local AI as a way to reduce frontier-model costs.
2. What Gemma Chat was: a local vibe-coding app using MLX-LM.
3. Why MLX matters on a Mac: Apple Silicon, unified memory, better local performance.
4. The first reality check: local means you own the runtime.
5. From sandbox to real repo: why Build mode was not enough.
6. The CLI: turning Gemma into a callable local worker.
7. The harness: planning, validation, execution, verification.
8. Context hygiene: why stale file reads confuse agents.
9. Logging: why exact prompts and responses matter.
10. The bigger idea: frontier model as supervisor, local model as task worker.
11. Practical lessons: what local models are good for and where they still need help.

## Suggested Insert: Plain-Language Local LLM Explanation

Local LLMs are not magic versions of ChatGPT that happen to run on your laptop. They are more like a local process you have to manage: model weights on disk, a runtime that knows how to execute them, a server that accepts requests, and an application that decides what to do with the output. That extra control is exactly what makes local models interesting, but it also means you inherit all the boring software problems the cloud usually hides from you.

## Suggested Insert: Frontier Supervisor And Local Worker

The shape I am aiming for is not “replace the frontier model with Gemma.” That is not realistic for the kind of coding help I want. The more interesting pattern is using the frontier model as the supervisor and Gemma as the local worker. The frontier model can break down the task, decide what files matter, review the plan, and judge the results. The local model can do cheaper, narrower work: inspect files, make small edits, run checks, and report back with evidence. If this works, the expensive model spends fewer tokens doing chores and more tokens making decisions.

## Suggested Insert: Why The CLI Matters

The CLI matters because it makes Gemma callable. A desktop app is something I use directly. A CLI is something another agent can drive. Once the workflow is available from the command line, a stronger model can assign a narrow task to Gemma, wait for the result, inspect the logs, and decide whether to continue. That is the bridge from local vibe-coding toy to local sub-agent.

## Suggested Insert: The Harness Lesson

The lesson was not that Gemma suddenly became a senior developer. It did not. The lesson was that smaller models need management. They need smaller tasks, stricter output formats, visible file context, narrow prompts, and verification. The harness does not make the model magically smarter. It changes the work so the model has a better chance of succeeding.

## Suggested Insert: Context Hygiene

One surprise was how much of “model confusion” was really context confusion. If the conversation contains three old versions of the same file, the model has no reliable way to know which one to trust. Humans remember edits as a sequence of events. Models see a pile of text. For coding agents, the harness has to maintain a current view of files and avoid replaying stale file contents as if they were still true.

## Suggested Insert: Logs

The logs became the difference between debugging and guessing. With agents, it is not enough to know what I typed into the UI. I need to know the actual system prompt, the actual messages sent to the model, the exact response, the parsed tool call, the tool result, and the final file state. Otherwise, every failure turns into folklore.

## Highest-Impact Revision

The single highest-impact change would be to add an explicit “frontier supervisor, local worker” section before the CLI details. That will make the whole article feel less like a project diary and more like an argument about where local LLMs fit in a practical AI coding workflow.

## Bottom Line

The article should reassure readers that local LLMs are not magical, not useless, and not direct replacements for frontier models. They are potentially useful workers inside a larger system. The real engineering challenge is building the harness that gives them the right size of task, the right context, the right tools, and enough verification that their work can be trusted cheaply.
