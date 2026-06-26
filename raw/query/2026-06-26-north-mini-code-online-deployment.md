# Query Fragment: North Mini Code Online Deployment Options

## Query Asked

The user asked whether North Mini Code experiments could run through Hugging Face Endpoints, Cohere Cloud, or an online virtual server for AI models.

## Answer Summary

There are three practical online paths. Cohere Cloud is the fastest path for quality experiments because Cohere documents North Mini Code with model ID north-mini-code-1-0, Chat V2, Chat V1, and Chat Completions support, and free use until rate limits are reached for trial and production keys. Hugging Face Inference Endpoints are plausible for hosted deployment, but the MLX Apple Silicon artifact is not the right target for standard cloud GPUs; the CohereLabs/North-Mini-Code-1.0-w4a16 checkpoint is documented for vLLM and SGLang and is not deployed by any Hugging Face Inference Provider at the time checked. General GPU VMs or serverless GPU platforms are viable for custom experiments with vLLM, SGLang, or llama.cpp, especially when debugging runtime behavior or OpenAI-compatible serving.

## Wiki Pages Consulted

- docs/wiki/technical/architecture.md
- docs/wiki/modules/mlx-runtime.md
- docs/wiki/modules/shared-types-and-model-registry.md
- docs/wiki/subsystems/local-model-runtime.md

## Authoritative Sources Consulted

- src/main/mlx.ts
- src/shared/types.ts
- https://docs.cohere.com/docs/north-mini-code-1.0
- https://docs.cohere.com/docs/compatibility-api
- https://docs.cohere.com/docs/model-vault
- https://huggingface.co/CohereLabs/North-Mini-Code-1.0-w4a16
- https://huggingface.co/docs/inference-endpoints/en/pricing
- https://huggingface.co/docs/inference-endpoints/en/engines/custom_container
- https://docs.vllm.ai/en/stable/deployment/frameworks/hf_inference_endpoints/
- https://lambda.ai/pricing
- https://modal.com/docs/guide/gpu
- https://modal.com/pricing

## Durable Concepts Detected

- The current Gemma Code runtime is local-first and hardwired around a local MLX OpenAI-compatible server, so remote models require either a provider abstraction or use of an OpenAI-compatible endpoint.
- Cohere Cloud is the preferred zero-infrastructure experiment path for model behavior and prompt/tool-call quality.
- Hugging Face Inference Endpoints are a managed deployment path when the experiment needs a dedicated endpoint, but North Mini Code likely needs the vLLM-oriented w4a16 checkpoint or a custom container, not the MLX artifact.
- GPU VMs and serverless GPU platforms are the highest-control path for serving experiments, especially when testing vLLM, SGLang, llama.cpp, context limits, and interleaved reasoning handling.
- Hardware class should be chosen from context length needs: short-context experiments may fit lower-cost 48GB GPUs, while long-context or production-like runs should target A100 80GB, H100, H200, or equivalent.

## Candidate Wiki Destinations

- docs/wiki/technical/architecture.md
- docs/wiki/modules/mlx-runtime.md
- docs/wiki/modules/shared-types-and-model-registry.md
- docs/wiki/open-decisions.md
- A future remote-model-provider or cloud-inference leaf page.

## Existing Pages To Link

- docs/wiki/technical/architecture.md
- docs/wiki/modules/mlx-runtime.md
- docs/wiki/modules/shared-types-and-model-registry.md
- docs/wiki/subsystems/local-model-runtime.md

## Open Questions

- Should Gemma Code remain local-only, or should it gain a remote provider abstraction for experiments?
- Should Cohere Cloud support use the Cohere SDK, Cohere Compatibility API, or a generic OpenAI-compatible provider path?
- Should remote endpoints be allowed to receive repository code by default, or should the app require explicit consent before sending code to a cloud model?
- Should North Mini Code experiments use Cohere-hosted north-mini-code-1-0, Hugging Face dedicated endpoints with w4a16, or a GPU VM first?

## Privacy And Sensitivity Notes

Running experiments online changes the privacy model. The current app states that inference and file operations run locally. Any remote provider support must avoid sending source code, PII, or company confidential information unless the user explicitly opts in.

## Ingest Rationale

This query records a remote-model decision boundary for Gemma Code. It affects architecture, provider abstraction, privacy posture, model registry metadata, and future support for North Mini Code experiments.
