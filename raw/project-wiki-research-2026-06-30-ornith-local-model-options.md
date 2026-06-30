# Project Wiki Research: Ornith Local Model Options

## Request

The user wants to add Ornith to Gemma Code and asked what Ornith models are available, whether MLX variants exist, and which variant can run on a 16GB Apple Silicon Mac.

## Existing Wiki Check

Checked docs/wiki through the project-wiki status command. The wiki exists, has 33 pages, has all required files, and had zero lint findings before this research report.

Relevant local pages checked:

- docs/wiki/modules/shared-types-and-model-registry.md
- docs/wiki/modules/mlx-runtime.md
- docs/wiki/functional/local-model-setup.md
- docs/wiki/subsystems/local-model-runtime.md
- docs/wiki/technical/architecture.md

The wiki explains the local model catalog and MLX runtime surfaces, but it does not yet cover Ornith model selection.

## Research Scope

Public-source check on June 30, 2026 for Ornith Hugging Face model availability, MLX conversions, model artifact sizes, and likely fit on the local 16GB arm64 Mac used for Gemma Code development.

Local machine checks:

- sysctl hw.memsize reported 17179869184 bytes.
- uname reported arm64.

## Source Inventory

- https://huggingface.co/deepreinforce-ai/Ornith-1.0-9B
  - Primary DeepReinforce model card.
  - Accessed June 30, 2026.
  - Describes Ornith 1.0 as an MIT-licensed agentic coding model family with 9B Dense, 31B Dense, 35B MoE, and 397B MoE members. The page states the 9B base checkpoint is about 19 GB in bf16, is a reasoning model, and recommends recent Transformers, vLLM, or SGLang serving.
- https://huggingface.co/deepreinforce-ai/Ornith-1.0-35B
  - Primary DeepReinforce model card.
  - Accessed June 30, 2026.
  - Describes the 35B member as a reasoning model and gives single 8 by 80GB GPU node serving recipes for vLLM and SGLang.
- https://huggingface.co/deepreinforce-ai/Ornith-1.0-397B
  - Primary DeepReinforce model card.
  - Accessed June 30, 2026.
  - Describes the 397B member as a reasoning model and gives single 8 by 80GB GPU node serving recipes for vLLM and SGLang.
- https://huggingface.co/mlx-community/Ornith-1.0-9B-4bit
  - Primary Hugging Face repository for the MLX Community conversion.
  - Accessed June 30, 2026.
  - States the conversion was made from deepreinforce-ai/Ornith-1.0-9B using mlx-vlm 0.6.3 and shows mlx-vlm usage.
- https://huggingface.co/mlx-community/Ornith-1.0-35B-4bit
  - Primary Hugging Face repository for the MLX Community conversion.
  - Accessed June 30, 2026.
  - States the 35B 4-bit conversion was produced with mlx-vlm 0.6.3, preserves the vision encoder, and smoke-tested at peak 20.9 GB on a high-memory MacBook Pro.
- Hugging Face model API queries for deepreinforce-ai and mlx-community Ornith repositories.
  - Accessed June 30, 2026.
  - Used to verify visible repository names, last-modified dates, library tags, and model artifact sizes.

## Synthesis

Ornith 1.0 is publicly represented as a family for agentic coding. The model cards name 9B Dense, 31B Dense, 35B MoE, and 397B MoE family members. Current Hugging Face search results found public DeepReinforce repositories for 9B, 35B, 397B, 397B FP8, 35B FP8, and official GGUF repositories for 9B and 35B. A direct search for Ornith-1.0-31B did not return an obvious public DeepReinforce 31B repository during this check.

There are MLX variants. The most relevant for Gemma Code is mlx-community/Ornith-1.0-9B-4bit because it follows the existing mlx-community naming style, uses a public DeepReinforce base model, and has about 5.98 GB of files. Its config reports qwen3_5 model type, Qwen3_5ForConditionalGeneration architecture, qwen3_5_text text config, qwen3_5_vision vision config, and 4-bit affine quantization. The model card says to use mlx-vlm.

