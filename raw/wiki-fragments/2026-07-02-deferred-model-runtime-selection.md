# Wiki Fragment: Deferred Model Runtime Selection

## Source Files

- src/renderer/src/App.tsx
- src/renderer/src/components/Chat.tsx
- src/renderer/src/components/Sidebar.tsx
- src/renderer/src/lib/appState.ts
- src/main/index.ts
- src/main/mlx.ts
- tests/renderer/lib/appState.test.ts
- tests/renderer/components/ChatSourceBehavior.test.ts
- tests/renderer/components/Sidebar.test.ts

## Extracted Facts

- Selecting a saved conversation no longer asks the main process to switch or start the selected model runtime.
- The renderer can display and browse stamped conversations without preparing the corresponding local or remote model.
- The in-chat model picker updates the selected or stamped model in renderer state and local storage without immediately calling the main process runtime switch handler.
- Sending a prompt and executing an approved plan call the renderer model-ready callback before sending the chat request to the main process.
- The app tracks the last successfully prepared model separately from the currently selected model so repeated sends can avoid redundant setup.
- Model switch failures now reject the IPC call after publishing setup error status, which prevents the renderer from sending a prompt after failed runtime preparation.
- Local MLX server replacement waits for the previous managed child process to exit before binding a new server on the canonical port.
- Sidebar conversation rows show the stamped model label in the title and show Chat, Build, or Code metadata below the title.

## Candidate Wiki Destinations

- docs/wiki/modules/renderer-ui.md
- docs/wiki/functional/electron-app-workflows.md
- docs/wiki/subsystems/electron-app-runtime.md
- docs/wiki/modules/mlx-runtime.md

## Ingest Notes

- This fragment captures source-backed behavior added for deferred local runtime startup and conversation browsing.
- The wiki should describe the steady-state behavior without framing it as a revision from older eager switching.
