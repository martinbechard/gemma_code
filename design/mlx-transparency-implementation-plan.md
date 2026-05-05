# MLX Runtime Transparency Implementation Plan

> For agentic workers: use subagent-driven-development or equivalent task-by-task execution. Keep write scopes disjoint unless the controller explicitly assigns integration files.

Goal: make the app report the real MLX runtime state, detect incomplete model downloads before chat, and turn silent hangs or fetch failures into actionable status and repair paths.

Architecture: keep MLX-LM as an upstream Python subprocess. TypeScript remains the supervisor for cache validation, process lifecycle, request timing, IPC, and renderer state. The renderer presents setup, inference, and repair state; it does not infer runtime health from generic chat activity.

Tech Stack: Electron main process, React renderer, TypeScript, MLX-LM subprocess, Hugging Face cache layout.

---

## Current Findings

- The app-managed Python environment can import mlx_lm outside the Codex sandbox.
- The MLX server answers the models endpoint on port 11434 outside the Codex sandbox.
- The E4B model cache has an incomplete blob around 1.3 GB, while its index expects about 5.2 GB of weights.
- The E2B model cache has an incomplete blob around 2.6 GB, while its index expects about 3.6 GB of weights.
- The snapshots inspected do not contain the final model.safetensors symlink.
- Minimal completion requests timed out without response bytes.
- Setup currently marks the app ready after the models endpoint responds, which is weaker than proving inference works.
- Chat currently surfaces generic fetch failed errors without server, cache, or first-token context.
- npm run typecheck currently fails because hasModel is imported but unused in src/main/index.ts.

## Target Behavior

- Setup distinguishes MLX install state, server health, model cache completeness, warmup inference, and ready state.
- A model with incomplete cache files is not considered ready.
- The app gives a repair action for incomplete model downloads.
- Chat displays connection, request accepted, waiting for first token, and streaming state.
- If inference stalls, the user sees a timed error with elapsed time and the most likely cause.
- Fetch and HTTP errors include the local endpoint, model name, elapsed time, and recent MLX stderr or stdout when available.
- The final verification gate is npm run typecheck and npm run build.

## File Ownership

Runtime worker owns:
- src/main/mlx.ts

UI worker owns:
- src/shared/types.ts
- src/renderer/src/components/Message.tsx
- src/renderer/src/components/Setup.tsx
- src/renderer/src/App.tsx

Controller integration owns:
- src/main/index.ts
- src/preload/index.ts
- src/preload/index.d.ts if needed
- final typecheck and build fixes

Workers must not edit files outside their assigned write scope without reporting a blocker.

## Task 1: Runtime Supervisor and Cache Inspection

Files:
- Modify: src/main/mlx.ts

Steps:

- [ ] Add manifest constants near the top of the file for request timing and log retention.
  - First token timeout should start at 120 seconds.
  - Health polling interval should remain explicit as a named constant.
  - Recent log retention should keep a small bounded number of lines.

- [ ] Add a recent MLX log buffer.
  - Capture stdout and stderr lines from the spawned MLX server.
  - Keep the newest bounded set of lines.
  - Export a function that returns a copy of those lines.

- [ ] Add model cache inspection.
  - Locate the Hugging Face hub folder for a model name by converting slashes to double hyphen format used by the cache.
  - Report whether the model folder exists.
  - Report incomplete blob paths ending in .incomplete.
  - Report snapshot directories.
  - For each snapshot with model.safetensors.index.json, read metadata.total_size.
  - Report whether model.safetensors exists in the snapshot.
  - Report bytes present under the model folder.
  - Return a typed result with status values missing, incomplete, missing-weights, or complete.

- [ ] Add a model repair helper.
  - Stop the server before deleting cache.
  - Remove only the cache folder for the selected model.
  - Do not delete the whole MLX directory, venv, or other models.

- [ ] Add better chat request errors.
  - Wrap POST failures to the chat completions endpoint with endpoint, model, elapsed time, and recent log tail.
  - If response is non-OK, include status, response text tail, model, and elapsed time.
  - If no first token arrives within the timeout, abort the request and throw a clear first-token timeout error.

