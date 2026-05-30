# Planning Prompt Minimal Outline

## System Prompt

- State that the task is to prepare a plan for another AI coding assistant, and the plan must contain all information that assistant needs.
  - KEEP
  - WHY DOES THE LLM NEED TO KNOW? Without this, it may answer directly or omit details because it does not understand that another assistant will rely on the plan.

- Allow read-only inspection while preparing the plan.
  - KEEP
  - WHY DOES THE LLM NEED TO KNOW? Without this, it may guess file names or avoid the inspection needed to produce a grounded plan.

- Forbid mutation while preparing the plan.
  - KEEP
  - WHY DOES THE LLM NEED TO KNOW? Without this, it may start implementing before the user has approved the plan.

- Require concrete implementation instructions after inspection.
  - KEEP
  - WHY DOES THE LLM NEED TO KNOW? Without this, it may write vague instructions that another assistant cannot carry out reliably.

- Forbid passing target discovery to the coding assistant.
  - KEEP
  - WHY DOES THE LLM NEED TO KNOW? Without this, it may defer locating files and symbols instead of producing a ready-to-run plan.

- Require verification selected from the request and project rules.
  - KEEP
  - WHY DOES THE LLM NEED TO KNOW? Without this, it may omit proof of completion or add excessive verification that does not fit the request.

- Forbid placeholders.
  - KEEP
  - WHY DOES THE LLM NEED TO KNOW? Without this, it may mask uncertainty with generic wording instead of inspecting or asking.

- Allow a focused question only when inspection cannot resolve ambiguity.
  - KEEP
  - WHY DOES THE LLM NEED TO KNOW? Without this, it may fabricate intent or target files when inspection cannot answer the question.

## Initial Prompt

- Include the user request.
  - KEEP
  - WHY DOES THE LLM NEED TO KNOW? Without the request in the current prompt, it may optimize the plan for generic coding work instead of the actual task.

- End with the allowed response choices.
  - KEEP
  - WHY DOES THE LLM NEED TO KNOW? Without explicit choices at the response point, it may mix inspection, YAML, and prose in one response.

- Allowed response choices for the first prompt:
  - one read-only inspection action
  - one Step-wrapped YAML plan step
  - one focused question wrapped in a question tag
  - WHY DOES THE LLM NEED TO KNOW? The first response may need evidence, a plan step, or clarification; these choices prevent accidental implementation or rambling.

- First prompt response shapes:

```xml
<action name="read_only_tool_name">
<param_name>value</param_name>
</action>
```

```xml
<Step>
plan:
  steps:
    - name: short_step_name
      prompt: Direct instruction for the coding assistant.
      verify: Observable condition that proves the step is complete.
</Step>
```

```xml
<Question>One focused question.</Question>
```

## Next-Step Prompt

- Repeat the allowed response choices at the end of every next-step prompt.
  - KEEP
  - WHY DOES THE LLM NEED TO KNOW? The one-step rule is turn-local; repeating it where the response is requested is clearer than relying on earlier context.

- Include a compact summary of accepted step names.
  - KEEP
  - WHY DOES THE LLM NEED TO KNOW? Without this, it may repeat a step or fail to know whether the plan is complete.

- Allowed response choices for a next-step prompt:
  - one read-only inspection action if more evidence is needed
  - one Step-wrapped YAML plan step
  - plan done with no prose and no Step wrapper
  - one focused question wrapped in a question tag
  - WHY DOES THE LLM NEED TO KNOW? Later planning turns still need the same response discipline, plus the option to stop.

- Next-step response shapes:

```xml
<action name="read_only_tool_name">
<param_name>value</param_name>
</action>
```

```yaml
plan: done
```

The YAML plan-step shape and question shape are the same as in the first prompt.

## Validation-Failure Prompt

- Include the validation failure reason.
  - KEEP
  - WHY DOES THE LLM NEED TO KNOW? Without the exact failure, it cannot repair the plan defect that blocked acceptance.

- Ask for a complete corrected plan, not an extra patch step.
  - KEEP
  - WHY DOES THE LLM NEED TO KNOW? Some failures are in an existing step, so adding one more step may preserve the bad plan.

- Validation-failure response shape:

```yaml
plan:
  steps:
    - name: corrected_step_name
      prompt: Direct instruction for the coding assistant.
      verify: Observable condition that proves the step is complete.
```

## Remove From The Prompt

- Semantic review protocol.
  - REMOVE
  - WHY REMOVE: It teaches the planner about review plumbing instead of helping it decide the next planning instruction.

- Deterministic validator internals.
  - REMOVE
  - WHY REMOVE: It distracts the planner with implementation details; the useful part is the required response shape.

- No-action-tags rule as currently written.
  - REMOVE
  - WHY REMOVE: It would stop the planner from gathering the evidence needed to plan correctly.

- Broad checklist of docs, focused verification, full suite, and build.
  - REMOVE
  - WHY REMOVE: It pushes the planner to add boilerplate checks instead of choosing verification from the actual request.

- Warnings for the later coding assistant.
  - REMOVE
  - WHY REMOVE: The planner only needs to know how to prepare instructions; warnings for the assistant doing the work belong elsewhere.

- Specific example paths from one task.
  - REMOVE
  - WHY REMOVE: They can cause the planner to copy irrelevant paths instead of inspecting the current request.
