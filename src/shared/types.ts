export type SetupStage =
  | "checking"
  | "installing-mlx"
  | "validating-model"
  | "starting-mlx"
  | "downloading-model"
  | "repairing-model"
  | "warming-model"
  | "ready"
  | "inference-ready"
  | "error";

export interface RepairableSetupError {
  model: string;
  reason?: string;
}

export interface SetupStatus {
  stage: SetupStage;
  message: string;
  progress?: number;
  bytesDone?: number;
  bytesTotal?: number;
  error?: string;
  command?: string;
  logFile?: string;
  repair?: RepairableSetupError;
}

export interface RuntimeActivity {
  kind: "runtime";
  label: string;
  detail?: string;
  elapsedSeconds?: number;
  model?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result?: string;
  error?: string;
  running?: boolean;
}

export type Role = "user" | "assistant" | "system" | "tool";

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  toolCalls?: ToolCall[];
  createdAt: number;
  model?: string;
  done?: boolean;
  activity?: AgentActivity;
}

export type AgentMode = "chat" | "code";

export interface ChatRequest {
  conversationId: string;
  messages: Array<{ role: Role; content: string; toolCalls?: ToolCall[] }>;
  model: string;
  enableTools: boolean;
  mode: AgentMode;
}

export interface WorkspaceInfo {
  conversationId: string;
  path: string;
  previewUrl: string;
}

export interface WorkspaceFile {
  path: string;
  kind: "file" | "dir";
  size?: number;
}

export interface FileChangeEvent {
  conversationId: string;
}

export type AgentActivity =
  | { kind: "idle" }
  | { kind: "thinking"; chars?: number }
  | { kind: "generating"; chars?: number }
  | { kind: "tool"; tool: string; target?: string; chars?: number }
  | RuntimeActivity;

export type StreamChunk =
  | { type: "token"; text: string }
  | { type: "tool_call"; call: ToolCall }
  | { type: "tool_result"; id: string; result?: string; error?: string }
  | { type: "activity"; activity: AgentActivity }
  | { type: "done" }
  | { type: "error"; error: string };

export interface ModelInfo {
  /** HuggingFace repo ID — used internally for mlx_lm */
  name: string;
  /** Short, user-friendly display name */
  label: string;
  size: string;
  sizeBytes: number;
  description: string;
  recommended?: boolean;
}

const MLX_GEMMA_4_E2B_REPO = "mlx-community/gemma-4-e2b-it-4bit";
const GEMMA_4_E2B_BYTES = 1_500_000_000;
const MLX_GEMMA_3_TEXT_4B_REPO = "mlx-community/gemma-3-text-4b-it-4bit";
const GEMMA_3_TEXT_4B_BYTES = 3_200_000_000;

// Gemma 4 E2B works once the bundled mlx-lm patch is applied (see
// resources/mlx-patches/) and the server is launched with
// enable_thinking=false (see startServer in main/mlx.ts).
export const AVAILABLE_MODELS: ModelInfo[] = [
  {
    name: MLX_GEMMA_4_E2B_REPO,
    label: "Gemma 4 E2B",
    size: "1.5 GB",
    sizeBytes: GEMMA_4_E2B_BYTES,
    description: "Edge-sized. Fast & lightweight. Runs on 8GB+ Macs.",
    recommended: true,
  },
  {
    name: MLX_GEMMA_3_TEXT_4B_REPO,
    label: "Gemma 3 Text 4B",
    size: "3.2 GB",
    sizeBytes: GEMMA_3_TEXT_4B_BYTES,
    description: "Text-only fallback. Use if Gemma 4 doesn't load.",
  },
];

export const DEFAULT_MODEL = MLX_GEMMA_4_E2B_REPO;
