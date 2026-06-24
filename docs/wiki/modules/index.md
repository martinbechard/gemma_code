# Module Designs

## Current Understanding

Gemma Code is organized around shared runtime modules that are reused by the Electron app and CLI. Module design pages describe runtime responsibility, source paths, contracts, dependencies, and verification evidence.

## Authoritative Sources

- [README](../../../README.md)
- [Source tree](../../../src)
- [Tests](../../../tests)
- [CLI runtime implementation plan](../../../design/cli-runtime-implementation-plan.md)
- [MLX transparency implementation plan](../../../design/mlx-transparency-implementation-plan.md)

## Related Code

- [Main source](../../../src/main)
- [CLI source](../../../src/cli)
- [Renderer source](../../../src/renderer)
- [Shared source](../../../src/shared)
- [Preload source](../../../src/preload)

## Related Tests

- [Main tests](../../../tests/main)
- [CLI tests](../../../tests/cli)
- [Renderer tests](../../../tests/renderer)
- [Shared tests](../../../tests/shared)

## Related Backlog Items

- Not yet identified.

## Related Wiki Pages

- [Architecture](../technical/architecture.md)
- [Subsystem Designs](../subsystems/index.md)
- [Functional Workflows](../functional/index.md)
- [Code Map](../code/index.md)

## Open Questions

No open wiki questions are recorded for this topic.

## Maintenance Notes

- Add a module page when a source file or tightly coupled folder owns behavior that can change independently.

## Module Pages

- [Main Process](main-process.md)
- [MLX Runtime](mlx-runtime.md)
- [Tool Runtime](tool-runtime.md)
- [Plan Engine](plan-engine.md)
- [Workspace Runtime](workspace-runtime.md)
- [CLI Runtime](cli-runtime.md)
- [Renderer UI](renderer-ui.md)
- [Preload IPC Bridge](preload-ipc-bridge.md)
- [Shared Types And Model Registry](shared-types-and-model-registry.md)
- [Execution Logs And Background Tasks](execution-logs-and-background-tasks.md)
