---
source: src/main/mlx.ts, src/main/modelDownloadState.ts, src/main/index.ts, src/cli/setup.ts, src/renderer/src/components/Setup.tsx
target: docs/wiki/functional/local-model-setup.md, docs/wiki/functional/cli-workflows.md, docs/wiki/modules/mlx-runtime.md
---

# Background Local Model Downloads

Extracted facts:

- The CLI download-model command uses Hugging Face snapshot_download through the managed MLX Python environment.
- Snapshot downloads write into the same app Hugging Face cache used by Electron and MLX runtime startup.
- The direct snapshot download path does not start the MLX server or warm inference.
- Electron background downloads and CLI download-model use the same model-downloads.json persistence logic for requested, active, failed, incomplete, and downloaded local model states.
- The selected model setup path still validates cache readiness, starts MLX, and warms inference before the app reports ready.
- Local model download intent and progress are recorded in model-downloads.json under app data.
- The setup welcome screen shows Download, Resume download, Downloading, or Downloaded beside local model rows according to cache state and persisted download state.
- On restart, requested downloads that are not complete are shown as resumable instead of never requested.
