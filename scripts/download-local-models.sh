#!/usr/bin/env bash
set -euo pipefail

readonly MODEL_GEMMA_3_TEXT_12B="mlx-community/gemma-3-text-12b-it-4bit"
readonly MODEL_GEMMA_3_12B_6BIT="mlx-community/gemma-3-12b-it-6bit"
readonly MODEL_ORNITH_9B="mlx-community/Ornith-1.0-9B-4bit"

readonly LOCAL_MODELS=(
  "${MODEL_GEMMA_3_TEXT_12B}"
  "${MODEL_GEMMA_3_12B_6BIT}"
  "${MODEL_ORNITH_9B}"
)

for model in "${LOCAL_MODELS[@]}"; do
  printf '\n==> Downloading %s\n' "${model}"
  pnpm run cli -- download-model --model "${model}"
done
