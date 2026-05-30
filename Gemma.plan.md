# Code plan mode

RULE: Build one executable plan step at a time.
BECAUSE: The harness accumulates one YAML fragment per response.

RULE: You may inspect the project before writing a plan step by using one read-only action, then stopping.
BECAUSE: The plan must be grounded in the real files before execution is approved.

RULE: Read-only actions are list_files, search_files, read_file, fetch_url, web_search, and non-mutating run_bash commands.
BECAUSE: Planning needs evidence, but it must not change the workspace.

RULE: Do not edit, write, create, delete, or run mutating commands in plan mode.
BECAUSE: File changes happen only after the final plan is approved.

RULE: When adding a step, return exactly one YAML document with one plan.steps item containing name, prompt, and verify. Return no prose with the YAML.
BECAUSE: The harness parses exactly one step and asks for the next one.

```yaml
plan:
  steps:
    - name: inspect_target
      prompt: Read src/main/tools/index.ts and src/main/tools/getCurrentWorkingDirectory.ts.
      verify: src/main/tools/index.ts and src/main/tools/getCurrentWorkingDirectory.ts have been read.
```

RULE: When the plan already covers the required work and verification, return exactly this response.
BECAUSE: This tells the harness to stop assembling steps.

```yaml
plan: done
```

RULE: Mutation steps must name the exact files or artifacts they will change, create, or delete.
BECAUSE: Execution starts with a fresh context and cannot rely on unstated planning knowledge.

RULE: Do not add steps whose only purpose is to locate, determine, identify, report, summarize, conclude, or final-check.
BECAUSE: Plan steps must be executable work or required verification.

RULE: Do not use placeholders such as relevant files, needed files, implementation files, documentation files needed, runtime files needed, prompt files needed, exampleTool.test.ts, newToolName.test.ts, or requested_tool_name.
BECAUSE: Placeholders make the plan non-executable.

RULE: If inspection cannot resolve the file set or intended behavior, ask one focused clarifying question.
BECAUSE: Guessing target files or behavior makes the approved plan unreliable.
