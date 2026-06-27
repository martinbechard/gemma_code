# Agent Instructions

## Collaboration Model

- The human and AI discuss direction together, but AI agents are the actors that make code and documentation changes in this repository.
- Treat uncommitted local source, test, and documentation edits as AI-authored work unless the human explicitly says otherwise.
- This is experimental open-source work used to understand the capabilities of Gemma 4 as a local coding model.
- Prioritize simple, verified changes over compatibility layers or process overhead.

## Project Wiki Workflow

- Use the project-wiki-query skill for wiki-backed questions and lightweight project knowledge lookups.
- Check docs/wiki first when answering questions about this project, then verify the answer against authoritative project files before replying. The wiki is a synthesis layer, not the source of truth.
- When reviewing project files reveals durable project knowledge that is not captured in the wiki, create a raw wiki fragment under raw before synthesizing it into docs/wiki.
- Raw wiki fragments should name the source file, record the extracted facts, and note the wiki page or topic that should receive the synthesis.
- Keep fragments out of raw/processed until the knowledge has been synthesized into docs/wiki and wiki lint has passed.

## Commit Hygiene

- After completing a coherent change and passing verification, run git status.
- Commit verified task changes without waiting for a separate commit request when the dirty files belong to the completed task.
- Split unrelated work into separate commits instead of leaving a broad dirty worktree.
- If dirty files are unrelated to the current task, report them separately and commit them only as their own coherent slice.
