# Wiki Fragment: Cloud Credential Env Modal

## Source Files

- src/main/envFile.ts
- src/main/remoteCredentials.ts
- src/main/modelConfig.ts
- src/main/remoteChat.ts
- src/main/index.ts
- src/preload/index.ts
- src/renderer/src/components/Setup.tsx
- src/shared/types.ts
- tests/main/envFile.test.ts
- tests/renderer/components/Setup.test.ts
- README.md
- .env.example

## Extracted Facts

- Remote model credentials are loaded from the project .env file when the matching process environment value is missing.
- Shell environment values still take precedence over .env values.
- The Electron setup UI exposes a cloud model configuration modal for the selected remote model.
- Missing remote credential setup errors include a Set API key action that opens the same credential modal.
- Saving a key writes or updates the matching provider key entry in .env and updates the active main process environment.
- The preload bridge exposes remote credential status and save operations to the renderer.
- The CLI uses the same model configuration and remote readiness path, so remote setup and chat commands can use credentials loaded from .env.

## Candidate Wiki Pages

- docs/wiki/modules/shared-types-and-model-registry.md
- docs/wiki/modules/main-process.md
- docs/wiki/modules/preload-ipc-bridge.md
- docs/wiki/modules/renderer-ui.md
- docs/wiki/modules/cli-runtime.md
- docs/wiki/functional/local-model-setup.md

## Processing Notes

- The candidate wiki pages describe the .env credential flow and wiki lint passed before this fragment was processed.
