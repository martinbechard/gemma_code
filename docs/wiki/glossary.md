---
type: "Glossary"
title: "Glossary"
description: "Gemma Code: The local-first coding agent implemented by this repository."
---

# Glossary

## Terms

- Gemma Code: The local-first coding agent implemented by this repository.
- MLX runtime: The app-managed Python environment and local MLX server used to serve Gemma models.
- Tool action: The XML action block emitted by the model and parsed by the harness before running a tool.
- Plan harness: The plan assembly, semantic review, execution, evidence, and verify loop shared by Electron and CLI code workflows.
- Build mode: Code mode without a user-selected working directory; the app uses a per-conversation workspace sandbox.
- Code mode: Code workflow with a user-selected working directory.
- Freestyle mode: Code workflow that lets the model decide how to proceed without the structured plan harness.
- Execution log: JSONL debug log under the app user-data debug directory containing prompts, model chunks, tool calls, evidence, and verify events.
- File context: The tracked set of files recently read or modified by file tools and returned to the model after file operations.
- Workspace override: A per-conversation absolute path used by the CLI and Code mode to operate outside the default sandbox.

## Maintenance Notes

- Add recurring terms when multiple pages or source files use them.
