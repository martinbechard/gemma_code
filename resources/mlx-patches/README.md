# mlx-lm hot-patches

Files in this directory are overlaid onto the installed `mlx-lm` package after
`pip install` and on every app startup, by `applyMlxPatches()` in
`src/main/mlx.ts`. Each overlay is content-detected — if the installed file no
longer matches the broken pattern the patch targets, the overlay is skipped, so
patches automatically deactivate once upstream ships a real fix.

## `gemma4_text.py`

Verbatim copy of `mlx_lm/models/gemma4_text.py` from **mlx-lm 0.31.2** (released
2026-04-07). Overlaid on top of the installed file when it is the **0.31.3**
version (released 2026-04-22).

### Why the overlay is needed

In 0.31.3, the `Attention` module in `gemma4_text.py` was changed to skip
allocating `k_proj`, `v_proj`, `k_norm`, and `v_norm` modules on KV-shared
layers (layers `>= num_hidden_layers - num_kv_shared_layers`):

```python
self.has_kv = layer_idx < config.num_hidden_layers - config.num_kv_shared_layers
...
if self.has_kv:
    self.k_proj = nn.Linear(...)
    if not self.use_k_eq_v:
        self.v_proj = nn.Linear(...)
...
if self.has_kv:
    self.k_norm = nn.RMSNorm(...)
    self.v_norm = RMSNormNoScale(...)
```

That was a memory optimization — those projections are never invoked on shared
layers, since keys/values are reused from earlier layers. But existing
`mlx-community` Gemma 4 4-bit checkpoints (e.g. `mlx-community/gemma-4-e2b-it-4bit`)
were quantized **before** the optimization landed, so their safetensors files
still contain `k_proj` / `v_proj` / `k_norm` / `v_norm` weights for those
layers.

With 0.31.3's strict weight loading, those weights have nowhere to go and the
server crashes on the first inference request:

```
ValueError: Received 140 parameters not in model:
language_model.model.layers.15.self_attn.k_norm.weight,
language_model.model.layers.15.self_attn.k_proj.biases,
...
```

(140 = 20 KV-shared layers × 7 unused tensors.)

The 0.31.2 overlay restores the unconditional module allocation so the
checkpoint loads cleanly. The runtime behavior is identical because the
allocated-but-unused modules are never invoked when `shared_kv` is provided.

We keep 0.31.3 as the published version because **0.31.3 also ships a separate,
required threading fix** in `mlx_lm/generate.py` (`mx.new_thread_local_stream`
instead of `mx.new_stream`). Without that fix, the server's `BatchGenerator`
fails with `RuntimeError: There is no Stream(gpu, 0) in current thread` on the
first generation. So neither published version works alone for Gemma 4 — the
hybrid does.

### Detection marker

`applyMlxPatches()` looks for the substring `self.has_kv = layer_idx <` in the
installed file. That line exists only in 0.31.3 (and any future version that
keeps the optimization). When upstream restores the modules or adds a
`sanitize()` that drops the unused weights, the marker disappears and the
overlay becomes a no-op.

### Backup

Before overwriting, the original file is copied to
`<venv>/lib/pythonX.Y/site-packages/mlx_lm/models/gemma4_text.py.bak.upstream`
so the original is recoverable. The backup is created once and never
overwritten on subsequent runs.

## Eventual upstream PR

The proper upstream fix is **not** to revert the optimization (the 0.31.3
behavior is correct). Instead, `mlx_lm/models/gemma4.py` should grow a
`sanitize()` that **drops** weights for `k_proj` / `v_proj` / `k_norm` / `v_norm`
on KV-shared layers, before they reach `model.load_weights()`. Sketch:

```python
# in mlx_lm/models/gemma4.py, inside Model.sanitize() (after the existing logic):
text_args = ModelArgs.from_dict(self.args.text_config or {})
n_layers = text_args.num_hidden_layers
first_shared = n_layers - text_args.num_kv_shared_layers
shared_kv_dead = ("self_attn.k_proj", "self_attn.v_proj",
                  "self_attn.k_norm", "self_attn.v_norm")
filtered = {}
for k, v in new_weights.items():
    # Match "language_model.model.layers.<idx>.self_attn.{k,v}_{proj,norm}.*"
    parts = k.split(".")
    if (len(parts) >= 5
        and parts[-5:-3] == ["model", "layers"]
        and parts[-2:][0].startswith("self_attn.")):
        try:
            idx = int(parts[-4])
        except ValueError:
            idx = -1
        if idx >= first_shared > 0 and any(s in k for s in shared_kv_dead):
            continue
    filtered[k] = v
return filtered
```

(Exact path matching depends on whether the key has been stripped of its
`model.` prefix yet — the real PR should walk the same path the existing
`sanitize()` produces.)

This way, both old and new checkpoints load cleanly into 0.31.3+ without
allocating the dead modules.

### Tracking

- mlx-lm repo: <https://github.com/ml-explore/mlx-lm>
- Affected versions: 0.31.3 (and any later release that ships the same
  optimization without a sanitize companion)
- Affected models: `mlx-community/gemma-4-e2b-it-4bit`,
  `mlx-community/gemma-4-e4b-it-4bit`, and any other 4-bit Gemma 4 checkpoint
  quantized before 2026-04-22.
- Once a release ships the sanitize fix, delete this directory and remove the
  call to `applyMlxPatches()` from `src/main/mlx.ts`. The marker check makes
  the overlay safe to leave in place until then.
