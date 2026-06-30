---
type: "Subsystem"
title: "Local Model Runtime High-Level Design"
description: "The local model runtime installs and supervises MLX, validates model cache readiness, starts the local model server, warms inference, and streams local model responses to both..."
tags: ["subsystems"]
---

# Local Model Runtime High-Level Design

## Current Understanding

The local model runtime installs and supervises MLX, validates model cache readiness, starts the local model server, warms inference, and streams local model responses to both Electron and CLI callers. Configured remote models use the shared model chat router and do not enter the MLX lifecycle.

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

- Recheck this subsystem when configured model entries, MLX packages, cache repair, warmup, runtime patches, or CLI setup behavior changes.

## Parent Architecture

[Architecture](../technical/architecture.md) governs this subsystem.

## Scope

Includes Python runtime discovery, MLX installation, cache inspection, cache reuse, server process lifecycle, warmup inference, model provenance, and local chat-completion requests.

## Current Data Anchors

- [models.config.json](../../../models.config.json) is the configured model list.
- [src/main/modelConfig.ts](../../../src/main/modelConfig.ts) filters local MLX models out of the displayed model list when local MLX support is unavailable.
- The app user-data MLX folder owns venv, model cache, and logs.
- Hugging Face cache folders provide model weights and metadata.

## Constituent Modules

- [MLX Runtime](../modules/mlx-runtime.md) owns process and cache behavior.
- [Shared Types And Model Registry](../modules/shared-types-and-model-registry.md) owns model metadata, endpoint metadata, and runtime mapping.
- [src/main/modelChat.ts](../../../src/main/modelChat.ts) chooses between local MLX streaming and remote endpoint streaming.
- [Main Process](../modules/main-process.md) owns setup IPC orchestration.
- [CLI Runtime](../modules/cli-runtime.md) owns terminal setup/status orchestration.

## Interaction Model

Setup callers ask the MLX runtime to locate or install Python packages, validate cache readiness, start the server, poll download status, warm inference, and then report ready state for local models. Remote setup validates configured endpoint credentials and reports ready without starting MLX.

## Lifecycle

Local startup validates Python and model cache, starts or reuses the server, warms inference, streams responses during chat, and stops the server during app shutdown or repair paths.

## Data Shapes And Contracts

SetupStatus, RuntimeActivity, ModelInfo, ModelProvenance, and StreamChunk are defined by [Shared Types And Model Registry](../modules/shared-types-and-model-registry.md).

## Configuration

Model id, runtime type, model size metadata, and endpoint metadata come from the configured model catalog. MLX VLM KV options can be supplied through environment variables.

## Implementation Order

Runtime cache inspection and patching must remain stable before UI or CLI workflows depend on setup readiness.

## Invariants

- Ready state requires successful warmup inference.
- Incomplete model cache files are repairable setup failures.
- Runtime state belongs under app user-data paths.

## Non-Goals

- The subsystem does not implement a separate Python application server.
- The subsystem does not own configured cloud endpoint calls. Remote inference is routed through model chat and remote chat modules.

## Definition Of Good

Users can install, validate, repair, start, warm, and reuse local model runtime state with actionable error messages. Users on unsupported MLX hosts see configured remote models instead of local MLX choices.

## Verification

Run [tests/main/mlxChatStream.test.ts](../../../tests/main/mlxChatStream.test.ts), [tests/main/mlxServerPatch.test.ts](../../../tests/main/mlxServerPatch.test.ts), [tests/shared/modelRegistry.test.ts](../../../tests/shared/modelRegistry.test.ts), and typecheck/build commands when runtime code changes.
