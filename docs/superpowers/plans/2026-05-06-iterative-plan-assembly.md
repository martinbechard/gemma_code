# Iterative Plan Assembly Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Replace the current one-shot planning harness with an iterative dialog that asks the model for one executable prompt at a time, accumulates those prompts, and proposes a single assembled plan when the model returns no plan plus no action.

**Architecture:** Add a small plan assembly module in the main process plan layer, then wire code plan mode through that assembler before saving a proposed plan. The model emits one YAML step per response; the harness validates that exactly one step was supplied, stores it, asks for the next step, and stops when the response is the completion sentinel.

**Tech Stack:** Electron main process, TypeScript, yaml package, Vitest, existing PlanExecutionState and renderer plan proposal UI.

---

## File Structure

- Create: src/main/plan/assembly.ts
  - Owns iterative planning constants, response classification, step accumulation, and final YAML assembly.
- Create: tests/main/plan/assembly.test.ts
  - Unit-tests the plan assembler without MLX or renderer involvement.
- Modify: src/main/index.ts
  - Replaces top-level one-shot plan capture and plan review retry logic with iterative assembly flow for code plan and code auto planning.
- Modify: Gemma.plan.md
  - Changes plan-mode instructions from one complete YAML plan to exactly one next-step YAML response per turn.
- Modify: Gemma.md
  - Changes common plan instructions so they describe the iterative harness contract rather than the old complete-plan proposal contract.
- Modify: tests/main/codeSystemPrompt.test.ts
  - Adds prompt-file regression coverage for the one-step plan contract and the completion sentinel.
- Modify if compilation reveals stale references: tests/main/plan/reviewPrompt.test.ts and src/main/plan/reviewPrompt.ts
  - Remove the old review prompt test and module if index.ts no longer imports them.

## Plan Dialog Contract

The harness starts plan mode from the user's original request. The model must return exactly one YAML plan containing one step.

```yaml
plan:
  steps:
    - name: explore
      prompt: List src/cli and src/main, then read agent.ts
      verify: The listing of src/cli and src/main has been retrieved and the contents of agent.ts has been read
```

After accepting a step, the harness asks this exact follow-up.

```text
What should I tell the agent next? in YAML only no extra explanations, just the prompt?

If there is no next prompt, reply exactly: no plan + no action
```

When the model replies with this exact sentinel, the harness assembles all accumulated steps into the existing ParsedPlan shape, persists it with savePlan, emits plan_proposed, and stops.

```text
no plan + no action
```

The harness rejects any response that contains multiple steps, zero valid steps with non-sentinel text, incomplete YAML, or a duplicate step name. Rejection asks the model to retry with exactly one next-step YAML response or the sentinel.

---

### Task 1: Add Failing Plan Assembler Tests

**Files:**
- Create: tests/main/plan/assembly.test.ts
- Read first: src/main/plan/parser.ts
- Read first: src/main/plan/validation.ts

- [ ] **Step 1: Read current parser and validation code**

Run:

```bash
sed -n '1,180p' src/main/plan/parser.ts
sed -n '1,180p' src/main/plan/validation.ts
```

Expected: parser exports ParsedStep, ParsedPlan, and findNextPlan; validation accepts a ParsedPlan.

- [ ] **Step 2: Write the failing assembler tests**

Create tests/main/plan/assembly.test.ts with this content:

