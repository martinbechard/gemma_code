# Local Model Setup Functional Specification

## Current Understanding

Users prepare a selected local model by letting Gemma Code install or reuse MLX, validate model files, start the local server, download or reuse weights, warm inference, and report readiness. Repairable incomplete downloads expose a resume-download path.

## Authoritative Sources

- [README model runtime section](../../../README.md)
- [Setup UI](../../../src/renderer/src/components/Setup.tsx)
- [App setup state](../../../src/renderer/src/App.tsx)
- [Main setup handlers](../../../src/main/index.ts)
- [MLX Runtime](../modules/mlx-runtime.md)

## Related Code

- [src/renderer/src/components/Setup.tsx](../../../src/renderer/src/components/Setup.tsx)
- [src/renderer/src/App.tsx](../../../src/renderer/src/App.tsx)
- [src/main/index.ts](../../../src/main/index.ts)
- [src/main/mlx.ts](../../../src/main/mlx.ts)
- [src/shared/types.ts](../../../src/shared/types.ts)
- [src/cli/setup.ts](../../../src/cli/setup.ts)

## Related Tests

- [tests/renderer/components/Setup.test.ts](../../../tests/renderer/components/Setup.test.ts)
- [tests/main/mlxChatStream.test.ts](../../../tests/main/mlxChatStream.test.ts)
- [tests/main/mlxServerPatch.test.ts](../../../tests/main/mlxServerPatch.test.ts)
- [tests/shared/modelRegistry.test.ts](../../../tests/shared/modelRegistry.test.ts)

## Related Backlog Items

- Not yet identified.

## Related Wiki Pages

- [Local Model Runtime](../subsystems/local-model-runtime.md)
- [MLX Runtime](../modules/mlx-runtime.md)
- [Renderer UI](../modules/renderer-ui.md)
- [CLI Workflows](cli-workflows.md)

## Open Questions

No open wiki questions are recorded for this topic.

## Maintenance Notes

- Recheck when setup stages, repair metadata, model registry, warmup, or cache validation changes.

## Parent Workflow

This page belongs to [Functional Workflows](index.md) and supports both [Electron App Workflows](electron-app-workflows.md) and [CLI Workflows](cli-workflows.md).

## Actors

- User selects a model and starts setup.
- Electron main process or CLI setup command performs runtime work.
- MLX server serves the selected model locally.

## Entry Points

- Welcome/setup screen Start button.
- Model switching in the app.
- Resume download repair button.
- CLI setup command.
- CLI status command for readiness inspection.

## Scope

Includes MLX installation, cache validation, download progress, repairable incomplete download state, server startup, warmup, and ready state.

## Concepts

- Setup stage: current model preparation state.
- Repairable setup error: incomplete or unusable model cache that can be resumed.
- Model provenance: optional model revision/cache display detail.

## Workflows

1. User opens the app.
2. App selects a startup model from recent conversation state or the shared default.
3. User starts setup or the app auto-starts setup when the model is locally available and MLX is installed.
4. The main process emits setup stages.
5. The setup UI displays progress, byte counts, errors, and repair action when available.
6. When warmup inference succeeds, the app moves to ready.

CLI setup follows the same runtime work and prints stages to stdout.

## States And Rules

- Welcome state appears before setup starts.
- Working stages include checking, installing, validating, starting, repairing, downloading, and warming.
- ready means the runtime can chat.
- error with repair metadata shows Resume download.
- non-repair error shows Try again.

## Edge Cases

- Missing Python reports install guidance.
- Incomplete model cache reports repairable setup error.
- Server startup failure includes command and log file where available.
- Local model unavailable leaves the setup screen available.

## Verification

Type: Testable

Test files: [tests/renderer/components/Setup.test.ts](../../../tests/renderer/components/Setup.test.ts), [tests/main/mlxChatStream.test.ts](../../../tests/main/mlxChatStream.test.ts), [tests/shared/modelRegistry.test.ts](../../../tests/shared/modelRegistry.test.ts)

Status: Present

Scenario: Setup state and runtime readiness are represented through shared status records and setup UI.

Steps:

1. Exercise setup component states.
2. Exercise MLX stream and server patch behavior.
3. Exercise model registry behavior.

Assertions:

- Setup UI renders progress and repairable error behavior.
- MLX runtime errors carry actionable context.
- Model registry supplies the UI model list.
