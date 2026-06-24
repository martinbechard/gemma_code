# Subsystem Designs

## Current Understanding

Gemma Code groups into six runtime subsystems: local model runtime, agent harness, tool and workspace runtime, Electron app runtime, CLI agent runtime, and observability/debugging.

## Authoritative Sources

- [Module Designs](../modules/index.md)
- [Architecture](../technical/architecture.md)
- [README](../../../README.md)
- [Source tree](../../../src)
- [Tests](../../../tests)

## Related Code

- [src/main](../../../src/main)
- [src/cli](../../../src/cli)
- [src/renderer](../../../src/renderer)
- [src/preload](../../../src/preload)
- [src/shared](../../../src/shared)

## Related Tests

- [tests/main](../../../tests/main)
- [tests/cli](../../../tests/cli)
- [tests/renderer](../../../tests/renderer)
- [tests/shared](../../../tests/shared)

## Related Backlog Items

- Not yet identified.

## Related Wiki Pages

- [Module Designs](../modules/index.md)
- [Architecture](../technical/architecture.md)
- [Functional Workflows](../functional/index.md)

## Open Questions

No open wiki questions are recorded for this topic.

## Maintenance Notes

- Update this hub when modules move between subsystems or a subsystem becomes independently maintainable.

## Subsystem Pages

- [Local Model Runtime](local-model-runtime.md)
- [Agent Harness](agent-harness.md)
- [Tool And Workspace Runtime](tool-and-workspace-runtime.md)
- [Electron App Runtime](electron-app-runtime.md)
- [CLI Agent Runtime](cli-agent-runtime.md)
- [Observability And Debugging](observability-and-debugging.md)