```ts
import { describe, expect, it } from "vitest";
import {
  PLAN_ASSEMBLY_DONE_TEXT,
  PLAN_ASSEMBLY_NEXT_PROMPT,
  applyPlanAssemblyResponse,
  createPlanAssemblyState,
  finalizePlanAssembly,
} from "../../../src/main/plan/assembly";

const exploreStep = [
  "plan:",
  "  steps:",
  "    - name: explore",
  "      prompt: List src/main/plan and read src/main/plan/parser.ts.",
  "      verify: src/main/plan has been listed and parser.ts has been read.",
].join("\n");

const testStep = [
  "plan:",
  "  steps:",
  "    - name: test",
  "      prompt: Update tests/main/plan/assembly.test.ts, then run npm test tests/main/plan/assembly.test.ts.",
  "      verify: npm test tests/main/plan/assembly.test.ts reports the expected failing assertion before implementation.",
].join("\n");

describe("iterative plan assembly", () => {
  it("accepts one step and asks for the next prompt", () => {
    const state = createPlanAssemblyState();
    const result = applyPlanAssemblyResponse(state, exploreStep);

    expect(result.kind).toBe("accepted");
    if (result.kind !== "accepted") return;
    expect(result.state.steps).toEqual([
      {
        name: "explore",
        prompt: "List src/main/plan and read src/main/plan/parser.ts.",
        verify: "src/main/plan has been listed and parser.ts has been read.",
      },
    ]);
    expect(result.nextPrompt).toBe(PLAN_ASSEMBLY_NEXT_PROMPT);
  });

  it("assembles accepted steps when the model returns the done sentinel", () => {
    const first = applyPlanAssemblyResponse(
      createPlanAssemblyState(),
      exploreStep,
    );
    if (first.kind !== "accepted") throw new Error("expected first step");

    const second = applyPlanAssemblyResponse(first.state, testStep);
    if (second.kind !== "accepted") throw new Error("expected second step");

    const done = applyPlanAssemblyResponse(
      second.state,
      PLAN_ASSEMBLY_DONE_TEXT,
    );

    expect(done.kind).toBe("finished");
    if (done.kind !== "finished") return;
    expect(done.plan.steps.map((step) => step.name)).toEqual([
      "explore",
      "test",
    ]);
    expect(done.plan.raw).toContain("plan:");
    expect(done.plan.raw).toContain("name: explore");
    expect(done.plan.raw).toContain("name: test");
    expect(done.plan.start).toBe(0);
    expect(done.plan.end).toBe(done.plan.raw.length);
  });

  it("rejects multiple steps in a single response", () => {
    const response = [
      "plan:",
      "  steps:",
      "    - name: explore",
      "      prompt: Read src/main/index.ts.",
      "      verify: src/main/index.ts has been read.",
      "    - name: implement",
      "      prompt: Edit src/main/index.ts.",
      "      verify: src/main/index.ts has been edited.",
    ].join("\n");

    const result = applyPlanAssemblyResponse(
      createPlanAssemblyState(),
      response,
    );

    expect(result.kind).toBe("rejected");
    if (result.kind !== "rejected") return;
    expect(result.reason).toContain("exactly one step");
    expect(result.retryPrompt).toContain("exactly one YAML plan");
  });

  it("rejects the done sentinel before any steps were accepted", () => {
    const result = applyPlanAssemblyResponse(
      createPlanAssemblyState(),
      PLAN_ASSEMBLY_DONE_TEXT,
    );

    expect(result.kind).toBe("rejected");
    if (result.kind !== "rejected") return;
    expect(result.reason).toContain("at least one step");
  });

  it("rejects duplicate step names", () => {
    const first = applyPlanAssemblyResponse(
      createPlanAssemblyState(),
      exploreStep,
    );
    if (first.kind !== "accepted") throw new Error("expected first step");

    const duplicate = applyPlanAssemblyResponse(first.state, exploreStep);

    expect(duplicate.kind).toBe("rejected");
    if (duplicate.kind !== "rejected") return;
    expect(duplicate.reason).toContain("Duplicate step name");
  });

  it("finalizes to null until at least one step exists", () => {
    expect(finalizePlanAssembly(createPlanAssemblyState())).toBeNull();
  });
});
```

- [ ] **Step 3: Run the focused test and confirm it fails for the missing module**

Run:

```bash
npm test tests/main/plan/assembly.test.ts
```

Expected: FAIL because src/main/plan/assembly.ts does not exist yet.

- [ ] **Step 4: Commit the failing test**

Run:

```bash
git add tests/main/plan/assembly.test.ts
git commit -m "test: define iterative plan assembly contract"
```

Expected: commit succeeds with only the new test file staged.

---

### Task 2: Implement The Plan Assembler

**Files:**
- Create: src/main/plan/assembly.ts
- Test: tests/main/plan/assembly.test.ts

- [ ] **Step 1: Create the assembler module**

Create src/main/plan/assembly.ts with this content:

