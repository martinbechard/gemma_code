# Query Fragment: Gemma 3 Options For 16GB Local Runtime

## Query Asked

The user noticed the project catalog includes Gemma 3 Text 4B and asked which larger Gemma 3 models might still fit on the 16GB Apple Silicon machine.

## Answer Summary

Gemma 3 has 1B, 4B, 12B, and 27B sizes. For Gemma Code, the best larger Gemma 3 candidate is mlx-community/gemma-3-text-12b-it-4bit because it is instruction tuned, text-only, served through MLX LM, and has about 7.19 GB of model weights. The multimodal mlx-community/gemma-3-12b-it-4bit and mlx-community/gemma-3-12b-it-qat-4bit variants are also plausible at about 8.03 GB of weights, but they route through MLX VLM and have more runtime surface area.

The 12B 6-bit multimodal variant is around 11.22 GB of weights and may be possible with short context and careful memory settings, but it is riskier than the 4-bit options. The 12B 8-bit variant is around 14.41 GB of weights and should not be treated as a comfortable 16GB choice.

The 27B text 4-bit model reports about 16.0 GB on Hugging Face, and the 27B multimodal 4-bit variants are about 16.83 GB, so they do not have enough headroom for a 16GB machine once runtime cache, tokenizer, app memory, and KV cache are included. The 27B QAT 3-bit variant reports about 13.3 GB and might load only as an experiment through MLX VLM with short context, but it should not be cataloged as a normal 16GB option until a local warmup and coding prompt succeed.

## Wiki Pages Consulted

- docs/wiki/modules/shared-types-and-model-registry.md
- docs/wiki/functional/local-model-setup.md
- docs/wiki/subsystems/local-model-runtime.md
- docs/wiki/modules/mlx-runtime.md

## Authoritative Sources Consulted

- models.config.json
- tests/shared/modelRegistry.test.ts
- src/main/modelConfig.ts
- src/main/mlx.ts
- https://blog.google/innovation-and-ai/technology/developers-tools/gemma-3/
- https://huggingface.co/google/gemma-3-1b-it
- https://huggingface.co/mlx-community/gemma-3-text-12b-it-4bit
- https://huggingface.co/mlx-community/gemma-3-12b-it-4bit
- https://huggingface.co/mlx-community/gemma-3-text-27b-it-4bit
- https://huggingface.co/mlx-community/gemma-3-27b-it-qat-3bit
- Hugging Face model API with blobs=true for selected mlx-community Gemma 3 repositories.

## Durable Concepts Detected

- Local Gemma model selection should separate text-only MLX LM candidates from multimodal MLX VLM candidates.
- Artifact size below 16 GB is not enough by itself for a 16GB Apple Silicon recommendation because KV cache and app overhead need headroom.
- A 12B 4-bit Gemma 3 model is the likely middle tier between the current Gemma 3 Text 4B fallback and the Gemma 4 local options.
- 27B Gemma 3 variants need empirical local testing before they can be considered supported on this machine class.

## Candidate Wiki Destinations

- docs/wiki/modules/shared-types-and-model-registry.md
- docs/wiki/modules/mlx-runtime.md
- docs/wiki/subsystems/local-model-runtime.md
- A future local-model-candidates leaf page if model selection research remains recurring.

## Existing Pages To Link

- docs/wiki/modules/shared-types-and-model-registry.md
- docs/wiki/modules/mlx-runtime.md
- docs/wiki/subsystems/local-model-runtime.md
- docs/wiki/functional/local-model-setup.md

## Open Questions

- Should the catalog expose Gemma 3 Text 12B 4-bit as a supported fallback or as an experimental comparison model?
- Should Gemma Code add hardware-gated options for 27B 3-bit experiments, or keep the default catalog limited to models with comfortable 16GB headroom?
- Should multimodal Gemma 3 variants be exposed when the product workflow is currently text-first coding assistance?

## Privacy And Sensitivity Notes

Only public model pages, public Hugging Face API metadata, and local project files were consulted. No private code, PII, or company confidential information was sent to an LLM provider.

## Ingest Rationale

The query captures reusable model-selection guidance that is not currently synthesized in docs/wiki. It should be available to a future wiki ingest pass before adding more local model catalog entries.
