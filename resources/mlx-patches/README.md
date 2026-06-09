# mlx-lm hot-patches

The app applies small source patches to the managed mlx-lm virtual environment
after installation and on startup. Patches are content-detected and become
no-ops when the installed mlx-lm source no longer matches the targeted issue.

## Server load errors

The mlx-lm HTTP server starts successfully before the default model is loaded.
For eager default-model failures, the upstream generation thread can terminate
without writing an error to the request queue. That leaves completion requests
waiting until the client times out.

The app patches the server so a default-model load exception is stored, logged,
sent to any queued requests, and raised immediately for later completion
requests. Warmup and normal chat calls therefore receive a real HTTP error.

## Gemma 4 shared-KV sanitizer

mlx-lm 0.31.3 uses the optimized Gemma 4 text model shape for shared-KV layers:
those layers do not allocate unused key and value projection modules. QAT
checkpoints match that optimized shape. Older 4-bit Gemma 4 checkpoints can
still contain dead shared-KV tensors for those unused modules.

The app keeps the optimized model shape and patches the Gemma 4 text sanitizer
to drop dead shared-KV attention weights before strict loading. This allows both
checkpoint styles to load through one mlx-lm runtime:

- older checkpoints with extra unused shared-KV tensors
- QAT checkpoints that omit those tensors

The patch removes keys under shared-KV layers for these attention components:

```text
self_attn.k_proj
self_attn.v_proj
self_attn.k_norm
self_attn.v_norm
```

This is intentionally not a full-file overlay. The optimized upstream model
implementation remains in place, and only the weight sanitation step changes.

## Existing installs

Earlier builds overlaid an older Gemma 4 text model file. When a backup of the
upstream file exists, startup restores from that backup before applying the
sanitizer patch. Fresh installs patch the installed mlx-lm source directly.