```ts
import { stringify } from "yaml";
import { findNextPlan, type ParsedPlan, type ParsedStep } from "./parser";

const MAX_PLAN_ASSEMBLY_STEPS = 16;

export const PLAN_ASSEMBLY_DONE_TEXT = "no plan + no action";
export const PLAN_ASSEMBLY_NEXT_PROMPT = [
  "What should I tell the agent next? in YAML only no extra explanations, just the prompt?",
  "",
  "If there is no next prompt, reply exactly: " +
    PLAN_ASSEMBLY_DONE_TEXT,
].join("\n");

export interface PlanAssemblyState {
  steps: ParsedStep[];
}

export type PlanAssemblyResult =
  | {
      kind: "accepted";
      state: PlanAssemblyState;
      nextPrompt: string;
    }
  | {
      kind: "finished";
      state: PlanAssemblyState;
      plan: ParsedPlan;
    }
  | {
      kind: "rejected";
      state: PlanAssemblyState;
      reason: string;
      retryPrompt: string;
    };

export function createPlanAssemblyState(): PlanAssemblyState {
  return { steps: [] };
}

export function applyPlanAssemblyResponse(
  state: PlanAssemblyState,
  response: string,
): PlanAssemblyResult {
  const trimmed = response.trim();
  if (trimmed === PLAN_ASSEMBLY_DONE_TEXT) {
    const plan = finalizePlanAssembly(state);
    if (!plan) {
      return rejected(
        state,
        "The assembled plan needs at least one step before it can finish.",
      );
    }
    return { kind: "finished", state, plan };
  }

  const parsed = findNextPlan(response);
  if (parsed === "incomplete") {
    return rejected(state, "The response contains incomplete YAML.");
  }
  if (!parsed) {
    return rejected(
      state,
      "The response must contain exactly one YAML plan step or exactly " +
        PLAN_ASSEMBLY_DONE_TEXT +
        ".",
    );
  }
  if (parsed.steps.length !== 1) {
    return rejected(
      state,
      "The response must contain exactly one step; received " +
        parsed.steps.length +
        ".",
    );
  }
  if (state.steps.length >= MAX_PLAN_ASSEMBLY_STEPS) {
    return rejected(
      state,
      "The assembled plan reached the limit of " +
        MAX_PLAN_ASSEMBLY_STEPS +
        " steps.",
    );
  }

  const [step] = parsed.steps;
  if (state.steps.some((existing) => existing.name === step.name)) {
    return rejected(state, "Duplicate step name \"" + step.name + "\".");
  }

  return {
    kind: "accepted",
    state: { steps: [...state.steps, step] },
    nextPrompt: PLAN_ASSEMBLY_NEXT_PROMPT,
  };
}

export function finalizePlanAssembly(
  state: PlanAssemblyState,
): ParsedPlan | null {
  if (state.steps.length === 0) return null;
  const raw = stringify({ plan: { steps: state.steps } }).trimEnd();
  return {
    steps: [...state.steps],
    raw,
    start: 0,
    end: raw.length,
  };
}

function rejected(
  state: PlanAssemblyState,
  reason: string,
): PlanAssemblyResult {
  return {
    kind: "rejected",
    state,
    reason,
    retryPrompt: [
      "The previous planning response was rejected: " + reason,
      "",
      "Return exactly one YAML plan containing one step, with name, prompt, and verify string fields.",
      "If the plan is complete, reply exactly: " +
        PLAN_ASSEMBLY_DONE_TEXT,
    ].join("\n"),
  };
}
```

- [ ] **Step 2: Run the focused assembler test**

Run:

```bash
npm test tests/main/plan/assembly.test.ts
```

Expected: PASS for all tests in tests/main/plan/assembly.test.ts.

- [ ] **Step 3: Commit the assembler**

Run:

```bash
git add src/main/plan/assembly.ts tests/main/plan/assembly.test.ts
git commit -m "feat: add iterative plan assembly state"
```

Expected: commit succeeds with the assembler and its test.

---

### Task 3: Wire Plan Mode Through Iterative Assembly

**Files:**
- Modify: src/main/index.ts
- Test: tests/main/plan/assembly.test.ts
- Test: tests/main/codeSystemPrompt.test.ts

- [ ] **Step 1: Read the current top-level plan path**

Run:

```bash
sed -n '1,90p' src/main/index.ts
sed -n '600,1245p' src/main/index.ts
```

Expected: imports include findNextPlan, buildPlanReviewPrompt, savePlan; the top-level harness parses a complete plan from buffer, reviews it, validates it, saves it, and emits plan_proposed.

- [ ] **Step 2: Replace review state with assembly state**

In src/main/index.ts, add this import near the other plan imports:

