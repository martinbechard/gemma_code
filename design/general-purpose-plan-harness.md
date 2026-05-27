# General Purpose Plan Harness

## Goal

The planning harness should guide the model through methodical development planning without encoding request-specific files, folders, test paths, tool names, or build commands.

## Approach

The harness owns the planning protocol. The model owns the task details.

The harness asks for one plan step at a time. Each accepted step is stored in memory until the model returns the done sentinel. The assembled plan is saved through the existing plan store so approval and execution continue to use the current plan file flow.

Deterministic validation checks the document contract only:

- the response is parseable YAML
- each step has name, prompt, and verify strings
- step names are unique
- placeholder wording is rejected
- a completed plan has at least one step

Semantic validation is delegated to the model after deterministic validation passes. The review prompt includes the original request and the assembled plan. The model must either return review pass or return one complete corrected plan. Corrected plans go back through deterministic validation before being saved.

## Removed Assumptions

The harness must not require paths under tests/main, derived get current tool names, focused test command shapes, package manager names, or a fixed four step workflow. Those are choices the model derives from project instructions and grounding evidence.

## Success Criteria

- Auto mode can assemble a plan for arbitrary repository tasks.
- The host never injects task-specific files or commands.
- The host still persists the final plan file before execution.
- Invalid plan syntax is caught deterministically.
- Plan completeness and task fit are reviewed semantically by the model.
