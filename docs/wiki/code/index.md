# Code Map

## Current Understanding

The code map routes maintainers from runtime surfaces to source folders, module pages, and tests. It is a navigation page, not a replacement for module designs.

## Authoritative Sources

- [Source tree](../../../src)
- [Tests](../../../tests)
- [Module Designs](../modules/index.md)
- [Architecture](../technical/architecture.md)
- [README](../../../README.md)

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
- [Subsystem Designs](../subsystems/index.md)
- [Architecture](../technical/architecture.md)

## Open Questions

No open wiki questions are recorded for this topic.

## Maintenance Notes

- Keep this page aligned with top-level source folders and module design coverage.

## Runtime Surfaces

- Electron main process: [Main Process](../modules/main-process.md), [src/main/index.ts](../../../src/main/index.ts), [tests/main](../../../tests/main).
- MLX runtime: [MLX Runtime](../modules/mlx-runtime.md), [src/main/mlx.ts](../../../src/main/mlx.ts), [tests/main/mlxChatStream.test.ts](../../../tests/main/mlxChatStream.test.ts).
- Tools: [Tool Runtime](../modules/tool-runtime.md), [src/main/tools](../../../src/main/tools), [tests/main](../../../tests/main).
- Plan harness: [Plan Engine](../modules/plan-engine.md), [src/main/plan](../../../src/main/plan), [tests/main/plan](../../../tests/main/plan).
- Workspaces: [Workspace Runtime](../modules/workspace-runtime.md), [src/main/workspace.ts](../../../src/main/workspace.ts), file tool tests under [tests/main](../../../tests/main).
- CLI: [CLI Runtime](../modules/cli-runtime.md), [src/cli](../../../src/cli), [tests/cli](../../../tests/cli).
- Renderer: [Renderer UI](../modules/renderer-ui.md), [src/renderer](../../../src/renderer), [tests/renderer](../../../tests/renderer).
- Preload: [Preload IPC Bridge](../modules/preload-ipc-bridge.md), [src/preload](../../../src/preload).
- Shared contracts: [Shared Types And Model Registry](../modules/shared-types-and-model-registry.md), [src/shared](../../../src/shared), [tests/shared](../../../tests/shared).
- Logs and tasks: [Execution Logs And Background Tasks](../modules/execution-logs-and-background-tasks.md), [src/main/executionLog.ts](../../../src/main/executionLog.ts), [src/main/backgroundTasks.ts](../../../src/main/backgroundTasks.ts).