```ts
import {
  applyPlanAssemblyResponse,
  createPlanAssemblyState,
  type PlanAssemblyState,
} from "./plan/assembly";
```

Remove this import if it is no longer used:

```ts
import { buildPlanReviewPrompt } from "./plan/reviewPrompt";
```

Replace these local variables:

```ts
let pendingPlanReview = false;
let planReviewAttempts = 0;
```

with this local variable:

```ts
let planAssemblyState: PlanAssemblyState | null = topLevelPlanHarnessEnabled
  ? createPlanAssemblyState()
  : null;
```

Expected: TypeScript now has a mutable planAssemblyState available for top-level plan mode only.

- [ ] **Step 3: Replace complete-plan capture with iterative assembly**

In src/main/index.ts, replace the top-level branch inside the planFound handling block with this structure. Keep the nested plan rejection branch for active plan execution.

```ts
      const planFound =
        planState || topLevelPlanHarnessEnabled ? findNextPlan(buffer) : null;
      const planAssemblyDone =
        !planState &&
        planAssemblyState &&
        buffer.trim() === "no plan + no action";
      if ((planFound && planFound !== "incomplete") || planAssemblyDone) {
        flushBufferToUI();
        replaceBodyStripped();
        if (!planState) {
          if (!planAssemblyState) {
            emit({ type: "activity", activity: { kind: "idle" } });
            emit({
              type: "error",
              error: "Plan assembly is not active for this conversation.",
            });
            return;
          }
          const assembled = applyPlanAssemblyResponse(
            planAssemblyState,
            buffer,
          );
          planAssemblyState = assembled.state;
          if (assembled.kind === "accepted") {
            baseMessages.push({ role: "assistant", content: buffer });
            pushHarnessPrompt("plan assembly", assembled.nextPrompt);
            emit({
              type: "activity",
              activity: { kind: "thinking", chars: 0 },
            });
            continue;
          }
          if (assembled.kind === "rejected") {
            baseMessages.push({ role: "assistant", content: buffer });
            pushHarnessPrompt("plan assembly retry", assembled.retryPrompt);
            emit({
              type: "activity",
              activity: { kind: "thinking", chars: 0 },
            });
            continue;
          }
          const validation = validatePlanForExecution(assembled.plan);
          if (!validation.valid) {
            baseMessages.push({ role: "assistant", content: buffer });
            pushHarnessPrompt(
              "plan assembly validation",
              [
                "The assembled plan is not executable yet: " +
                  validation.reason,
                "",
                "Return exactly one additional YAML plan step that fixes this gap, with name, prompt, and verify string fields.",
                "If the plan is complete after that step, wait for the next prompt and then reply exactly: no plan + no action",
              ].join("\n"),
            );
            emit({
              type: "activity",
              activity: { kind: "thinking", chars: 0 },
            });
            continue;
          }
          savePlan(req.conversationId, assembled.plan.raw);
          emit({
            type: "plan_proposed",
            steps: assembled.plan.steps.map((s) => ({
              name: s.name,
              prompt: s.prompt,
              verify: s.verify,
            })),
          });
          emit({ type: "activity", activity: { kind: "idle" } });
          emit({ type: "done" });
          return;
        }
```

After this inserted top-level branch, preserve the existing active-step nested-plan correction code that starts with:

```ts
        usePlanExecutionPrompt();
```

Expected: top-level planning no longer saves a complete plan emitted in one response. It accepts a single step, asks for the next one, and saves only after the done sentinel.

- [ ] **Step 4: Remove stale review retry block**

In src/main/index.ts, remove the block that begins:

```ts
      if (pendingPlanReview) {
```

and ends after emitting the plan review retry prompt.

Expected: there is no pendingPlanReview state, MAX_PLAN_REVIEW_ATTEMPTS is unused, and buildPlanReviewPrompt is not imported by index.ts.

- [ ] **Step 5: Remove stale constants and module if unused**

Run:

```bash
rg -n "MAX_PLAN_REVIEW_ATTEMPTS|buildPlanReviewPrompt|pendingPlanReview|planReviewAttempts" src tests
```

If only src/main/plan/reviewPrompt.ts and tests/main/plan/reviewPrompt.test.ts still reference buildPlanReviewPrompt, delete both files.

Expected: no stale one-shot plan review code remains in the runtime path.

- [ ] **Step 6: Run focused tests and typecheck through build**

Run:

