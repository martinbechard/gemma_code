# Query Fragment: Electron Cache Startup Errors

## Query Asked

What does the repeated startup error from simple_backend_impl.cc and disk_cache.cc mean when Gemma Code starts and reports wrong file structure on disk for Shared Dictionary/cache and Cache/Cache_Data?

## Answer Summary

The reported paths are Chromium or Electron browser cache directories under the Gemma Code user-data folder. They are separate from the MLX runtime and Hugging Face model cache, which live under the app user-data mlx directory. The startup messages mean Chromium could not open those disposable browser cache folders because the cache metadata on disk did not match the expected simple-cache structure. The likely user action is to quit the app and clear only the Chromium cache folders so Electron can recreate them.

## Wiki Pages Consulted

- docs/wiki/subsystems/electron-app-runtime.md
- docs/wiki/modules/mlx-runtime.md
- docs/wiki/functional/local-model-setup.md
- docs/wiki/technical/architecture.md

## Authoritative Sources Consulted

- src/main/index.ts
- src/main/runtimePaths.ts
- src/main/mlx.ts
- On-disk app-data directory under ~/Library/Application Support/gemma-code

## Durable Concepts Detected

- Electron user-data contains both disposable Chromium browser caches and durable app runtime state.
- MLX model/runtime files are rooted under the configured app user-data mlx directory and should not be cleared when repairing Chromium cache startup errors.
- The MLX startup lines saying runtimes were found and patches were already compatible are separate benign status lines from src/main/mlx.ts.

## Candidate Wiki Destinations

- docs/wiki/subsystems/electron-app-runtime.md
- docs/wiki/modules/main-process.md
- docs/wiki/modules/mlx-runtime.md

## Existing Pages To Link

- docs/wiki/subsystems/electron-app-runtime.md
- docs/wiki/modules/mlx-runtime.md

## Open Questions

- Should the app expose a developer cleanup command for disposable Chromium cache directories?
- Should startup logging distinguish Electron browser cache failures from MLX model cache checks more clearly?

## Privacy And Sensitivity Notes

The user-data path was normalized to a home-relative path. No model prompts, conversations, credentials, or file contents were captured.

## Ingest Rationale

This is recurring startup troubleshooting knowledge that future agents should not confuse with local model cache validation or MLX runtime setup.
