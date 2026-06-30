---
type: "Topic Index"
title: "Topic Index"
description: "Architecture explains the whole-system structure."
---

# Topic Index

## Primary Topics

- [Architecture](technical/architecture.md) explains the whole-system structure.
- [Subsystem Designs](subsystems/index.md) groups cooperating modules by runtime responsibility.
- [Module Designs](modules/index.md) documents implementation units and their local contracts.
- [Functional Workflows](functional/index.md) documents user-visible behavior.
- [Code Map](code/index.md) maps runtime surfaces to source and tests.
- [Glossary](glossary.md) defines recurring project terms.
- [Open Decisions](open-decisions.md) records unresolved source conflicts.
- [Known Defects](known-defects.md) records defect-source interpretation.
- [Development Digests](digests/index.md) is reserved for commit or source digests.

## Source Neighborhoods

- [Main process source](../../src/main) owns Electron main process runtime, MLX supervision, tools, plan harness, workspaces, logs, and background tasks.
- [CLI source](../../src/cli) owns command line argument parsing, setup/status commands, worktree mode, conversation snapshots, and terminal harness behavior.
- [Renderer source](../../src/renderer) owns React UI, setup screens, chat workflows, conversation persistence, log viewer, and message rendering.
- [Preload source](../../src/preload) owns the IPC bridge exposed to the renderer.
- [Shared source](../../src/shared) owns shared request, stream, model, setup, workspace, and log types.
- [Automated tests](../../tests) owns regression coverage for main, CLI, renderer, and shared modules.
- [Design notes](../../design) contains implementation plans and analysis notes.
