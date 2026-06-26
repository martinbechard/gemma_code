# Query Fragment: North Mini Code Online Deployment Options

## Query Asked

The user asked whether North Mini Code experiments could run through Hugging Face Endpoints, Cohere Cloud, or an online virtual server for AI models.

## Answer Summary

There are three practical online paths. Cohere Cloud is the fastest path for quality experiments because Cohere documents North Mini Code with model ID north-mini-code-1-0, Chat V2, Chat V1, and Chat Completions support, and free use until rate limits are reached for trial and production keys. Hugging Face Inference Endpoints are plausible for hosted deployment, but the MLX Apple Silicon artifact is not the right target for standard cloud GPUs; the CohereLabs/North-Mini-Code-1.0-w4a16 checkpoint is documented for vLLM and SGLang and is not deployed by any Hugging Face Inference Provider at the time checked. General GPU VMs or serverless GPU platforms are viable for custom experiments with vLLM, SGLang, or llama.cpp, especially when debugging runtime behavior or OpenAI-compatible serving.

As of June 26, 2026, Cohere only lists North Mini Code under the North coding-model family. A smaller-versus-bigger Cohere comparison should therefore compare North Mini Code against Command A or Command A+, or compare hosted North Mini Code against self-hosted North Mini Code variants. North Mini Code is free until rate limits are reached. Command A is priced at 2.50 USD per 1M input tokens and 10.00 USD per 1M output tokens. Command A+ is also documented as free until rate limits are reached and available for production through Model Vault.

API keys are required for every online path. Cohere requires a Cohere API key; trial keys are created automatically on account signup, are free, and are rate limited. Cohere lists North Mini Code at 20 requests per minute for trial keys and 500 requests per minute for production keys, while also noting that trial keys and production keys on newer Chat model variants are limited to 1,000 API calls per month. Hugging Face Inference Endpoints require a Hugging Face account with active subscription and credit card, plus an endpoint token. GPU VM providers require a provider account, usually SSH credentials or a provider API token, and often a Hugging Face token for pulling model artifacts.

Approximate hourly infrastructure costs for self-hosting are dominated by GPU runtime. Hugging Face Inference Endpoints bill per minute while endpoints are initializing or running. Relevant listed rates include AWS L40S 48GB at 1.80 USD per hour, AWS A100 80GB at 2.50 USD per hour, AWS H200 141GB at 5.00 USD per hour, and GCP H100 80GB at 10.00 USD per hour. Lambda lists 1x A6000 48GB at 1.09 USD per hour, 1x A100 40GB at 1.99 USD per hour, 1x H100 PCIe 80GB at 3.29 USD per hour, and 1x H100 SXM 80GB at 4.29 USD per hour. Modal bills by second, with L40S around 1.95 USD per hour, A100 80GB around 2.50 USD per hour, and H100 around 3.95 USD per hour based on its per-second pricing.

## Wiki Pages Consulted

- docs/wiki/technical/architecture.md
- docs/wiki/modules/mlx-runtime.md
- docs/wiki/modules/shared-types-and-model-registry.md
- docs/wiki/subsystems/local-model-runtime.md

## Authoritative Sources Consulted

- src/main/mlx.ts
- src/shared/types.ts
- https://docs.cohere.com/docs/north-mini-code-1.0
- https://docs.cohere.com/docs/command-a
- https://docs.cohere.com/docs/command-a-plus
- https://docs.cohere.com/docs/compatibility-api
- https://docs.cohere.com/docs/model-vault
- https://docs.cohere.com/docs/rate-limits
- https://cohere.com/pricing
- https://huggingface.co/CohereLabs/North-Mini-Code-1.0-w4a16
- https://huggingface.co/docs/inference-endpoints/en/pricing
- https://huggingface.co/docs/inference-endpoints/en/engines/custom_container
- https://docs.vllm.ai/en/stable/deployment/frameworks/hf_inference_endpoints/
- https://lambda.ai/pricing
- https://modal.com/docs/guide/gpu
- https://modal.com/pricing

## Durable Concepts Detected

- Gemma Code is local-first and now routes model traffic through configured model metadata. Local models use MLX, while remote models use configured endpoint information.
- Local MLX models should be hidden from the offered model list when the host cannot support MLX. Supported Apple Silicon hosts can still show local models before MLX is installed because setup can install MLX.
- Cohere Cloud is the preferred zero-infrastructure experiment path for model behavior and prompt/tool-call quality.
- Cohere Cloud requires a Cohere API key. Trial keys are free and rate limited. North Mini Code is listed at 20 requests per minute for trial keys and 500 requests per minute for production keys, with a separate note that trial keys and production keys on newer Chat model variants are limited to 1,000 API calls per month.
- North Mini Code has no per-token price listed by Cohere as of the check date; Cohere says it is free until rate limits are reached.
- Command A is a documented larger Cohere comparison option with token pricing. Command A+ is a larger model available free until rate limits and through Model Vault.
- Hugging Face Inference Endpoints are a managed deployment path when the experiment needs a dedicated endpoint, but North Mini Code likely needs the vLLM-oriented w4a16 checkpoint or a custom container, not the MLX artifact.
- GPU VMs and serverless GPU platforms are the highest-control path for serving experiments, especially when testing vLLM, SGLang, llama.cpp, context limits, and interleaved reasoning handling.
- Hardware class should be chosen from context length needs: short-context experiments may fit lower-cost 48GB GPUs, while long-context or production-like runs should target A100 80GB, H100, H200, or equivalent.
- Gemma 4 31B can be called remotely through the Gemini API using model ID gemma-4-31b-it and the native streamGenerateContent endpoint.

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
- README.md

## Resolved Decisions

- Gemma Code supports configured remote endpoints for experiments while retaining local MLX as the default local runtime path.
- North Mini Code uses Cohere OpenAI-compatible chat completions through configured endpoint metadata.
- Gemma 4 31B uses Gemini native generateContent streaming through configured endpoint metadata.

## Open Questions

- Should remote endpoints be allowed to receive repository code by default, or should the app require explicit consent before sending code to a cloud model?
- Should the first comparison be North Mini Code versus Command A, North Mini Code versus Command A+, or hosted North Mini Code versus self-hosted North Mini Code?
- Should self-hosted North Mini Code experiments use Cohere-hosted north-mini-code-1-0, Hugging Face dedicated endpoints with w4a16, or a GPU VM first?

## Privacy And Sensitivity Notes

Running experiments online changes the privacy model. Local model inference and file operations run locally by default, but a selected remote model sends prompt and tool context to the configured provider. Remote provider support must avoid sending source code, PII, or company confidential information unless the user explicitly opts in.

## Ingest Rationale

This query records a remote-model decision boundary for Gemma Code. It affects architecture, provider abstraction, privacy posture, configured model metadata, and future support for North Mini Code experiments.
