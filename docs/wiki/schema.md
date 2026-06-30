---
type: "Wiki Schema"
title: "Wiki Schema"
description: "The wiki is a maintained synthesis layer for Gemma Code. It summarizes and links project knowledge but does not replace authoritative sources."
---

# Wiki Schema

The wiki is a maintained synthesis layer for Gemma Code. It summarizes and links project knowledge but does not replace authoritative sources.

## Authority Order

1. Code and tests describe actual behavior.
2. Functional specifications and requirements describe intended behavior.
3. [AGENTS.md](../../AGENTS.md), [README.md](../../README.md), and procedure files describe workflow obligations.
4. Backlog files describe tracked work when present.
5. Architecture, high-level design, module design, and plan documents describe design intent.
6. Wiki pages summarize and navigate the sources above.

## Shared Page Sections

Every durable topic page and documentation subclass starts with:

```markdown
# Topic Name

## Current Understanding

## Authoritative Sources

## Related Code

## Related Tests

## Related Backlog Items

## Related Wiki Pages

## Open Questions

## Maintenance Notes
```

## Documentation Subclasses

Module design, subsystem design, architecture, and functional pages keep the shared sections first. They append their specialized sections after Maintenance Notes.

This means pages in [modules](modules/index.md), [subsystems](subsystems/index.md), [technical](technical/architecture.md), and [functional](functional/index.md) can be loaded as normal wiki pages while still carrying the design or specification detail needed by their document type.

## Maintenance Rules

- Update the wiki when behavior, intended behavior, workflow obligations, source ownership, verification, or open decisions change.
- Prefer focused leaves over omnibus pages.
- Use folder index pages as hubs and keep implementation detail in leaf pages.
- Link named source artifacts at the point where they are discussed.
- Preserve unresolved contradictions in Open Questions instead of inventing a resolution.
- Use [open-decisions.md](open-decisions.md) for cross-page decisions and source conflicts.
- Run wiki lint before completion.
