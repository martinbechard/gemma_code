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
  // When the tool ran inside a plan step, this is the id of the step node
  // (matches PlanNode.id). The renderer groups calls under their step.
  parentStepId?: string;
}

export interface SystemPromptSnapshot {
  label: string;
  content: string;
}

export type Role = "user" | "assistant" | "system" | "tool" | "harness";

export type CodeSubmode = "discuss" | "plan" | "execute" | "auto";
export type ConversationPhase = "planning" | "execution";

export interface PlanNode {
  id: string;
  kind: "plan" | "step" | "verify";
  parentId?: string;
  name?: string;
  status: "running" | "ok" | "failed";
  // For step nodes: the original prompt text from the plan.
  prompt?: string;
  // For verify nodes: the original <verify> criterion text.
  criterion?: string;
  // For verify nodes that failed: the reason the model returned.
  reason?: string;
}

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  phase?: ConversationPhase;
  harnessLabel?: string;
  toolCalls?: ToolCall[];
  systemPrompts?: SystemPromptSnapshot[];
  planNodes?: PlanNode[];
  // When the assistant emitted a top-level YAML plan on this turn, the parsed
  // steps are surfaced here so the renderer can show the proposal alongside
  // an Execute Plan button.
  proposedPlan?: ProposedStep[];
  // True once the user has approved the proposedPlan; suppresses further
  // Execute clicks and lets the renderer mark it as approved.
  planExecuted?: boolean;
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
  // When set with mode==='code', the agent operates on this directory instead
  // of the per-conversation sandbox. Distinguishes "Build" (sandbox) from
  // "Code" (user-chosen working directory) without changing AgentMode.
  workingDir?: string;
  codeSubmode?: CodeSubmode;
  // When set, the harness skips streaming a fresh assistant turn and instead
  // loads a previously-proposed plan for this conversation, building a
  // PlanExecutionState and entering the standard step/verify loop.
  executePlan?: boolean;
}

export interface ProposedStep {
  name: string;
  prompt: string;
  verify: string;
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

export type PlanNodeKind = "plan" | "step" | "verify";
export type PlanNodeStatus = "ok" | "failed";

export type StreamChunk =
  | { type: "token"; text: string }
  | { type: "system_prompt"; label: string; content: string }
  | { type: "tool_call"; call: ToolCall }
  | { type: "tool_result"; id: string; result?: string; error?: string }
  | { type: "activity"; activity: AgentActivity }
  | {
      type: "plan_node_start";
      kind: PlanNodeKind;
      id: string;
      parentId?: string;
      name?: string;
      prompt?: string;
      criterion?: string;
    }
  | {
      type: "plan_node_end";
      kind: PlanNodeKind;
      id: string;
      status: PlanNodeStatus;
      reason?: string;
    }
  // Replaces the current assistant message body. Used after a round whose
  // buffer contained a plan or verify response; the structured PlanView
  // already covers it, so the raw control text is stripped from the chat.
  | { type: "set_assistant_content"; text: string }
  | {
      type: "harness_message";
      label: string;
      content: string;
      phase?: ConversationPhase;
    }
  // The model proposed a top-level plan. The harness has saved the YAML to
  // disk and is waiting for the user to approve execution; the renderer
  // shows the proposal and an Execute Plan affordance that fires
  // window.api.executePlan(conversationId).
  | { type: "plan_proposed"; steps: ProposedStep[] }
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