```bash
npm test tests/main/plan/assembly.test.ts tests/main/plan/parser.test.ts tests/main/plan/validation.test.ts
npm run build
```

Expected: focused tests and build pass. If build reports unused imports or constants from the old review path, delete the unused code and rerun the same commands.

- [ ] **Step 7: Commit the wiring**

Run:

```bash
git add src/main/index.ts src/main/plan/assembly.ts tests/main/plan/assembly.test.ts src/main/plan/reviewPrompt.ts tests/main/plan/reviewPrompt.test.ts
git commit -m "feat: assemble plans one prompt at a time"
```

Expected: commit succeeds. If reviewPrompt files were deleted, git add records the deletions.

---

### Task 4: Update Prompt Instructions For One-Step Planning

**Files:**
- Modify: Gemma.plan.md
- Modify: Gemma.md
- Modify: tests/main/codeSystemPrompt.test.ts

- [ ] **Step 1: Read current prompt files and prompt tests**

Run:

```bash
sed -n '1,220p' Gemma.plan.md
sed -n '1,120p' Gemma.md
sed -n '1,220p' tests/main/codeSystemPrompt.test.ts
```

Expected: Gemma.plan.md still instructs one complete YAML plan; Gemma.md still describes proposal and execution phases for a complete plan.

- [ ] **Step 2: Update Gemma.plan.md steady-state behavior**

Replace the plan-mode instructions so they say:

~~~md
# Plan mode - preparing code work

You are preparing one prompt at a time for work in an existing codebase. The host accumulates your prompts into a final executable plan. Your job in each response is to either emit exactly one YAML plan containing exactly one step, or finish with exactly no plan + no action when no more steps are needed.

## How plan mode begins

For any non-trivial change, do not start editing immediately. Use one plan step to inspect canonical files and touched files first. If you already have enough context for a tiny one-line edit, you may emit one edit_file action instead of a plan.

When the user asks for new code or a new feature:

1. Start with a grounding step that lists or reads the canonical files for the requested change.
2. On each later prompt, add the single next executable step the agent should perform.
3. Include test, implementation, documentation, focused verification, full test suite, and build steps when the requested change needs them.
4. When the sequence is complete, reply exactly: no plan + no action

Do not copy examples from this prompt. A valid step must name the actual files and tests needed for this request when those files are known. A step containing phrases like relevant tests, relevant files, implementation files, or needed files is invalid.

If the request is genuinely ambiguous in a way that changes the file set or behavior, ask one focused clarifying question instead of emitting a half-scoped step.

## Step contract

Each response in plan mode must use one of these two shapes.

```yaml
plan:
  steps:
    - name: explore
      prompt: List src/cli and src/main, then read agent.ts
      verify: The listing of src/cli and src/main has been retrieved and the contents of agent.ts has been read
~~~

```text
no plan + no action
```

Step rules:

- The top-level key must be plan.
- plan.steps must contain exactly one item.
- The step must have name, prompt, and verify string fields.
- prompt is what the host injects back during execution, so it must be a direct instruction.
- verify is the post-condition the host will ask you to judge after the step body finishes.
- Do not include comments, placeholders, Python code, pass statements, or explanatory prose.
- Do not mix a YAML plan and an action in the same turn.
- After emitting one YAML step, stop. The host will ask for the next step.
- Do not emit a YAML plan while executing an approved step.
```

Expected: Gemma.plan.md no longer tells the model to emit a complete end-to-end plan in one response.

- [ ] **Step 3: Update Gemma.md common plan section**

In Gemma.md, replace the old Plans section with a shorter common contract that points to iterative planning:

~~~md
## Plans - multi-step work

For tasks that need more than two or three actions, the host may enter plan mode. In plan mode, you do not write the whole plan at once. You emit exactly one YAML step, stop, and wait for the host to ask for the next step. The host accumulates accepted steps and assembles the final plan for human review.

When there are no more steps, reply exactly:

```text
no plan + no action
~~~

A step has this shape:

```yaml
plan:
  steps:
    - name: explore
      prompt: List src/cli and src/main, then read agent.ts
      verify: The listing of src/cli and src/main has been retrieved and the contents of agent.ts has been read
