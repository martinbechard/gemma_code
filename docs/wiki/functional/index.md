# Functional Workflows

## Current Understanding

Gemma Code exposes four main user-visible workflow families: local model setup, Electron app chat/code workflows, CLI workflows, and structured code task execution.

## Authoritative Sources

- [README](../../../README.md)
- [Renderer UI](../modules/renderer-ui.md)
- [Main Process](../modules/main-process.md)
- [CLI Runtime](../modules/cli-runtime.md)
- [Agent Harness](../subsystems/agent-harness.md)
- [Tests](../../../tests)

## Related Code

- [src/renderer/src/App.tsx](../../../src/renderer/src/App.tsx)
- [src/renderer/src/components/Chat.tsx](../../../src/renderer/src/components/Chat.tsx)
- [src/renderer/src/components/Setup.tsx](../../../src/renderer/src/components/Setup.tsx)
- [src/main/index.ts](../../../src/main/index.ts)
- [src/cli](../../../src/cli)

## Related Tests

- [tests/renderer](../../../tests/renderer)
- [tests/cli](../../../tests/cli)
- [tests/main](../../../tests/main)

## Related Backlog Items

- Not yet identified.

## Related Wiki Pages

- [Architecture](../technical/architecture.md)
- [Subsystem Designs](../subsystems/index.md)
- [Module Designs](../modules/index.md)

## Open Questions

No open wiki questions are recorded for this topic.

## Maintenance Notes

- Add a functional page when a workflow has distinct entry points, states, rules, or acceptance behavior.

## Functional Pages

- [Local Model Setup](local-model-setup.md)
- [Electron App Workflows](electron-app-workflows.md)
- [CLI Workflows](cli-workflows.md)
- [Code Task Execution](code-task-execution.md)
