# Local Model Runtime High-Level Design

## Current Understanding

The local model runtime installs and supervises MLX, validates model cache readiness, starts the local model server, warms inference, and streams model responses to both Electron and CLI callers.

## Authoritative Sources

- [MLX Runtime](../modules/mlx-runtime.md)
- [Shared Types And Model Registry](../modules/shared-types-and-model-registry.md)
- [Main Process](../modules/main-process.md)
- [CLI Runtime](../modules/cli-runtime.md)
- [MLX transparency implementation plan](../../../design/mlx-transparency-implementation-plan.md)

## Related Code

- [src/main/mlx.ts](../../../src/main/mlx.ts)
- [src/main/runtimePaths.ts](../../../src/main/runtimePaths.ts)
- [src/shared/types.ts](../../../src/shared/types.ts)
- [src/cli/setup.ts](../../../src/cli/setup.ts)

## Related Tests

- [tests/main/mlxChatStream.test.ts](../../../tests/main/mlxChatStream.test.ts)
- [tests/main/mlxServerPatch.test.ts](../../../tests/main/mlxServerPatch.test.ts)
- [tests/shared/modelRegistry.test.ts](../../../tests/shared/modelRegistry.test.ts)

## Related Backlog Items

- Not yet identified.

## Related Wiki Pages

- [Architecture](../technical/architecture.md)
- [Local Model Setup](../functional/local-model-setup.md)
- [MLX Runtime](../modules/mlx-runtime.md)
- [Shared Types And Model Registry](../modules/shared-types-and-model-registry.md)

## Open Questions

No open wiki questions are recorded for this topic.

## Maintenance Notes

- Recheck this subsystem when model registry entries, MLX packages, cache repair, warmup, runtime patches, or CLI setup behavior changes.

## Parent Architecture

[Architecture](../technical/architecture.md) governs this subsystem.

## Scope

Includes Python runtime discovery, MLX installation, cache inspection, cache reuse, server process lifecycle, warmup inference, model provenance, and chat-completion requests.

## Current Data Anchors

- [AVAILABLE_MODELS](../../../src/shared/types.ts) is the shared model list.
- The app user-data MLX folder owns venv, model cache, and logs.
- Hugging Face cache folders provide model weights and metadata.

## Constituent Modules

- [MLX Runtime](../modules/mlx-runtime.md) owns process and cache behavior.
- [Shared Types And Model Registry](../modules/shared-types-and-model-registry.md) owns model metadata and runtime mapping.
- [Main Process](../modules/main-process.md) owns setup IPC orchestration.
- [CLI Runtime](../modules/cli-runtime.md) owns terminal setup/status orchestration.

## Interaction Model

Setup callers ask the MLX runtime to locate or install Python packages, validate cache readiness, start the server, poll download status, warm inference, and then report ready state.

## Lifecycle

Startup validates Python and model cache, starts or reuses the server, warms inference, streams responses during chat, and stops the server during app shutdown or repair paths.

## Data Shapes And Contracts

SetupStatus, RuntimeActivity, ModelInfo, ModelProvenance, and StreamChunk are defined by [Shared Types And Model Registry](../modules/shared-types-and-model-registry.md).

## Configuration

Model id, runtime type, and model size metadata come from the shared registry. MLX VLM KV options can be supplied through environment variables.

## Implementation Order

Runtime cache inspection and patching must remain stable before UI or CLI workflows depend on setup readiness.

## Invariants

- Ready state requires successful warmup inference.
- Incomplete model cache files are repairable setup failures.
- Runtime state belongs under app user-data paths.

## Non-Goals

- The subsystem does not implement a separate Python application server.
- The subsystem does not send code to a cloud model.

## Definition Of Good

Users can install, validate, repair, start, warm, and reuse local model runtime state with actionable error messages.

## Verification

Run [tests/main/mlxChatStream.test.ts](../../../tests/main/mlxChatStream.test.ts), [tests/main/mlxServerPatch.test.ts](../../../tests/main/mlxServerPatch.test.ts), [tests/shared/modelRegistry.test.ts](../../../tests/shared/modelRegistry.test.ts), and typecheck/build commands when runtime code changes.
