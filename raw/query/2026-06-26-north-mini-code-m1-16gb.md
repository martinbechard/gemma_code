# Query Fragment: North Mini Code On 16GB M1 Mac

## Query Asked

The user is considering adding support for Cohere North Mini Code using the MLX-aware model at https://huggingface.co/mlx-community/North-Mini-Code-1.0-4bit and asked whether it can run on a 16GB M1 Mac mini.

## Answer Summary

The 16GB M1 Mac mini has enough disk space for the model files, but the MLX quantized North Mini Code artifacts are likely too large to run comfortably in this project. The mlx-community 4-bit repo reports an 18.5 GB model folder, while third-party MXFP4 MLX conversions report about 16.8 to 17.6 GB on disk and about 17.8 to 18.3 GB peak memory on 24GB or 32GB Apple Silicon machines. The upstream model card describes North Mini Code as a 30B total, 3B active sparse MoE model with 256K context and 64K maximum output. That footprint exceeds the current Gemma Code model registry assumptions, where the largest registered model is the 11 GB Gemma 4 12B QAT entry routed through MLX VLM.

## Wiki Pages Consulted

- docs/wiki/modules/shared-types-and-model-registry.md
- docs/wiki/modules/mlx-runtime.md
- docs/wiki/subsystems/local-model-runtime.md

## Authoritative Sources Consulted

- src/shared/types.ts
- src/main/mlx.ts
- package.json
- https://huggingface.co/mlx-community/North-Mini-Code-1.0-4bit
- https://huggingface.co/CohereLabs/North-Mini-Code-1.0
- https://huggingface.co/bsisduck/North-Mini-Code-1.0-MLX-MXFP4
- https://huggingface.co/sahilchachra/north-mini-code-mxfp4-mlx
- Local machine checks: sysctl reports 17179869184 bytes of memory, uname reports arm64, df reports sufficient free disk space.

## Durable Concepts Detected

- North Mini Code is a candidate local coding model, but its 4-bit MLX artifact is larger than the project’s current 16GB-friendly model entries.
- The model likely needs a higher hardware tier gate, probably 24GB minimum and 32GB preferred, unless a smaller quantization or runtime-specific memory measurement proves otherwise.
- Format is not the main blocker. The model can exist as MLX LM, MLX VLM, and GGUF variants, but the measured MLX memory footprint still exceeds the 16GB machine class.
- The mlx-community repo was converted with mlx-vlm, while other MLX variants advertise mlx-lm support. Support should be treated as a runtime compatibility experiment, not only a model registry addition.
- Long context settings matter because the model advertises very large context and output limits, and KV cache memory can dominate even when quantized weights load.

## Candidate Wiki Destinations

- docs/wiki/modules/shared-types-and-model-registry.md
- docs/wiki/modules/mlx-runtime.md
- docs/wiki/subsystems/local-model-runtime.md
- docs/wiki/open-decisions.md

## Existing Pages To Link

- docs/wiki/modules/shared-types-and-model-registry.md
- docs/wiki/modules/mlx-runtime.md
- docs/wiki/subsystems/local-model-runtime.md

## Open Questions

- Should Gemma Code expose hardware-gated model options above the 16GB class?
- Should model registry metadata include minimum recommended unified memory instead of only model byte size?
- Should North Mini Code use MLX VLM in this app, or should support wait for MLX LM compatibility with cohere2_moe?
- What is the measured peak resident memory and warmup behavior on Apple Silicon with this specific MLX conversion?

## Privacy And Sensitivity Notes

Only public Hugging Face model metadata, local project files, and local hardware capacity checks were used. No code or private project content was sent to an external LLM.

## Ingest Rationale

This query records a concrete model support decision point for the local model runtime and shared model registry. Future implementation work should load this fragment before adding North Mini Code to the picker or changing hardware recommendations.
