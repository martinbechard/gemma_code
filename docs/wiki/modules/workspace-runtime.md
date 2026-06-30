---
type: "Topic"
title: "Workspace Runtime Design"
description: "The workspace runtime owns per-conversation sandbox paths, user-selected working-directory overrides, safe path resolution, preview HTTP serving, workspace file listing, and atomic..."
tags: ["modules"]
---

# Workspace Runtime Design

## Current Understanding

The workspace runtime owns per-conversation sandbox paths, user-selected working-directory overrides, safe path resolution, preview HTTP serving, workspace file listing, and atomic file read/write/edit helpers.

## Authoritative Sources

- [Workspace runtime source](../../../src/main/workspace.ts)
- [Tool modules](../../../src/main/tools)
- [README file context and edits section](../../../README.md)

## Related Code

- [src/main/workspace.ts](../../../src/main/workspace.ts)
- [src/main/runtimePaths.ts](../../../src/main/runtimePaths.ts)
- [src/main/tools/writeFile.ts](../../../src/main/tools/writeFile.ts)
- [src/main/tools/editFile.ts](../../../src/main/tools/editFile.ts)
- [src/main/tools/readFile.ts](../../../src/main/tools/readFile.ts)
- [src/main/tools/fileContext.ts](../../../src/main/tools/fileContext.ts)

## Related Tests

- [tests/main/writeFileTool.test.ts](../../../tests/main/writeFileTool.test.ts)
- [tests/main/writeFileStreaming.test.ts](../../../tests/main/writeFileStreaming.test.ts)
- [tests/main/searchFilesTool.test.ts](../../../tests/main/searchFilesTool.test.ts)

## Related Backlog Items

- Not yet identified.

## Related Wiki Pages

- [Tool And Workspace Runtime](../subsystems/tool-and-workspace-runtime.md)
- [Tool Runtime](tool-runtime.md)
- [Electron App Workflows](../functional/electron-app-workflows.md)

## Open Questions

No open wiki questions are recorded for this topic.

## Maintenance Notes

- Recheck this page when workspace path policy, preview serving, file tools, or workspace override behavior changes.

## Runtime Path

Primary implementation: [src/main/workspace.ts](../../../src/main/workspace.ts).

## Parent Context

This module implements the workspace side of the [Tool And Workspace Runtime](../subsystems/tool-and-workspace-runtime.md).

## Responsibilities

- Resolve workspace roots under app user data.
- Allow per-conversation absolute working-directory overrides.
- Prevent path traversal outside the active workspace.
- Start a localhost preview server and serve files or directory listings.
- Provide workspace file tree listing.
- Read, write, edit, and delete workspace files through controlled helpers.

## Callers

- [Main Process](main-process.md) starts and stops the preview server and exposes workspace IPC handlers.
- [Tool Runtime](tool-runtime.md) calls workspace helpers through file tools.
- [CLI Runtime](cli-runtime.md) sets workspace overrides for repository and worktree execution.

## Dependencies

- Runtime path module, Node filesystem APIs, HTTP server APIs, path resolution, and child process for open external behavior.

## Public Contracts

- WorkspaceInfo contains conversation id, path, and preview URL.
- File tools operate on paths relative to the active workspace.

## Internal Data And State

- Maintains one preview server and a map of conversation id to workspace override.

## Processing Rules

- All target paths are resolved through assertInWorkspace.
- Writes use a temporary file followed by rename.
- Hidden files and node_modules are skipped in workspace tree listing.

## Invariants

- A relative path must never escape the workspace root.
- Preview URLs use sanitized conversation ids.
- Workspace overrides are resolved absolute paths.

## Configuration

- Workspace roots are derived from runtime user-data paths.

## External Interfaces

- Local HTTP preview server, filesystem, and shell opener.

## UI And Notification Behavior

- Workspace changes are sent to the renderer so file lists and preview surfaces can refresh.

## Error Handling

- Path escapes throw errors. Missing preview files return HTTP not found unless the workspace root is empty, where a placeholder is served.

## Verification

- Use file tool tests under [tests/main](../../../tests/main) and workspace-related CLI tests where worktree mode interacts with overrides.
