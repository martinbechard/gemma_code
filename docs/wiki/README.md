---
type: "Project Wiki"
title: "Gemma Code Project Wiki"
description: "This wiki is the maintained documentation surface for Gemma Code."
---

# Gemma Code Project Wiki

This wiki is the maintained documentation surface for Gemma Code. It summarizes the current project understanding across source code, tests, README content, design notes, and runtime behavior.

The wiki is not the highest authority. Code and tests describe actual behavior, functional pages describe observable behavior, technical pages describe design intent, and this wiki links the evidence together.

## Entry Pages

- [Architecture](technical/architecture.md)
- [Subsystem Designs](subsystems/index.md)
- [Module Designs](modules/index.md)
- [Functional Workflows](functional/index.md)
- [Code Map](code/index.md)
- [Topic Index](topic-index.md)
- [Glossary](glossary.md)
- [Open Decisions](open-decisions.md)
- [Known Defects](known-defects.md)
- [Maintenance Log](maintenance-log.md)
- [Development Digests](digests/index.md)

## Source Navigation

- [Source tree](src)
- [Repository README](../../README.md)
- [Agent instructions](../../AGENTS.md)
- [Design notes](../../design)
- [Automated tests](../../tests)

## Maintenance

Run these from the repository root before treating a wiki pass as complete.

```bash
python3 ~/.codex/skills/project-wiki/scripts/wiki_ops.py status
python3 ~/.codex/skills/project-wiki/scripts/wiki_ops.py lint
python3 ~/.codex/skills/project-wiki/scripts/wiki_ops.py questions
```

Functional and technical pages under this wiki use the shared wiki-compatible section set first, then add their specialized sections.
