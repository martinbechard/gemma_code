import { describe, expect, it } from "vitest";
import {
  patchMlxGemma4TextSource,
  patchMlxServerSource,
} from "../../src/main/mlx";

const BROKEN_SERVER_SOURCE = `
class ResponseGenerator:
    def __init__(self, model_provider: ModelProvider, prompt_cache: LRUPromptCache):
        self.model_provider = model_provider
        self.prompt_cache = prompt_cache
        self.requests = Queue()
        self._state_machine_cache = {}

        self._time_budget = TimeBudget()
        self._is_distributed = mx.distributed.init().size() > 1
        self._rank = mx.distributed.init().rank()
        self._stop = False
        self._generation_thread = Thread(target=self._generate)
        self._generation_thread.start()

    def _generate(self):
        # Load the default model if it is given
        self.model_provider.load_default()

        current_model = None

    def generate(
        self,
        request: CompletionRequest,
        generation_args: GenerationArguments,
        progress_callback: Optional[Callable[[int, int], None]] = None,
    ):
        response_queue = Queue()
        self.requests.put((response_queue, request, generation_args))

        ctx = response_queue.get()
        if isinstance(ctx, Exception):
            raise ctx

        return ctx, _process_control_tokens(ctx, _inner())
`;

const OPTIMIZED_GEMMA4_TEXT_SOURCE = `
class Attention(nn.Module):
    def __init__(self, config: ModelArgs, layer_idx: int):
        self.has_kv = layer_idx < config.num_hidden_layers - config.num_kv_shared_layers

class Model(nn.Module):
    def sanitize(self, weights):
        sanitized = {}
        for k, v in weights.items():
            if any(
                s in k
                for s in (
                    "self_attn.rotary_emb",
                    "input_max",
                    "input_min",
                    "output_max",
                    "output_min",
                )
            ):
                continue

            sanitized[k] = v

        return sanitized
`;

describe("patchMlxServerSource", () => {
  it("turns eager default model load failures into request errors", () => {
    const patched = patchMlxServerSource(BROKEN_SERVER_SOURCE);

    expect(patched).not.toBeNull();
    expect(patched).toContain("self._default_model_load_error = None");
    expect(patched).toContain("self.model_provider.load_default()");
    expect(patched).toContain("logging.exception(\"Failed to load default model\")");
    expect(patched).toContain("rqueue.put(e)");
    expect(patched).toContain("if self._default_model_load_error is not None:");
    expect(patched).toContain("raise self._default_model_load_error");
  });

  it("leaves already patched server source unchanged", () => {
    const patched = patchMlxServerSource(BROKEN_SERVER_SOURCE);
    expect(patched).not.toBeNull();

    const repeated = patchMlxServerSource(patched ?? "");

    expect(repeated).toBeNull();
  });
});

describe("patchMlxGemma4TextSource", () => {
  it("adds shared-KV dead weight sanitization to the optimized model shape", () => {
    const patched = patchMlxGemma4TextSource(OPTIMIZED_GEMMA4_TEXT_SOURCE);

    expect(patched).not.toBeNull();
    expect(patched).toContain("first_kv_shared_layer =");
    expect(patched).toContain("drop_shared_kv_weight =");
    expect(patched).toContain("if is_dead_shared_kv_weight(k):");
    expect(patched).toContain("self.has_kv = layer_idx <");
  });

  it("leaves already patched Gemma 4 text source unchanged", () => {
    const patched = patchMlxGemma4TextSource(OPTIMIZED_GEMMA4_TEXT_SOURCE);
    expect(patched).not.toBeNull();

    const repeated = patchMlxGemma4TextSource(patched ?? "");

    expect(repeated).toBeNull();
  });
});
