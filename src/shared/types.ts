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

export interface ThinkingTimelineItem {
  kind: "thinking";
  id: string;
  content: string;
}

export interface ToolCallTimelineItem {
  kind: "tool_call";
  toolCallId: string;
}

export type MessageTimelineItem = ThinkingTimelineItem | ToolCallTimelineItem;

export type Role = "user" | "assistant" | "system" | "tool" | "harness";

export type CodeSubmode = "discuss" | "plan" | "execute" | "auto" | "freestyle";
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
  thinking?: string;
  thinkingInProgress?: boolean;
  timeline?: MessageTimelineItem[];
  phase?: ConversationPhase;
  harnessLabel?: string;
  toolCalls?: ToolCall[];
  systemPrompts?: SystemPromptSnapshot[];
  planNodes?: PlanNode[];
  // When the assistant emitted a top-level YAML plan on this turn, the parsed
  // steps are surfaced here so the renderer can show the proposal alongside
  // an Execute Plan button.
  proposedPlan?: ProposedStep[];
  // Structured semantic review result for the proposed plan.
  planReview?: PlanReview;
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
  executePlanSteps?: ProposedStep[];
  // When true, the main process appends raw harness execution events to the
  // local debug execution log for later reconstruction.
  debugLogging?: boolean;
  // When true, request Gemma thinking tokens from MLX-LM and render them in
  // the assistant thinking block instead of discarding delta.reasoning chunks.
  enableThinking?: boolean;
  generatePlanInOneStepWhenThinking?: boolean;
}

export interface ExecutionLogEntry {
  line: number;
  timestamp: string;
  conversationId?: string;
  mode?: string;
  model?: string;
  event: string;
  data: unknown;
  raw?: string;
}

export interface ExecutionLogSnapshot {
  path: string;
  entries: ExecutionLogEntry[];
  totalLines: number;
  truncated: boolean;
}

export interface ProposedStep {
  name: string;
  prompt: string;
  verify: string;
}

export type PlanReviewVerdict = "pass" | "needs_correction";

export interface PlanReviewChecklistItem {
  id: string;
  question: string;
  allowedAnswers: string[];
  answer: string;
  additionalInfo: string;
}

export interface PlanReview {
  verdict: PlanReviewVerdict;
  summary: string;
  checklist: PlanReviewChecklistItem[];
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
  | { type: "reasoning"; text: string }
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
  | { type: "plan_reviewed"; review: PlanReview }
  | { type: "done" }
  | { type: "error"; error: string };

export type ModelRuntime =
  | "mlx-lm"
  | "mlx-vlm"
  | "remote";

export interface OpenAiCompatibleEndpointInfo {
  kind: "openai-compatible";
  baseUrl: string;
  apiKeyEnv: string;
  chatCompletionsPath?: string;
  model?: string;
}

export interface GeminiGenerateContentEndpointInfo {
  kind: "gemini-generate-content";
  baseUrl: string;
  apiKeyEnv: string;
  model?: string;
}

export type ModelEndpointInfo =
  | OpenAiCompatibleEndpointInfo
  | GeminiGenerateContentEndpointInfo;

export interface ModelInfo {
  /** Model ID used internally by the selected runtime. */
  name: string;
  /** Short, user-friendly display name */
  label: string;
  size: string;
  sizeBytes: number;
  description: string;
  runtime: ModelRuntime;
  endpoint?: ModelEndpointInfo;
  recommended?: boolean;
}

export interface ModelListResult {
  models: ModelInfo[];
  defaultModel: string;
}

export interface ModelProvenance {
  model: string;
  revision: string | null;
  upstreamLastModified: string | null;
  localCachedAt: string | null;
  weightsBytes: number | null;
}

export type LocalModelDownloadState =
  | "missing"
  | "queued"
  | "downloading"
  | "incomplete"
  | "downloaded"
  | "failed";

export interface LocalModelDownloadStatus {
  model: string;
  state: LocalModelDownloadState;
  message: string;
  updatedAt: number;
  progress?: number;
  bytesDone?: number;
  bytesTotal?: number;
  error?: string;
}

const MODEL_PROVENANCE_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

export function formatModelProvenanceSummary(
  provenance: ModelProvenance | null | undefined,
): string {
  if (!provenance) return "";
  const revision = provenance.revision?.slice(0, 7) ?? "";
  const updated = formatModelProvenanceDate(
    "updated",
    provenance.upstreamLastModified,
  );
  const cached = formatModelProvenanceDate("cached", provenance.localCachedAt);
  const label = updated || cached;
  return [label, revision].filter((part) => part.length > 0).join(" · ");
}

function formatModelProvenanceDate(prefix: string, value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${prefix} ${MODEL_PROVENANCE_DATE_FORMATTER.format(date)}`;
}

export function isLocalMlxRuntime(runtime: ModelRuntime): boolean {
  return runtime === "mlx-lm" || runtime === "mlx-vlm";
}
