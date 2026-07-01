---
type: "Topic"
title: "Local Model Setup Functional Specification"
description: "Users prepare a selected local model by letting Gemma Code install or reuse MLX, validate model files, start the local server, download or reuse weights, warm inference, and report..."
tags: ["functional"]
---

# Local Model Setup Functional Specification

## Current Understanding

Users prepare a selected local model by letting Gemma Code install or reuse MLX, validate model files, start the local server, download or reuse weights, warm inference, and report readiness. Local models can also be downloaded in the background before selection, with resumable state shown in the setup model list. Remote models validate configured provider credentials from process environment or .env before readiness. Electron and CLI downloads share the same app cache and model-downloads.json state file.

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
- [src/main/modelDownloadState.ts](../../../src/main/modelDownloadState.ts)
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

- Recheck when setup stages, repair metadata, configured model list behavior, warmup, or cache validation changes.

## Parent Workflow

This page belongs to [Functional Workflows](index.md) and supports both [Electron App Workflows](electron-app-workflows.md) and [CLI Workflows](cli-workflows.md).

## Actors

- User selects a model and starts setup.
- Electron main process or CLI setup command performs runtime work.
- MLX server serves the selected model locally.

## Entry Points

- Welcome/setup screen Start button.
- Model switching in the app.
- Local model row Download and Resume download buttons.
- Resume download repair button for selected-model setup failures.
- Configure API key action for selected remote models.
- Set API key action for missing remote credential setup errors.
- CLI setup command.
- CLI status command for readiness inspection.

## Scope

Includes MLX installation, cache validation, background download progress, repairable incomplete download state, server startup, warmup, remote credential configuration, and ready state.

## Concepts

- Setup stage: current model preparation state.
- Repairable setup error: incomplete or unusable model cache that can be resumed.
- Background model download: persisted local-model cache download that runs through Hugging Face snapshot_download without starting the MLX server. The Electron app and CLI download-model command both use this state model.
- Remote credential: provider key stored in the local .env file and validated before remote model readiness.
- Model provenance: optional model revision/cache display detail.

## Workflows

1. User opens the app.
2. App selects a startup model from recent conversation state or the configured default.
3. User starts setup or the app auto-starts setup when the local model is locally available and MLX support is present.
4. The main process emits setup stages.
5. The setup UI displays progress, byte counts, errors, and repair action when available.
6. When warmup inference succeeds, the app moves to ready.

CLI setup follows the same runtime work and prints stages to stdout.

Background model downloads follow this flow:

1. The setup model picker lists local model cache states.
2. User clicks Download for a never-requested missing local model or Resume download for a requested incomplete local model.
3. The main process or CLI persists download intent under app data and starts snapshot_download in the managed Python environment.
4. The setup model picker receives progress updates while the app can continue using another already-started model.
5. On restart, requested downloads that are not complete appear as resumable.

## States And Rules

- Welcome state appears before setup starts.
- Working stages include checking, installing, validating, starting, repairing, downloading, and warming.
- ready means the runtime can chat.
- error with repair metadata shows Resume download.
- non-repair error shows Try again.
- missing remote credential error shows Set API key.
- Local model rows show Download for never-requested missing models, Resume download for requested or incomplete models, Downloading for active background downloads, and Downloaded for ready caches.
- The model picker can offer both MLX LM and MLX VLM local models when local MLX support is available; Gemma 3 Text 12B appears as a text-only MLX LM comparison model, Gemma 3 12B 6-bit appears as a higher-precision MLX VLM experiment, and Ornith 1.0 9B appears as an experimental MLX VLM agentic coding option.
- The welcome model picker keeps model choices in an internal scroll area so setup actions remain reachable when the catalog contains more entries than fit vertically.

## Edge Cases

- Missing Python reports install guidance.
- Incomplete model cache reports repairable setup error.
- Requested incomplete background downloads remain resumable after restart.
- Interrupted CLI downloads remain resumable in Electron because cache state and persisted download intent share app data.
- Server startup failure includes command and log file where available.
- Local model unavailable leaves the setup screen available.
- Local MLX models are not offered when local MLX support is unavailable.

## Verification

Type: Testable

Test files: [tests/renderer/components/Setup.test.ts](../../../tests/renderer/components/Setup.test.ts), [tests/main/modelDownloadState.test.ts](../../../tests/main/modelDownloadState.test.ts), [tests/main/mlxChatStream.test.ts](../../../tests/main/mlxChatStream.test.ts), [tests/shared/modelRegistry.test.ts](../../../tests/shared/modelRegistry.test.ts)

Status: Present

Scenario: Setup state and runtime readiness are represented through shared status records and setup UI.

Steps:

1. Exercise setup component states.
2. Exercise background download state derivation and persistence behavior.
3. Exercise MLX stream and server patch behavior.
4. Exercise configured model list behavior.

Assertions:

- Setup UI renders progress, repairable error behavior, and remote credential configuration behavior.
- Setup UI renders local model Download, Resume download, Downloading, and Downloaded states.
- Setup UI keeps the model list scrollable without hiding the start action.
- Requested incomplete model downloads derive as resumable after restart.
- MLX runtime errors carry actionable context.
- Configured model list supplies the UI model list.
