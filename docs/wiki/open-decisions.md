# Open Decisions

## Current Decisions Needed

- The configured renderer/app default model is [Gemma 4 E4B](../../models.config.json), while the CLI argument parser defaults to [Gemma 4 E2B](../../src/cli/args.ts). Decide whether the CLI should intentionally prefer the smaller model or derive its default from the configured model catalog.

## Open Questions

- Should the CLI intentionally default to [Gemma 4 E2B](../../src/cli/args.ts), or should it derive the default from [models.config.json](../../models.config.json)?

## Maintenance Rules

- Add an entry when authoritative sources disagree and the correct steady-state answer is unclear.
- Include the source files involved.
- Resolve an entry only after the authoritative source has been updated or the decision is explicitly accepted.