- [ ] Add a warmup inference helper.
  - Send a tiny streaming or non-streaming prompt against the selected model.
  - Use a small token cap.
  - Treat receiving any response token or valid completion as success.
  - On failure, include cache inspection and recent log context.

- [ ] Keep TypeScript strict.
  - Do not introduce any.
  - Use typed objects for grouped fields.

Verification for this task:

```
npm run typecheck:node
```

Expected result after controller integration:

```
0 TypeScript errors
```

## Task 2: Renderer Status and Repair UX

Files:
- Modify: src/shared/types.ts
- Modify: src/renderer/src/components/Message.tsx
- Modify: src/renderer/src/components/Setup.tsx
- Modify: src/renderer/src/App.tsx

Steps:

- [ ] Extend shared status types.
  - Add setup stages for validating-model, repairing-model, warming-model, and inference-ready if useful.
  - Add a runtime activity shape for chat that can carry label, detail, elapsed seconds, and optional model name.
  - Keep existing activity shapes compatible with current chat messages.

- [ ] Make setup show distinct runtime states.
  - Show cache validation separately from download and warmup.
  - Show incomplete model download as an error state with clear detail.
  - Show repair in progress as a working state.

- [ ] Add a repair action to Setup.
  - Add an optional onRepairModel prop.
  - Render a repair button when setup status has a repairable model error.
  - Keep Try again available for non-repair errors.

- [ ] Improve chat activity labels.
  - Render runtime activity labels such as connecting to MLX, waiting for first token, and streaming response.
  - Show elapsed time where provided.
  - Preserve existing tool cards and token streaming behavior.

- [ ] Keep UI steady-state text current.
  - Do not use comparative labels such as enhanced or revised.
  - Avoid implementation jargon in user-facing labels unless the term is MLX or model.

Verification for this task:

```
npm run typecheck:web
```

Expected result after controller integration:

```
0 TypeScript errors
```

## Task 3: Main Process Integration

Files:
- Modify: src/main/index.ts
- Modify: src/preload/index.ts
- Modify: src/preload/index.d.ts if the generated API type needs it

Steps:

- [ ] Remove the unused hasModel import from src/main/index.ts.

- [ ] During setup, validate the selected model cache before marking ready.
  - If cache is missing, proceed with normal server start so MLX can download.
  - If cache has incomplete files or missing weight files, emit a repairable setup error and do not mark ready.
  - If cache looks complete, start the server and run warmup inference.

- [ ] During setup, emit distinct statuses.
  - Checking system.
  - Installing MLX runtime.
  - Validating model files.
  - Starting model runtime.
  - Warming model.
  - Ready to chat.

- [ ] Add an IPC handler for repairing the selected model.
  - Stop the server.
  - Delete only that model cache folder.
  - Start setup again for that model.

- [ ] During chat, emit runtime activity before and during chatStream.
  - Before POST: connecting to MLX.
  - After POST response body exists: waiting for first token.
  - After first token: streaming response.
  - On error: include wrapped runtime error text.

- [ ] Keep abort behavior.
  - If the user presses stop, abort the request and mark the message done.

Verification for this task:

```
npm run typecheck
```

Expected result:

```
0 TypeScript errors
```

## Task 4: Final Verification

Files:
- Any file touched by prior tasks, only for integration fixes.

Steps:

- [ ] Run the full typecheck.

```
npm run typecheck
```

- [ ] Fix every TypeScript error.

- [ ] Run the production build.

```
npm run build
```

- [ ] Fix every build error.

- [ ] Record the final behavior in the response.
  - Whether MLX venv imports.
  - Whether the local server health endpoint answers.
  - Whether current model caches are incomplete.
  - Whether repair is now exposed in the app.

## Agent Dispatch

Worker A should implement Task 1 only.

Worker B should implement Task 2 only.

The controller should implement Task 3 after reviewing worker outputs, because it crosses both worker surfaces.

The controller should run Task 4.
