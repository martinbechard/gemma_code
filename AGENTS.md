# Agent Instructions

## Collaboration Model

- The human and AI discuss direction together, but AI agents are the actors that make code and documentation changes in this repository.
- Treat uncommitted local source, test, and documentation edits as AI-authored work unless the human explicitly says otherwise.
- This is experimental open-source work used to understand the capabilities of Gemma 4 as a local coding model.
- Prioritize simple, verified changes over compatibility layers or process overhead.

## Commit Hygiene

- After completing a coherent change and passing verification, run git status.
- Commit verified task changes without waiting for a separate commit request when the dirty files belong to the completed task.
- Split unrelated work into separate commits instead of leaving a broad dirty worktree.
- If dirty files are unrelated to the current task, report them separately and commit them only as their own coherent slice.