```

Plan rules:

- Each plan-mode response must contain exactly one step.
- name, prompt, and verify are all required string fields.
- prompt is what the host injects back to you; phrase it as an instruction to yourself.
- verify is the post-condition the host will ask you to judge after the step body finishes.
- Do not include YAML comments, placeholders, Python code, pass statements, or explanatory prose.
- Do not mix a YAML plan and an action in the same turn.
- Do not emit a YAML plan while executing a step.
```

Expected: common prompt instructions no longer conflict with the one-step plan mode.

- [ ] **Step 4: Add prompt regression tests**

In tests/main/codeSystemPrompt.test.ts, add assertions that:

```ts
it("teaches plan mode to emit one step at a time", () => {
  const planPrompt = readFileSync(
    join(process.cwd(), "Gemma.plan.md"),
    "utf8",
  );

  expect(planPrompt).toContain("exactly one YAML plan containing exactly one step");
  expect(planPrompt).toContain("no plan + no action");
  expect(planPrompt).not.toContain("Emit one complete YAML plan covering the work end to end");
});

it("keeps common plan instructions aligned with iterative assembly", () => {
  const commonPrompt = readFileSync(join(process.cwd(), "Gemma.md"), "utf8");

  expect(commonPrompt).toContain("you do not write the whole plan at once");
  expect(commonPrompt).toContain("host accumulates accepted steps");
  expect(commonPrompt).toContain("no plan + no action");
});
```

Expected: test file proves prompt instructions no longer describe the old one-shot full-plan contract.

- [ ] **Step 5: Run prompt tests**

Run:

```bash
npm test tests/main/codeSystemPrompt.test.ts
```

Expected: PASS. If the markdown wording differs, adjust the assertions to the exact steady-state wording and rerun.

- [ ] **Step 6: Commit prompt changes**

Run:

```bash
git add Gemma.plan.md Gemma.md tests/main/codeSystemPrompt.test.ts
git commit -m "docs: teach plan mode iterative prompt assembly"
```

Expected: commit succeeds.

---

### Task 5: Add Harness Integration Coverage

**Files:**
- Create or modify: tests/main/plan/assembly.test.ts
- Modify if needed: src/main/plan/assembly.ts

- [ ] **Step 1: Add validation-aware assembler tests**

Append these tests to tests/main/plan/assembly.test.ts:

```ts
import { validatePlanForExecution } from "../../../src/main/plan/validation";

const implementStep = [
  "plan:",
  "  steps:",
  "    - name: implement",
  "      prompt: Edit src/main/index.ts and src/main/plan/assembly.ts to wire iterative plan assembly.",
  "      verify: src/main/index.ts calls applyPlanAssemblyResponse and src/main/plan/assembly.ts contains the assembly state machine.",
].join("\n");

const verifyStep = [
  "plan:",
  "  steps:",
  "    - name: verify",
  "      prompt: Run npm test tests/main/plan/assembly.test.ts, npm test, and npm run build, then report exact results.",
  "      verify: npm test tests/main/plan/assembly.test.ts, npm test, and npm run build pass.",
].join("\n");

it("produces a final plan compatible with existing execution validation", () => {
  let result = applyPlanAssemblyResponse(createPlanAssemblyState(), exploreStep);
  if (result.kind !== "accepted") throw new Error("expected explore step");

  result = applyPlanAssemblyResponse(result.state, testStep);
  if (result.kind !== "accepted") throw new Error("expected test step");

  result = applyPlanAssemblyResponse(result.state, implementStep);
  if (result.kind !== "accepted") throw new Error("expected implement step");

  result = applyPlanAssemblyResponse(result.state, verifyStep);
  if (result.kind !== "accepted") throw new Error("expected verify step");

  const done = applyPlanAssemblyResponse(result.state, PLAN_ASSEMBLY_DONE_TEXT);
  if (done.kind !== "finished") throw new Error("expected finished plan");

  expect(validatePlanForExecution(done.plan)).toEqual({ valid: true });
});

it("rejects placeholder wording before it can be saved", () => {
  const placeholderStep = [
    "plan:",
    "  steps:",
    "    - name: test",
    "      prompt: Run relevant tests.",
    "      verify: The relevant tests pass.",
  ].join("\n");

  const result = applyPlanAssemblyResponse(
    createPlanAssemblyState(),
    placeholderStep,
  );

  expect(result.kind).toBe("rejected");
  if (result.kind !== "rejected") return;
  expect(result.reason).toContain("placeholder");
});
```

- [ ] **Step 2: Add placeholder validation to the assembler if the new test fails**