The 9B bf16 MLX conversion is about 18.85 GB, so it is not a good fit for a 16GB Mac. The 35B MLX conversions are not a 16GB fit. The mlx-community 35B 4-bit conversion is about 20.43 GB in files and the model card reports peak 20.9 GB during a smoke test on a 128GB MacBook Pro. Other 35B MLX 5-bit and oQ5 conversions are around 25 GB. The 397B MLX conversions are far beyond the local machine class at roughly 223 GB for 4-bit and 421 GB for 8-bit.

The 9B GGUF Q4_K_M file is about 5.63 GB and would be a plausible 16GB local target through llama.cpp, but Gemma Code currently has MLX and remote runtimes, not a GGUF runtime. Adding GGUF would be a separate backend decision rather than a simple model catalog entry.

For the current codebase, the first candidate should be mlx-community/Ornith-1.0-9B-4bit with runtime mlx-vlm. It should not be marked as the default or recommended until setup, server startup, warmup, and a short coding prompt are tested. It is also a reasoning model whose native serving recipes expect reasoning and tool-call parser support, so a follow-up should verify whether Gemma Code receives ordinary assistant content from mlx-vlm server output or needs special handling for think blocks or reasoning fields.

## Named Entities And Concepts

- Ornith 1.0
- deepreinforce-ai/Ornith-1.0-9B
- deepreinforce-ai/Ornith-1.0-35B
- deepreinforce-ai/Ornith-1.0-397B
- deepreinforce-ai/Ornith-1.0-9B-GGUF
- deepreinforce-ai/Ornith-1.0-35B-GGUF
- mlx-community/Ornith-1.0-9B-4bit
- mlx-community/Ornith-1.0-9B-bf16
- mlx-community/Ornith-1.0-35B-4bit
- mlx-vlm
- GGUF
- Qwen3.5 and Qwen3VL model architecture
- Reasoning model output
- Tool-call parsing

## Candidate Wiki Destinations

- docs/wiki/modules/shared-types-and-model-registry.md
- docs/wiki/modules/mlx-runtime.md
- docs/wiki/subsystems/local-model-runtime.md
- docs/wiki/open-decisions.md
- A future local-model-candidates leaf page if model-selection research becomes recurring.

## Existing Pages To Link

- docs/wiki/modules/shared-types-and-model-registry.md
- docs/wiki/modules/mlx-runtime.md
- docs/wiki/subsystems/local-model-runtime.md
- docs/wiki/functional/local-model-setup.md
- docs/wiki/technical/architecture.md

## Conflicts Or Uncertainties

- The model family card names a 31B Dense member, but this check did not find a corresponding public DeepReinforce Ornith-1.0-31B Hugging Face repository.
- The 9B 4-bit MLX artifact size suggests it should fit on a 16GB Mac, but actual Gemma Code support still depends on mlx-vlm server compatibility, warmup behavior, context length, KV cache growth, and how reasoning output is streamed.
- The MLX Community 9B card routes users through mlx-vlm. Treat mlx-lm compatibility as unproven until a smoke test demonstrates it.

## Excluded Sources Or Claims

- Broad community fine-tunes, uncensored variants, and experimental MTP or adapter repositories were not treated as first-choice candidates for Gemma Code because they add provenance or behavior uncertainty.
- GGUF variants were noted but not selected for immediate Gemma Code integration because this project does not currently have a GGUF runtime.
- Benchmark scores were not used as a selection gate beyond noting that the model cards describe Ornith as an agentic coding family. Runtime fit and clean integration are the immediate decision criteria.

## Privacy And Sensitivity Notes

Only public Hugging Face metadata, public model cards, and local hardware capacity commands were used. No repository source code, private data, PII, or company confidential information was sent to a model provider.

## Follow-Up For Ingest

When implementation work starts, add a local model entry for mlx-community/Ornith-1.0-9B-4bit as an experimental mlx-vlm model, then run setup, warmup, and a short coding prompt on the 16GB Mac. If that succeeds, update the model registry wiki and local runtime wiki with the measured result. If it fails, record the exact mlx-vlm server and warmup error before trying third-party 9B MLX variants or a GGUF backend.