If the placeholder test fails, move the placeholder check currently in validatePlanForExecution into an exported helper in src/main/plan/validation.ts:

```ts
export function validatePlanStepText(step: ParsedStep): PlanValidationResult {
  const text = step.prompt + "\n" + step.verify;
  const placeholder = PLACEHOLDER_PATTERNS.find(({ pattern }) =>
    pattern.test(text),
  );
  if (placeholder) {
    return {
      valid: false,
      reason:
        "Step \"" +
        step.name +
        "\" still uses placeholder wording \"" +
        placeholder.label +
        "\". " +
        "Name exact files, test paths, and commands before the plan can run.",
    };
  }
  return { valid: true };
}
```

Then call validatePlanStepText from src/main/plan/assembly.ts before accepting a step.

Expected: placeholder steps are rejected during assembly, before the final save point.

- [ ] **Step 3: Run focused plan tests**

Run:

```bash
npm test tests/main/plan/assembly.test.ts tests/main/plan/validation.test.ts
```

Expected: PASS. If validation tests fail because placeholder logic moved, update tests/main/plan/validation.test.ts to assert both per-step and full-plan validation.

- [ ] **Step 4: Commit integration coverage**

Run:

```bash
git add src/main/plan/assembly.ts src/main/plan/validation.ts tests/main/plan/assembly.test.ts tests/main/plan/validation.test.ts
git commit -m "test: validate assembled plans before save"
```

Expected: commit succeeds.

---

### Task 6: Full Verification And Manual Scenario

**Files:**
- Modify only if tests reveal defects: src/main/index.ts, src/main/plan/assembly.ts, Gemma.plan.md, Gemma.md, tests/main/plan/assembly.test.ts, tests/main/codeSystemPrompt.test.ts

- [ ] **Step 1: Run full automated verification**

Run:

```bash
npm test
npm run build
```

Expected: npm test passes all Vitest files and npm run build completes without TypeScript or bundling errors.

- [ ] **Step 2: If verification fails, fix the exact failing path**

If npm test or npm run build fails, read the first failing test or TypeScript error, edit only the files implicated by that error, and rerun:

```bash
npm test
npm run build
```

Expected: both commands pass. Repeat until both pass or until the failure requires missing human information.

- [ ] **Step 3: Run the app for manual planning verification**

Run:

```bash
npm run dev
```

Manual scenario:

1. Start a code conversation in plan mode for this prompt: As an expert in software development and AI-assisted coding, I need your help in instructing an AI coding agent. Our task: create a new LLM tool to retrieve the current working directory in this project. What should I start by telling the agent? in YAML only no extra explanations, just the prompt?
2. Confirm the first assistant response contains one YAML step only.
3. Confirm the harness asks: What should I tell the agent next? in YAML only no extra explanations, just the prompt?
4. Continue until the model returns no plan + no action.
5. Confirm the UI shows one proposed assembled plan with all accumulated steps and an Execute Plan button.
6. Confirm no raw placeholder comments, Python pass statements, or duplicate system prompt bubbles appear in the visible assistant message.

Expected: the dialog produces one accumulated plan proposal and does not show the old one-shot plan review flow.

- [ ] **Step 4: Commit verification fixes if any**

If Step 2 or Step 3 required code changes, run:

```bash
git add src/main/index.ts src/main/plan/assembly.ts Gemma.plan.md Gemma.md tests/main/plan/assembly.test.ts tests/main/codeSystemPrompt.test.ts
git commit -m "fix: stabilize iterative plan assembly"
```

Expected: commit succeeds only if verification produced additional fixes.

---

## Self-Review

- Spec coverage: The plan replaces the old complete-plan harness with iterative single-step assembly, uses the no plan plus no action sentinel as the stop condition, keeps the existing final plan proposal UI, and removes the old plan review loop from the runtime path.
- No backwards compatibility: The old complete-plan top-level behavior is intentionally removed from src/main/index.ts and Gemma.plan.md.
- Test coverage: The plan adds unit coverage for one-step acceptance, sentinel finalization, rejection of multiple steps, duplicate names, placeholder text, final validation compatibility, prompt file regressions, full Vitest, build, and a manual app scenario.
- Risk: The final validation rule currently requires a tests/main path, npm test, and npm run build. That is acceptable for code plan mode in this project, but the implementation should keep that validation centralized so future scope changes are easy.
