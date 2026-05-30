import {
  app,
  shell,
  BrowserWindow,
  ipcMain,
  nativeTheme,
  session,
  nativeImage,
  dialog,
} from "electron";
import { join } from "path";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";
import { AVAILABLE_MODELS } from "@shared/types";
import {
  locateMLX,
  installMLX,
  startServer,
  stopServer,
  chatStream,
  listLocalModels,
  inspectModelCache,
  isModelCacheReadyForInference,
  warmupInference,
  linkGlobalCacheModel,
  getMlxServerLogPath,
  getLastMlxServerCommand,
  MLX_SERVER_PORT,
  type MLXChatMessage,
} from "./mlx";
import {
  TOOLS,
  chatSystemPrompt,
  codeSystemPrompt,
  findNextAction,
  emitSafeBoundary,
  runTool,
  cleanFileContent,
  isToolErrorResult,
  type ToolContext,
} from "./tools";
import { saveLastPrompt } from "./debugPrompt";
import {
  ensureWorkspace,
  startWorkspaceServer,
  stopWorkspaceServer,
  getWorkspaceServerPort,
  previewUrl,
  listTree,
  workspaceDir,
  setWorkspaceOverride,
  clearWorkspaceOverride,
} from "./workspace";
import type {
  ChatRequest,
  CodeSubmode,
  StreamChunk,
  ToolCall,
} from "../shared/types";
import { setRuntimePaths } from "./runtimePaths";
import {
  findNextPlan,
  parsedPlanFromSteps,
  parseVerifyResult,
  type ParsedPlan,
} from "./plan/parser";
import { replayRequestMessages } from "./chatHistory";
import { PlanExecutionState } from "./plan/executionState";
import { stripPlanArtifacts } from "./plan/stripPlanArtifacts";
import { loadPlan, savePlan } from "./plan/planStore";
import {
  EXECUTABLE_PLAN_VALIDATION_GUIDANCE_LINES,
  validatePlanForExecution,
} from "./plan/validation";
import {
  applyPlanAssemblyResponse,
  applyPlanSemanticReviewResponse,
  buildPlanAssemblyInitialPrompt,
  buildPlanSemanticReviewMessages,
  createPlanAssemblyState,
  isPlanAssemblyDoneResponse,
  type PlanAssemblyState,
} from "./plan/assembly";
import {
  buildIncompleteStepPrompt,
  buildStepSummaryCorrectionPrompt,
  createPlanStepEvidence,
  forcedVerifyFailureReason,
  hasGuardedAlreadyPresentEvidence,
  hasSatisfiedReadOnlyStepEvidence,
  hasSuccessfulRequiredCommandEvidence,
  isContradictedBySuccessfulEvidence,
  isMalformedActionSelfReport,
  isRecoverableEditFailureResult,
  parseBlockedReason,
  parseStepSummary,
  recordPlanToolEvidence,
  repeatedActionForcedFailureReason,
  summarizePlanStepEvidence,
} from "./plan/evidence";
import { killAllBackgroundTasks } from "./backgroundTasks";
import {
  createExecutionLogger,
  ensureExecutionLogFile,
  executionLogPath,
  readExecutionLogSnapshot,
} from "./executionLog";

const COMMAND_TARGET_MAX_CHARS = 80;
const RUNTIME_ACTIVITY_THROTTLE_MS = 400;
const LIVE_WRITE_PREVIEW_THROTTLE_MS = 450;
const MODEL_DOWNLOAD_PROGRESS_POLL_MS = 1000;
const MODEL_DOWNLOAD_COMPLETE_PROGRESS = 1;
const MODEL_DOWNLOAD_MAX_WAIT_MS = 60 * 60 * 1000;

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 820,
    minHeight: 560,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#0e0e0e",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 14, y: 14 },
    vibrancy: "under-window",
    visualEffectState: "active",
    icon: join(__dirname, "../../build/icon.png"),
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.on("ready-to-show", () => {
    mainWindow?.show();
    if (is.dev) {
      mainWindow?.webContents.openDevTools({ mode: "detach" });
    }
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: "deny" };
  });

  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

function send(channel: string, payload: unknown): void {
  mainWindow?.webContents.send(channel, payload);
}

function modelLabel(model: string): string {
  return AVAILABLE_MODELS.find((m) => m.name === model)?.label ?? model;
}

class ModelCacheRepairRequiredError extends Error {
  model: string;
  reason: string;

  constructor(model: string, reason: string) {
    super(reason);
    this.name = "ModelCacheRepairRequiredError";
    this.model = model;
    this.reason = reason;
  }
}

function cacheRepairReason(model: string): string | null {
  const inspection = inspectModelCache(model);
  return cacheRepairReasonFromInspection(inspection);
}

function cacheRepairReasonFromInspection(
  inspection: ReturnType<typeof inspectModelCache>,
): string | null {
  if (inspection.status === "complete" || inspection.status === "missing")
    return null;
  if (isModelCacheReadyForInference(inspection)) return null;
  if (inspection.status === "incomplete") {
    return `Found ${inspection.incompleteBlobPaths.length} incomplete model file${inspection.incompleteBlobPaths.length === 1 ? "" : "s"}.`;
  }
  if (inspection.status === "missing-weights") {
    return "Model weight files are missing or smaller than the model index expects.";
  }
  return "Model files are not usable.";
}

function sendRepairableModelError(model: string, reason: string): void {
  send("setup:status", {
    stage: "error",
    message: "Model download is incomplete",
    error: `${modelLabel(model)} is not ready for inference. Repair the model cache to download it again.`,
    repair: { model, reason },
  });
}

interface ModelDownloadProgressStatus {
  progress?: number;
  bytesDone?: number;
  bytesTotal?: number;
}

interface EnsureMLXOptions {
  allowIncompleteCache: boolean;
}

function modelDownloadProgressStatus(
  model: string,
): ModelDownloadProgressStatus {
  const inspection = inspectModelCache(model);
  const bytesTotal = inspection.metadataTotalSizeBytes;
  if (bytesTotal == null || bytesTotal <= 0) return {};
  const bytesDone = Math.min(inspection.modelWeightsBytes, bytesTotal);
  return {
    bytesDone,
    bytesTotal,
    progress: Math.min(
      bytesDone / bytesTotal,
      MODEL_DOWNLOAD_COMPLETE_PROGRESS,
    ),
  };
}

function sendModelDownloadStatus(
  model: string,
  message: string,
  fallbackProgress?: number,
): void {
  const byteProgress = modelDownloadProgressStatus(model);
  send("setup:status", {
    stage: "downloading-model",
    message,
    progress: byteProgress.progress ?? fallbackProgress,
    bytesDone: byteProgress.bytesDone,
    bytesTotal: byteProgress.bytesTotal,
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForModelCacheReady(
  model: string,
  cacheSourceMessage: string,
): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < MODEL_DOWNLOAD_MAX_WAIT_MS) {
    const inspection = inspectModelCache(model);
    if (isModelCacheReadyForInference(inspection)) return;

    sendModelDownloadStatus(model, cacheSourceMessage);
    await delay(MODEL_DOWNLOAD_PROGRESS_POLL_MS);
  }

  throw new ModelCacheRepairRequiredError(
    model,
    `Model download did not finish within ${Math.floor(MODEL_DOWNLOAD_MAX_WAIT_MS / 60000)} minutes.`,
  );
}

async function ensureMLXPython(): Promise<string> {
  let mlx = locateMLX();
  if (!mlx) {
    throw new Error(
      "Python 3.10–3.13 not found. Install via Homebrew: brew install python@3.13",
    );
  }

  let pythonToUse = mlx.python;

  if (!mlx.installed) {
    send("setup:status", {
      stage: "installing-mlx",
      message: "Installing MLX runtime…",
    });
    // installMLX creates the venv and returns the venv python path
    pythonToUse = await installMLX((p) => {
      send("setup:status", {
        stage: "installing-mlx",
        message: p.message,
      });
    });
  }

  return pythonToUse;
}

async function ensureMLXRunning(
  model: string,
  options: EnsureMLXOptions = { allowIncompleteCache: false },
): Promise<string> {
  const pythonToUse = await ensureMLXPython();
  const label = modelLabel(model);
  const linkedFromGlobalCache = linkGlobalCacheModel(model);

  if (!linkedFromGlobalCache) {
    console.log(
      `[mlx] No global cache hit for ${model}; download path remains local`,
    );
  } else {
    console.log(`[mlx] Reused global cache entry for ${model}`);
  }

  send("setup:status", {
    stage: "validating-model",
    message: `Checking ${label} files…`,
  });
  const preStartInspection = inspectModelCache(model);
  const preStartRepairReason =
    cacheRepairReasonFromInspection(preStartInspection);
  if (preStartRepairReason && !options.allowIncompleteCache) {
    throw new ModelCacheRepairRequiredError(model, preStartRepairReason);
  }

  send("setup:status", {
    stage: "starting-mlx",
    message: "Starting model runtime…",
  });
  const cacheReadyForStartup =
    isModelCacheReadyForInference(preStartInspection);
  const cacheSourceMessage = cacheReadyForStartup
    ? `Loading ${label} from cached weights…`
    : linkedFromGlobalCache
      ? `Loading ${label} from downloaded weights…`
      : `Downloading ${label}…`;
  sendModelDownloadStatus(model, cacheSourceMessage);
  let downloadPoll: ReturnType<typeof setInterval> | undefined = setInterval(
    () => {
      sendModelDownloadStatus(model, cacheSourceMessage);
    },
    MODEL_DOWNLOAD_PROGRESS_POLL_MS,
  );
  try {
    await startServer(pythonToUse, model, (p) => {
      sendModelDownloadStatus(model, p.message, p.progress);
    });
  } finally {
    if (downloadPoll) {
      clearInterval(downloadPoll);
      downloadPoll = undefined;
    }
  }

  await waitForModelCacheReady(model, cacheSourceMessage);

  send("setup:status", {
    stage: "validating-model",
    message: `Checking ${label} files…`,
  });
  const postStartRepairReason = cacheRepairReason(model);
  if (postStartRepairReason) {
    throw new ModelCacheRepairRequiredError(model, postStartRepairReason);
  }

  send("setup:status", {
    stage: "warming-model",
    message: `Testing ${label} inference…`,
  });
  await warmupInference(model);
  send("setup:status", {
    stage: "inference-ready",
    message: `${label} responded to a warmup request.`,
  });
  return pythonToUse;
}

async function handleSetup(model: string): Promise<void> {
  try {
    send("setup:status", { stage: "checking", message: "Checking system…" });
    await ensureMLXRunning(model);
    send("setup:status", { stage: "ready", message: "Ready to chat." });
  } catch (e) {
    if (e instanceof ModelCacheRepairRequiredError) {
      sendRepairableModelError(e.model, e.reason);
      return;
    }
    send("setup:status", {
      stage: "error",
      message: "Setup failed",
      error: (e as Error).message,
      command:
        getLastMlxServerCommand() ||
        `python -m mlx_lm server --model ${model} --port ${MLX_SERVER_PORT}`,
      logFile: getMlxServerLogPath(),
    });
  }
}

async function handleRepairModel(model: string): Promise<void> {
  try {
    send("setup:status", {
      stage: "repairing-model",
      message: `Resuming ${modelLabel(model)} download…`,
    });
    await ensureMLXRunning(model, { allowIncompleteCache: true });
    send("setup:status", { stage: "ready", message: "Ready to chat." });
  } catch (e) {
    if (e instanceof ModelCacheRepairRequiredError) {
      sendRepairableModelError(e.model, e.reason);
      return;
    }
    send("setup:status", {
      stage: "error",
      message: "Model repair failed",
      error: (e as Error).message,
      command:
        getLastMlxServerCommand() ||
        `python -m mlx_lm server --model ${model} --port ${MLX_SERVER_PORT}`,
      logFile: getMlxServerLogPath(),
      repair: {
        model,
        reason: "The model cache could not be repaired automatically.",
      },
    });
  }
}

const MAX_TOOL_ROUNDS_CHAT = 6;
const MAX_TOOL_ROUNDS_CODE = 40;
const MAX_PLAN_ASSEMBLY_VALIDATION_RETRIES = 6;
const MAX_PLAN_SEMANTIC_REVIEW_RETRIES = 4;
const MAX_STEP_INCOMPLETE_REPROMPTS = 3;
const REPEATED_FAILED_EDIT_THRESHOLD = 2;
const FAILED_EDIT_PREVIEW_CHARS = 240;
const INCOMPLETE_ACTION_PREVIEW_CHARS = 240;
const MODEL_REQUEST_MESSAGE_PREVIEW_CHARS = 320;
const CODE_PLAN_NUDGE =
  "Continue in planning mode. Use an action to inspect files if you need more context, or emit exactly one YAML plan step when another executable instruction is needed. Do not write files before the assembled plan is approved.";
const PLAN_ASSEMBLY_NO_PROGRESS_PROMPT = [
  "The previous response did not answer the prompt-writing question with a YAML plan fragment.",
  "Answer in YAML only, with no explanation.",
  "Return exactly one plan.steps item with name, prompt, and verify string fields.",
].join("\n");
const BUILD_ACTION_NUDGE =
  "Good plan. Now start building - emit a write_file action with the first file immediately.";
const INCOMPLETE_ACTION_NUDGE =
  'Your previous response started an <action> tag but did not close it with </action>. Re-send exactly one complete action tag now. If no action can be taken, reply exactly with <error reason="short reason"/>. Do not emit a verify tag about the malformed response.';
const PSEUDO_TOOL_RESPONSE_RE = /<\/?tool_response\b/i;
const TOOL_RESULT_WAITING_SELF_REPORT_RE =
  /\b(?:waiting for|wait for|awaiting|results? (?:are|is) not yet available|not yet available)\b[\s\S]{0,120}\b(?:tool|result|results|output|search_files|read_file|list_files)\b/i;
const COMPLETE_STEP_RESPONSE_RE =
  /<summary\b[^>]*>[\s\S]*?<\/summary\s*>|<error\b[^>]*?(?:\/\s*>|>[\s\S]*?<\/error\s*>)/i;

interface ModelRequestMessageSummary {
  index: number;
  role: MLXChatMessage["role"];
  chars: number;
  preview: string;
}

function buildEditFailureRecoveryPrompt(path: string): string {
  return [
    "The edit_file action failed because old_string could not be applied safely.",
    "Before retrying the edit, running tests, or verifying, reread the target file and use its exact current contents.",
    "Your next response must be exactly this action tag and nothing else:",
    `<action name="read_file">`,
    `<path>${path}</path>`,
    `</action>`,
  ].join("\n");
}

function buildRepeatedEditFailureRecoveryPrompt(
  path: string,
  oldString: string,
  attemptCount: number,
): string {
  const preview =
    oldString.length > FAILED_EDIT_PREVIEW_CHARS
      ? `${oldString.slice(0, FAILED_EDIT_PREVIEW_CHARS)}...`
      : oldString;
  return [
    `The same edit_file old_string failed ${attemptCount} times for ${path}.`,
    "That exact old_string is invalid or ambiguous for this file. Do not use it again.",
    "Use the latest read_file result for this path already in the conversation.",
    "Your next response must be exactly one write_file action for this same path and nothing else.",
    "The write_file content must preserve the current file content and apply the requested change.",
    "Do not emit read_file, edit_file, run_bash, run_project_script, verify, or a plan.",
    "Do not retry this old_string:",
    preview,
  ].join("\n");
}

function buildPrematureVerifyPrompt(reason: string | null): string {
  const reasonLine = reason
    ? `The current step is not complete yet: ${reason}.`
    : "The current step is not complete yet.";
  return [
    "You emitted a verify tag while executing a step body.",
    "Only emit verify tags after I send a Verify request.",
    reasonLine,
    'Continue the current step now with the next required action tag. If you cannot proceed, reply exactly with <error reason="short reason"/>.',
  ].join("\n");
}

function buildRepeatedRecoveryReadPrompt(path: string): string {
  return [
    `You are recovering from a failed edit_file action for ${path}.`,
    "The file has already been reread and the tool result is already in the conversation.",
    "Your next response must be exactly one write_file action for this same path and nothing else.",
    "The write_file content must preserve the current file content and apply the requested change.",
    "Do not emit read_file, edit_file, run_bash, run_project_script, verify, or a plan.",
  ].join("\n");
}

function formatToolResultMessage(
  toolName: string,
  result: string,
  hadError: boolean,
): string {
  return `[${hadError ? "error" : "ok"}] ${toolName} tool result:\n${result}`;
}

function invalidToolResultSelfReportReason(response: string): string | null {
  if (PSEUDO_TOOL_RESPONSE_RE.test(response)) {
    return "assistant emitted pseudo tool output instead of using the actual tool result";
  }
  if (TOOL_RESULT_WAITING_SELF_REPORT_RE.test(response)) {
    return "assistant claimed it was waiting for a tool result that is already visible";
  }
  return null;
}

function buildToolResultSelfReportPrompt(reason: string): string {
  return [
    `The previous response was rejected: ${reason}.`,
    "The latest tool result is already visible in this conversation as a harness message beginning with [ok] or [error].",
    "Use that tool result directly for the current step.",
    "Do not emit <tool_response>, do not paste fake tool output, and do not say you are waiting for a result.",
    'If the visible tool result is unusable, reply exactly with <error reason="short reason"/>.',
  ].join("\n");
}

function compactModelRequestLogText(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (oneLine.length <= MODEL_REQUEST_MESSAGE_PREVIEW_CHARS) return oneLine;
  return `${oneLine.slice(0, MODEL_REQUEST_MESSAGE_PREVIEW_CHARS)}...`;
}

function summarizeModelRequestMessages(
  messages: MLXChatMessage[],
): ModelRequestMessageSummary[] {
  return messages.map((message, index) => ({
    index: index + 1,
    role: message.role,
    chars: message.content.length,
    preview: compactModelRequestLogText(message.content),
  }));
}

function buildFailedEditKey(
  args: Record<string, unknown>,
): { key: string; path: string; oldString: string } | null {
  if (typeof args.path !== "string") return null;
  if (typeof args.old_string !== "string") return null;
  return {
    key: `${args.path}\n${args.old_string}`,
    path: args.path,
    oldString: args.old_string,
  };
}

function actionTarget(
  _name: string,
  args: Record<string, unknown>,
): string | undefined {
  if (typeof args.path === "string") return args.path;
  if (typeof args.query === "string") return String(args.query);
  if (typeof args.url === "string") return String(args.url);
  if (typeof args.script === "string") return String(args.script);
  if (typeof args.command === "string")
    return String(args.command).slice(0, COMMAND_TARGET_MAX_CHARS);
  return undefined;
}

type CodePromptMode = "code" | "build" | "plan" | "execute";

interface ResolvedSystemPrompt {
  label: string;
  content: string;
  workspacePath?: string;
  previewHref?: string;
}

function promptModeForCodeSubmode(
  codeSubmode: CodeSubmode | undefined,
  hasWorkingDir: boolean,
  executePlan?: boolean,
): CodePromptMode {
  if (!hasWorkingDir) return "build";
  if (executePlan) return "execute";
  switch (codeSubmode ?? "auto") {
    case "discuss":
      return "code";
    case "plan":
      return "plan";
    case "execute":
      return "execute";
    case "auto":
      return "plan";
  }
}

function labelForCodePromptMode(
  codePromptMode: CodePromptMode,
  hasWorkingDir: boolean,
  executePlan?: boolean,
): string {
  if (!hasWorkingDir) return "build";
  if (executePlan) return "code execute";
  if (codePromptMode === "code") return "code discuss";
  return `code ${codePromptMode}`;
}

async function resolveSystemPrompt(
  req: ChatRequest,
): Promise<ResolvedSystemPrompt> {
  if (req.mode === "code") {
    if (req.workingDir) {
      setWorkspaceOverride(req.conversationId, req.workingDir);
    }
    const workspacePath = await ensureWorkspace(req.conversationId);
    const previewHref = previewUrl(req.conversationId);
    const codePromptMode = promptModeForCodeSubmode(
      req.codeSubmode,
      !!req.workingDir,
      req.executePlan,
    );
    return {
      label: labelForCodePromptMode(
        codePromptMode,
        !!req.workingDir,
        req.executePlan,
      ),
      content: codeSystemPrompt(workspacePath, previewHref, codePromptMode),
      workspacePath,
      previewHref,
    };
  }
  return {
    label: "chat",
    content: chatSystemPrompt(req.enableTools),
  };
}

async function handleChat(req: ChatRequest, channel: string): Promise<void> {
  const abort = new AbortController();
  chatAbortControllers.set(req.conversationId, abort);

  const logExecution = createExecutionLogger(req.debugLogging === true, {
    conversationId: req.conversationId,
    mode: req.mode,
    model: req.model,
  });
  logExecution("session_start", {
    messageCount: req.messages.length,
    enableTools: req.enableTools,
    workingDir: req.workingDir,
    codeSubmode: req.codeSubmode,
    executePlan: req.executePlan,
  });

  const emit = (chunk: StreamChunk): void => {
    logExecution("stream_chunk", chunk);
    send(channel, chunk);
  };
  const emitRuntimeActivity = (label: string, detail?: string): void => {
    emit({
      type: "activity",
      activity: {
        kind: "runtime",
        label,
        detail,
        model: req.model,
      },
    });
  };

  try {
    const baseMessages: MLXChatMessage[] = [];

    let planExecutionSystemPrompt: string | null = null;
    const emitSystemPrompt = (label: string, content: string): void => {
      logExecution("system_prompt", { label, content });
      emit({ type: "system_prompt", label, content });
    };
    const pushHarnessPrompt = (label: string, content: string): void => {
      logExecution("harness_prompt", { label, content });
      baseMessages.push({ role: "user", content });
    };

    const resolvedSystemPrompt = await resolveSystemPrompt(req);
    baseMessages.push({
      role: "system",
      content: resolvedSystemPrompt.content,
    });
    emitSystemPrompt(resolvedSystemPrompt.label, resolvedSystemPrompt.content);
    planExecutionSystemPrompt =
      req.mode === "code" &&
      req.workingDir &&
      resolvedSystemPrompt.workspacePath &&
      resolvedSystemPrompt.previewHref
        ? resolvedSystemPrompt.label === "code execute"
          ? resolvedSystemPrompt.content
          : codeSystemPrompt(
              resolvedSystemPrompt.workspacePath,
              resolvedSystemPrompt.previewHref,
              "execute",
            )
        : null;
    const codeSubmode = req.workingDir ? (req.codeSubmode ?? "auto") : null;
    const topLevelPlanHarnessEnabled =
      req.mode === "code" &&
      !!req.workingDir &&
      !req.executePlan &&
      (codeSubmode === "plan" || codeSubmode === "auto");
    const planningTaskMessageIndex =
      topLevelPlanHarnessEnabled && !req.executePlan
        ? req.messages.map((message) => message.role).lastIndexOf("user")
        : -1;
    const planningTask =
      planningTaskMessageIndex >= 0
        ? req.messages[planningTaskMessageIndex]?.content.trim()
        : "";
    const pushPlanningHarnessPrompt = (
      label: string,
      content: string,
    ): void => {
      emit({ type: "harness_message", label, content, phase: "planning" });
      pushHarnessPrompt(label, content);
    };
    const buildPlanValidationPrompt = (reason: string): string => {
      return [
        "The assembled plan is not executable yet: " + reason,
        "",
        "Executable-plan validation gates:",
        ...EXECUTABLE_PLAN_VALIDATION_GUIDANCE_LINES,
        "",
        "Return exactly one additional YAML plan step that is directly executable by the coding agent.",
        "Do not describe rewriting, correcting, or ensuring a previous step.",
        "The new step's prompt and verify fields must contain exact task-specific files, artifacts, commands, or verification evidence.",
        "Do not return plan: done; the assembled plan did not pass validation yet.",
      ].join("\n");
    };

    for (const message of replayRequestMessages({
      ...req,
      planningTaskMessageIndex,
    })) {
      baseMessages.push(message);
    }
    if (planningTask) {
      pushPlanningHarnessPrompt(
        "planning prompt",
        buildPlanAssemblyInitialPrompt(planningTask),
      );
    }

    const ctx: ToolContext = {
      conversationId: req.conversationId,
      onFileChange: () =>
        send("workspace:changed", { conversationId: req.conversationId }),
    };

    const useTools = req.mode === "code" || req.enableTools;
    const maxRounds =
      req.mode === "code" ? MAX_TOOL_ROUNDS_CODE : MAX_TOOL_ROUNDS_CHAT;

    emitRuntimeActivity("preparing request");

    let planState: PlanExecutionState | null = null;
    let awaitingVerify = false;
    let planAssemblyState: PlanAssemblyState | null = topLevelPlanHarnessEnabled
      ? createPlanAssemblyState()
      : null;
    let planSemanticReviewPlan: ParsedPlan | null = null;
    let planSemanticReviewMessages: MLXChatMessage[] | null = null;
    let planSemanticReviewRetries = 0;
    let planAssemblyValidationRetries = 0;
    const lastModelRequestMessageCounts = new Map<string, number>();
    let lastActionKey: string | null = null;
    let repeatedActionCount = 0;
    let stepIncompletePromptCount = 0;
    let stepEvidence = createPlanStepEvidence();
    let stepEvidenceStepId: string | null = null;
    const failedEditCounts = new Map<string, number>();
    let pendingEditRecoveryPath: string | null = null;

    const prepareStepEvidence = (prompt: {
      kind: "step" | "verify";
      stepId: string;
    }): void => {
      if (prompt.kind !== "step") return;
      if (prompt.stepId === stepEvidenceStepId) return;
      stepEvidence = createPlanStepEvidence();
      stepEvidenceStepId = prompt.stepId;
      lastActionKey = null;
      repeatedActionCount = 0;
      stepIncompletePromptCount = 0;
      pendingEditRecoveryPath = null;
      logExecution("step_evidence_reset", {
        stepId: prompt.stepId,
        promptKind: prompt.kind,
      });
    };

    const resetStepAttemptTracking = (): void => {
      lastActionKey = null;
      repeatedActionCount = 0;
      stepIncompletePromptCount = 0;
      stepEvidence = createPlanStepEvidence();
      stepEvidenceStepId = null;
      pendingEditRecoveryPath = null;
      logExecution("step_evidence_reset", {
        stepId: planState?.currentStepId ?? null,
        reason: "retry",
      });
    };

    const logStepEvidenceCheck = (
      decision: string,
      extra: Record<string, unknown> = {},
    ): void => {
      if (!planState?.currentStepId) return;
      const stepCriterion = planState.currentStepEvidenceCriterion() ?? "";
      const verifyCriterion = planState.currentVerifyCriterion() ?? "";
      logExecution("step_evidence_check", {
        decision,
        stepId: planState.currentStepId,
        stepCriterion,
        verifyCriterion,
        evidence: summarizePlanStepEvidence(stepEvidence),
        forcedStepReason: forcedVerifyFailureReason(
          stepCriterion,
          stepEvidence,
        ),
        forcedVerifyReason: forcedVerifyFailureReason(
          verifyCriterion,
          stepEvidence,
        ),
        ...extra,
      });
    };

    const pushStepIncompletePrompt = (reason: string): void => {
      logExecution("step_incomplete", {
        reason,
        stepId: planState?.currentStepId ?? null,
        evidence: summarizePlanStepEvidence(stepEvidence),
        stepCriterion: planState?.currentStepEvidenceCriterion() ?? "",
        verifyCriterion: planState?.currentVerifyCriterion() ?? "",
      });
      pushHarnessPrompt("step incomplete", buildIncompleteStepPrompt(reason));
    };

    const startPlanSemanticReview = (plan: ParsedPlan): void => {
      const reviewMessages = buildPlanSemanticReviewMessages(
        plan,
        planningTask,
      ).map(
        (message): MLXChatMessage => ({
          role: message.role,
          content: message.content,
        }),
      );
      planSemanticReviewPlan = plan;
      planSemanticReviewMessages = reviewMessages;
      planSemanticReviewRetries = 0;
      const [systemMessage, userMessage] = reviewMessages;
      emitSystemPrompt("plan semantic review", systemMessage.content);
      emit({
        type: "harness_message",
        label: "plan semantic review",
        content: userMessage.content,
        phase: "planning",
      });
    };

    const usePlanExecutionPrompt = (): void => {
      if (!planExecutionSystemPrompt || baseMessages[0]?.role !== "system") {
        return;
      }
      if (baseMessages[0].content === planExecutionSystemPrompt) {
        return;
      }
      baseMessages[0] = {
        role: "system",
        content: planExecutionSystemPrompt,
      };
      emitSystemPrompt("code execute", planExecutionSystemPrompt);
    };

    const drainPlanEvents = (): void => {
      if (!planState) return;
      for (const ev of planState.drainEvents()) {
        logExecution("plan_event", ev);
        if (ev.type === "plan_node_end" && ev.status === "failed") {
          logExecution("plan_step_failed", {
            kind: ev.kind,
            id: ev.id,
            reason: ev.reason ?? "",
          });
        }
        if (ev.type === "plan_node_start") {
          emit({
            type: "plan_node_start",
            kind: ev.kind,
            id: ev.id,
            parentId: ev.parentId,
            name: ev.name,
            prompt: ev.prompt,
            criterion: ev.criterion,
          });
        } else {
          emit({
            type: "plan_node_end",
            kind: ev.kind,
            id: ev.id,
            status: ev.status,
            reason: ev.reason,
          });
        }
      }
    };

    // executePlan path: a previously-proposed plan was approved by the user.
    // Prefer the UI-provided steps for the clicked proposal, then fall back to
    // the saved plan copy for older requests or recovery after an app restart.
    if (req.executePlan) {
      const plan =
        parsedPlanFromSteps(req.executePlanSteps ?? []) ??
        loadPlan(req.conversationId);
      if (!plan) {
        emit({ type: "activity", activity: { kind: "idle" } });
        emit({
          type: "error",
          error: "No proposed plan to execute for this conversation.",
        });
        return;
      }
      planState = new PlanExecutionState(plan);
      usePlanExecutionPrompt();
      drainPlanEvents();
      const next = planState.nextPrompt();
      if (!next) {
        emit({ type: "activity", activity: { kind: "idle" } });
        emit({ type: "done" });
        return;
      }
      prepareStepEvidence(next);
      pushHarnessPrompt(
        next.kind === "verify" ? "plan verify" : "plan step",
        next.text,
      );
      awaitingVerify = next.kind === "verify";
    }

    for (let round = 0; round < maxRounds; round++) {
      let buffer = "";
      let emittedIdx = 0;
      let firstToken = true;
      let executedAction = false;
      let sawIncompleteAction = false;
      let lastActivityTs = 0;
      let pendingAction: { name: string; target?: string } | null = null;

      // Live-preview state for write_file streaming. The workspace is mutated
      // only by the final visible write_file tool call.
      let livePath: string | null = null;
      let liveContentStart = -1;
      let lastLivePreview = 0;
      let lastEmittedContent = "";
      const emitLivePreview = (): void => {
        if (!livePath || liveContentStart < 0) return;
        let partial = buffer.slice(liveContentStart);
        if (partial.startsWith("\n")) partial = partial.slice(1);
        const closeIdx = partial.indexOf("</content>");
        if (closeIdx >= 0) partial = partial.slice(0, closeIdx);
        const cleaned = cleanFileContent(partial, livePath);
        if (cleaned !== lastEmittedContent) {
          lastEmittedContent = cleaned;
          logExecution("file_streaming", {
            path: livePath,
            content: cleaned,
            done: false,
          });
          send("file:streaming", {
            conversationId: req.conversationId,
            path: livePath,
            content: cleaned,
            done: false,
          });
        }
      };
      const closeLivePreview = (): void => {
        if (!livePath) return;
        logExecution("file_streaming", {
          path: livePath,
          content: lastEmittedContent,
          done: true,
        });
        send("file:streaming", {
          conversationId: req.conversationId,
          path: livePath,
          content: lastEmittedContent,
          done: true,
        });
        livePath = null;
        liveContentStart = -1;
        lastEmittedContent = "";
      };
      const pushIncompleteActionPrompt = (): void => {
        logExecution("incomplete_action", {
          pendingAction,
          bufferChars: buffer.length,
          emittedIdx,
          livePath,
          livePreviewChars: lastEmittedContent.length,
          tail: buffer.slice(-INCOMPLETE_ACTION_PREVIEW_CHARS),
        });
        closeLivePreview();
        pushHarnessPrompt("incomplete action", INCOMPLETE_ACTION_NUDGE);
        emit({ type: "activity", activity: { kind: "thinking", chars: 0 } });
      };

      const emitActivity = (): void => {
        const now = Date.now();
        if (now - lastActivityTs < RUNTIME_ACTIVITY_THROTTLE_MS) return;
        lastActivityTs = now;
        if (pendingAction) {
          emit({
            type: "activity",
            activity: {
              kind: "tool",
              tool: pendingAction.name,
              target: pendingAction.target,
              chars: buffer.length,
            },
          });
        } else {
          emitRuntimeActivity(
            "streaming response",
            `${buffer.length.toLocaleString()} characters received`,
          );
        }
      };

      emitRuntimeActivity("connecting to MLX");
      emitRuntimeActivity("waiting for first token");
      const requestMessages = planSemanticReviewMessages ?? baseMessages;
      const requestSource = planSemanticReviewMessages
        ? "plan_semantic_review"
        : "conversation";
      const previousMessageCount =
        lastModelRequestMessageCounts.get(requestSource) ?? 0;
      const newMessageStart =
        previousMessageCount <= requestMessages.length
          ? previousMessageCount
          : 0;
      const messageSummaries = summarizeModelRequestMessages(requestMessages);
      const newMessages = messageSummaries.slice(newMessageStart);
      lastModelRequestMessageCounts.set(
        requestSource,
        requestMessages.length,
      );
      // Persist the assembled conversation to <userData>/debug/last-system-prompt.txt
      // so the human can inspect what the model actually receives. Overwritten
      // every round so the file always reflects the latest call.
      try {
        const promptPath = saveLastPrompt(requestMessages, {
          mode: req.mode,
          model: req.model,
        });
        logExecution("model_request", {
          promptPath,
          requestSource,
          messageCount: requestMessages.length,
          newMessageCount: newMessages.length,
          messages: messageSummaries,
          newMessages,
        });
      } catch {
        // debug aid only; never let a write failure abort the chat round
      }
      streamLoop: for await (const chunk of chatStream({
        model: req.model,
        messages: requestMessages,
        signal: abort.signal,
      })) {
        logExecution("model_chunk", chunk);
        if (chunk.content) {
          if (firstToken) {
            firstToken = false;
            emitRuntimeActivity("streaming response");
          }
          buffer += chunk.content;

          // Forward raw token to devtools console for debugging
          mainWindow?.webContents.send("chat:raw", {
            conversationId: req.conversationId,
            chunk: chunk.content,
          });

          // Detect if we've started an action (for activity label + live writes)
          if (!pendingAction) {
            const openMatch = buffer
              .slice(emittedIdx)
              .match(/<action\s+name\s*=\s*["']?([a-zA-Z_][\w]*)["']?\s*>/i);
            if (openMatch) {
              const name = openMatch[1];
              const rest = buffer.slice(emittedIdx + (openMatch.index ?? 0));
              const pathM = rest.match(/<path>([^<]+?)<\/path>/i);
              const urlM = rest.match(/<url>([^<]+?)<\/url>/i);
              const qM = rest.match(/<query>([^<]+?)<\/query>/i);
              const cmdM = rest.match(/<command>([^<\n]+)/i);
              pendingAction = {
                name,
                target: pathM?.[1] || urlM?.[1] || qM?.[1] || cmdM?.[1],
              };
            }
          } else if (!pendingAction.target) {
            const rest = buffer.slice(emittedIdx);
            const pathM = rest.match(/<path>([^<]+?)<\/path>/i);
            const urlM = rest.match(/<url>([^<]+?)<\/url>/i);
            const qM = rest.match(/<query>([^<]+?)<\/query>/i);
            const cmdM = rest.match(/<command>([^<\n]+)/i);
            const t = pathM?.[1] || urlM?.[1] || qM?.[1] || cmdM?.[1];
            if (t) pendingAction.target = t;
          }

          // Stream a preview as <content> grows. Do not touch disk until the
          // parsed write_file action is executed and shown in the timeline.
          if (
            pendingAction?.name === "write_file" &&
            pendingAction.target &&
            !livePath
          ) {
            livePath = pendingAction.target;
          }
          if (livePath && liveContentStart < 0) {
            const idx = buffer.indexOf("<content>");
            if (idx >= 0) liveContentStart = idx + "<content>".length;
          }
          if (livePath && liveContentStart >= 0) {
            const now = Date.now();
            if (now - lastLivePreview > LIVE_WRITE_PREVIEW_THROTTLE_MS) {
              lastLivePreview = now;
              emitLivePreview();
            }
          }

          emitActivity();

          while (true) {
            if (!useTools) {
              // No tool parsing: stream tokens as they arrive
              if (emittedIdx < buffer.length) {
                emit({ type: "token", text: buffer.slice(emittedIdx) });
                emittedIdx = buffer.length;
              }
              break;
            }

            const found = findNextAction(buffer, emittedIdx);

            if (found === null) {
              // No action starting in the remaining buffer: emit safe text
              const safe = emitSafeBoundary(buffer, emittedIdx);
              if (safe > emittedIdx) {
                emit({ type: "token", text: buffer.slice(emittedIdx, safe) });
                emittedIdx = safe;
              }
              break;
            }

            if (found === "incomplete") {
              sawIncompleteAction = true;
              // Action has started but not closed. Emit text up to the open tag.
              const openIdx = buffer.indexOf("<action", emittedIdx);
              if (openIdx > emittedIdx) {
                emit({
                  type: "token",
                  text: buffer.slice(emittedIdx, openIdx),
                });
                emittedIdx = openIdx;
              }
              break;
            }

            // Emit any text between last emit and action start
            if (found.start > emittedIdx) {
              emit({
                type: "token",
                text: buffer.slice(emittedIdx, found.start),
              });
            }
            emittedIdx = found.end;

            if (
              planState?.currentStepId &&
              !awaitingVerify &&
              found.name === "verify"
            ) {
              const criterion = planState.currentStepEvidenceCriterion() ?? "";
              const forcedReason = forcedVerifyFailureReason(
                criterion,
                stepEvidence,
              );
              const resultText =
                typeof found.args.result === "string"
                  ? found.args.result.toLowerCase()
                  : "";
              const reason =
                typeof found.args.reason === "string"
                  ? found.args.reason
                  : undefined;
              if (resultText === "fail" && forcedReason) {
                pushStepIncompletePrompt(forcedReason);
              } else if (
                resultText === "fail" &&
                reason &&
                !isContradictedBySuccessfulEvidence(
                  reason,
                  criterion,
                  stepEvidence,
                )
              ) {
                const outcome = planState.failCurrentStepAttempt(reason);
                drainPlanEvents();
                awaitingVerify = false;
                resetStepAttemptTracking();
                if (outcome === "abort" || planState.state !== "running") {
                  emit({ type: "activity", activity: { kind: "idle" } });
                  emit({ type: "done" });
                  return;
                }
                const next = planState.nextPrompt();
                if (!next) {
                  emit({ type: "activity", activity: { kind: "idle" } });
                  emit({ type: "done" });
                  return;
                }
                prepareStepEvidence(next);
                pushHarnessPrompt(
                  next.kind === "verify" ? "plan verify" : "plan step",
                  next.text,
                );
                awaitingVerify = next.kind === "verify";
              } else {
                planState.finishStepBody();
                drainPlanEvents();
                const next = planState.nextPrompt();
                if (!next) {
                  emit({ type: "activity", activity: { kind: "idle" } });
                  emit({ type: "done" });
                  return;
                }
                prepareStepEvidence(next);
                pushHarnessPrompt(
                  next.kind === "verify" ? "plan verify" : "plan step",
                  next.text,
                );
                awaitingVerify = next.kind === "verify";
              }
              executedAction = true;
              emit({
                type: "activity",
                activity: { kind: "thinking", chars: 0 },
              });
              break streamLoop;
            }

            const call: ToolCall = {
              id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              name: found.name,
              args: found.args,
              running: true,
              ...(planState?.currentStepId
                ? { parentStepId: planState.currentStepId }
                : {}),
            };
            logExecution("tool_call", call);
            emit({ type: "tool_call", call });
            emit({
              type: "activity",
              activity: {
                kind: "tool",
                tool: found.name,
                target: actionTarget(found.name, found.args),
              },
            });

            let result: string;
            let hadError = false;
            const actionKey = `${found.name}:${JSON.stringify(found.args)}`;
            if (actionKey === lastActionKey) {
              repeatedActionCount += 1;
            } else {
              lastActionKey = actionKey;
              repeatedActionCount = 1;
            }
            try {
              result = await runTool(found.name, found.args, ctx);
              hadError = isToolErrorResult(result);
              const toolResultLog = {
                id: call.id,
                tool: found.name,
                args: found.args,
                status: hadError ? "error" : "ok",
                output: result,
                ...(hadError ? { error: result } : { result }),
              };
              logExecution("tool_result", toolResultLog);
              emit(
                hadError
                  ? { type: "tool_result", id: call.id, error: result }
                  : { type: "tool_result", id: call.id, result },
              );
            } catch (e) {
              result = `Error: ${(e as Error).message}`;
              hadError = true;
              logExecution("tool_result", {
                id: call.id,
                tool: found.name,
                args: found.args,
                status: "error",
                output: result,
                error: result,
              });
              emit({ type: "tool_result", id: call.id, error: result });
            }

            baseMessages.push({
              role: "assistant",
              content: buffer.slice(0, emittedIdx),
            });
            baseMessages.push({
              role: "user",
              content: formatToolResultMessage(found.name, result, hadError),
            });
            if (planState?.currentStepId) {
              recordPlanToolEvidence(stepEvidence, found.name, result, found.args);
              logStepEvidenceCheck("after_tool_result", {
                tool: found.name,
                toolHadError: hadError,
              });
            }
            if (
              planState?.currentStepId &&
              !awaitingVerify &&
              hasSatisfiedReadOnlyStepEvidence(
                planState.currentStepEvidenceCriterion() ?? "",
                stepEvidence,
              )
            ) {
              logStepEvidenceCheck("advance_read_only_step");
              planState.finishStepBody();
              drainPlanEvents();
              const next = planState.nextPrompt();
              if (!next) {
                emit({ type: "activity", activity: { kind: "idle" } });
                emit({ type: "done" });
                return;
              }
              prepareStepEvidence(next);
              pushHarnessPrompt(
                next.kind === "verify" ? "plan verify" : "plan step",
                next.text,
              );
              awaitingVerify = next.kind === "verify";
              executedAction = true;
              pendingAction = null;
              livePath = null;
              liveContentStart = -1;
              lastEmittedContent = "";
              emit({
                type: "activity",
                activity: { kind: "thinking", chars: 0 },
              });
              break streamLoop;
            }
            if (
              planState?.currentStepId &&
              !awaitingVerify &&
              hasGuardedAlreadyPresentEvidence(
                planState.currentStepEvidenceCriterion() ?? "",
                stepEvidence,
              )
            ) {
              logStepEvidenceCheck("advance_guarded_already_present");
              planState.finishStepBody();
              drainPlanEvents();
              const next = planState.nextPrompt();
              if (!next) {
                emit({ type: "activity", activity: { kind: "idle" } });
                emit({ type: "done" });
                return;
              }
              prepareStepEvidence(next);
              pushHarnessPrompt(
                next.kind === "verify" ? "plan verify" : "plan step",
                next.text,
              );
              awaitingVerify = next.kind === "verify";
              executedAction = true;
              pendingAction = null;
              livePath = null;
              liveContentStart = -1;
              lastEmittedContent = "";
              emit({
                type: "activity",
                activity: { kind: "thinking", chars: 0 },
              });
              break streamLoop;
            }
            if (
              planState?.currentStepId &&
              !awaitingVerify &&
              hasSuccessfulRequiredCommandEvidence(
                planState.currentVerifyCriterion() ?? "",
                stepEvidence,
              )
            ) {
              logStepEvidenceCheck("advance_successful_required_command");
              planState.finishStepBody();
              drainPlanEvents();
              const next = planState.nextPrompt();
              if (!next) {
                emit({ type: "activity", activity: { kind: "idle" } });
                emit({ type: "done" });
                return;
              }
              prepareStepEvidence(next);
              pushHarnessPrompt(
                next.kind === "verify" ? "plan verify" : "plan step",
                next.text,
              );
              awaitingVerify = next.kind === "verify";
              executedAction = true;
              pendingAction = null;
              livePath = null;
              liveContentStart = -1;
              lastEmittedContent = "";
              emit({
                type: "activity",
                activity: { kind: "thinking", chars: 0 },
              });
              break streamLoop;
            }
            if (
              found.name === "edit_file" &&
              isRecoverableEditFailureResult(result) &&
              typeof found.args.path === "string"
            ) {
              pendingEditRecoveryPath = found.args.path;
              const failedEdit = buildFailedEditKey(found.args);
              const failedEditAttempts = failedEdit
                ? (failedEditCounts.get(failedEdit.key) ?? 0) + 1
                : 1;
              if (failedEdit) {
                failedEditCounts.set(failedEdit.key, failedEditAttempts);
              }
              pushHarnessPrompt(
                "edit recovery",
                failedEdit &&
                  failedEditAttempts >= REPEATED_FAILED_EDIT_THRESHOLD
                  ? buildRepeatedEditFailureRecoveryPrompt(
                      failedEdit.path,
                      failedEdit.oldString,
                      failedEditAttempts,
                    )
                  : buildEditFailureRecoveryPrompt(found.args.path),
              );
            }
            if (found.name === "edit_file") {
              const failedEdit = buildFailedEditKey(found.args);
              if (failedEdit && !isRecoverableEditFailureResult(result)) {
                failedEditCounts.delete(failedEdit.key);
              }
              if (
                typeof found.args.path === "string" &&
                found.args.path === pendingEditRecoveryPath &&
                !isRecoverableEditFailureResult(result)
              ) {
                pendingEditRecoveryPath = null;
              }
            }
            if (
              found.name === "write_file" &&
              typeof found.args.path === "string" &&
              found.args.path === pendingEditRecoveryPath &&
              !result.startsWith("Error")
            ) {
              pendingEditRecoveryPath = null;
            }
            if (repeatedActionCount > 1) {
              if (
                found.name === "read_file" &&
                typeof found.args.path === "string" &&
                found.args.path === pendingEditRecoveryPath
              ) {
                pushHarnessPrompt(
                  "edit recovery",
                  buildRepeatedRecoveryReadPrompt(found.args.path),
                );
                executedAction = true;
                closeLivePreview();
                pendingAction = null;
                emit({
                  type: "activity",
                  activity: { kind: "thinking", chars: 0 },
                });
                break streamLoop;
              }
              const repeatedFailureReason =
                planState?.currentStepId
                  ? repeatedActionForcedFailureReason({
                      actionName: found.name,
                      repeatedActionCount,
                      criterion: planState.currentStepEvidenceCriterion() ?? "",
                      evidence: stepEvidence,
                    })
                  : null;
              if (repeatedFailureReason && planState) {
                const outcome =
                  planState.failCurrentStepAttempt(repeatedFailureReason);
                drainPlanEvents();
                awaitingVerify = false;
                resetStepAttemptTracking();
                if (outcome === "abort" || planState.state !== "running") {
                  emit({ type: "activity", activity: { kind: "idle" } });
                  emit({ type: "done" });
                  return;
                }
                const next = planState.nextPrompt();
                if (!next) {
                  emit({ type: "activity", activity: { kind: "idle" } });
                  emit({ type: "done" });
                  return;
                }
                prepareStepEvidence(next);
                pushHarnessPrompt(
                  next.kind === "verify" ? "plan verify" : "plan step",
                  next.text,
                );
                awaitingVerify = next.kind === "verify";
                executedAction = true;
                emit({
                  type: "activity",
                  activity: { kind: "thinking", chars: 0 },
                });
                break streamLoop;
              }
              pushHarnessPrompt(
                "repeated action",
                [
                  `You repeated the same ${found.name} action ${repeatedActionCount} times.`,
                  "Use the existing tool result already provided in this conversation and move to the next distinct action.",
                  'If the required tool result is not visible or is not usable, reply exactly with <error reason="short reason"/>.',
                  "Do not assume hidden output, wait silently, or continue from guessed file information.",
                  "Do not emit a YAML plan while executing a plan step.",
                  `Do not call ${found.name} with the same parameters again.`,
                ].join(" "),
              );
            }
            executedAction = true;
            if (
              found.name === "write_file" &&
              typeof found.args.path === "string" &&
              typeof found.args.content === "string"
            ) {
              livePath = found.args.path;
              lastEmittedContent = cleanFileContent(
                found.args.content,
                found.args.path,
              );
            }
            closeLivePreview();
            pendingAction = null;
            emit({
              type: "activity",
              activity: { kind: "thinking", chars: 0 },
            });
            // Break out of the current stream — we need to start a new
            // request with the updated conversation including the tool result.
            break streamLoop;
          }
          if (
            planState?.currentStepId &&
            !awaitingVerify &&
            COMPLETE_STEP_RESPONSE_RE.test(buffer)
          ) {
            break streamLoop;
          }
        }
        if (chunk.done) {
          break streamLoop;
        }
      }

      if (executedAction) {
        // Body of the active step continues in the next round.
        continue;
      }

      if (
        sawIncompleteAction ||
        pendingAction ||
        findNextAction(buffer, emittedIdx) === "incomplete"
      ) {
        pushIncompleteActionPrompt();
        continue;
      }

      const flushBufferToUI = (): void => {
        if (emittedIdx < buffer.length) {
          emit({ type: "token", text: buffer.slice(emittedIdx) });
          emittedIdx = buffer.length;
        }
      };

      // Plans and verify responses are rendered structurally by PlanView;
      // replace the streamed body with a cleaned version so raw control text doesn't
      // appear twice in the chat.
      const replaceBodyStripped = (): void => {
        const cleaned = stripPlanArtifacts(buffer);
        emit({ type: "set_assistant_content", text: cleaned });
      };

      // Verify-phase response handling: parse <verify result="..."/> from the
      // buffer and feed it to the state machine.
      if (planState && awaitingVerify) {
        let vr = parseVerifyResult(buffer);
        if (vr) {
          const forcedReason = forcedVerifyFailureReason(
            planState.currentVerifyCriterion() ?? "",
            stepEvidence,
          );
          if (vr.result === "pass" && forcedReason) {
            vr = { result: "fail", reason: forcedReason };
          }
          if (
            vr.result === "fail" &&
            isMalformedActionSelfReport(vr.reason)
          ) {
            vr = forcedReason
              ? { result: "fail", reason: forcedReason }
              : { result: "pass" };
          }
          if (
            vr.result === "fail" &&
            isContradictedBySuccessfulEvidence(
              vr.reason,
              planState.currentVerifyCriterion() ?? "",
              stepEvidence,
            )
          ) {
            vr = { result: "pass" };
          }
          flushBufferToUI();
          replaceBodyStripped();
          baseMessages.push({ role: "assistant", content: buffer });
          logExecution("verify_result", {
            result: vr.result,
            reason: "reason" in vr ? vr.reason : "",
            criterion: planState.currentVerifyCriterion() ?? "",
            stepId: planState.currentStepId,
            evidence: summarizePlanStepEvidence(stepEvidence),
            forcedReason: forcedVerifyFailureReason(
              planState.currentVerifyCriterion() ?? "",
              stepEvidence,
            ),
          });
          logStepEvidenceCheck("before_apply_verify", {
            verifyResult: vr.result,
            verifyReason: "reason" in vr ? vr.reason : "",
          });
          const outcome = planState.applyVerify(vr);
          drainPlanEvents();
          awaitingVerify = false;
          if (outcome === "retry") {
            resetStepAttemptTracking();
          }
          if (outcome === "abort" || planState.state !== "running") {
            emit({ type: "activity", activity: { kind: "idle" } });
            emit({ type: "done" });
            return;
          }
          const next = planState.nextPrompt();
          if (!next) {
            emit({ type: "activity", activity: { kind: "idle" } });
            emit({ type: "done" });
            return;
          }
          prepareStepEvidence(next);
          pushHarnessPrompt(
            next.kind === "verify" ? "plan verify" : "plan step",
            next.text,
          );
          awaitingVerify = next.kind === "verify";
          emit({ type: "activity", activity: { kind: "thinking", chars: 0 } });
          continue;
        }
        // Model failed to emit a verify tag. End the task gracefully.
        flushBufferToUI();
        emit({ type: "activity", activity: { kind: "idle" } });
        emit({ type: "done" });
        return;
      }

      // Look for a plan in the buffer. Two paths:
      //   - top-level (no active planState): accept exactly one step, keep
      //     asking for the next step, then save the assembled plan only after
      //     the model emits the done sentinel.
      //   - inside an active planState: nested plans are not allowed; they
      //     turn into a recursive loop where each sub-plan re-emits the same
      //     step prompt. Reject the plan and re-prompt the current step so
      //     the model does the work directly.
      if (planSemanticReviewPlan) {
        flushBufferToUI();
        const reviewMessages = planSemanticReviewMessages as
          | MLXChatMessage[]
          | null;
        if (!reviewMessages) {
          emit({
            type: "error",
            error: "Plan semantic review context is missing.",
          });
          emit({ type: "activity", activity: { kind: "idle" } });
          emit({ type: "done" });
          return;
        }
        const review = applyPlanSemanticReviewResponse(
          planSemanticReviewPlan,
          buffer,
        );
        reviewMessages.push({ role: "assistant", content: buffer });
        if (review.kind === "rejected") {
          planSemanticReviewRetries += 1;
          logExecution("plan_semantic_review_rejected", {
            reason: review.reason,
            retryCount: planSemanticReviewRetries,
            maxRetries: MAX_PLAN_SEMANTIC_REVIEW_RETRIES,
          });
          if (
            planSemanticReviewRetries >= MAX_PLAN_SEMANTIC_REVIEW_RETRIES
          ) {
            emit({
              type: "error",
              error:
                "Plan semantic review rejected too many responses: " +
                review.reason,
            });
            emit({ type: "activity", activity: { kind: "idle" } });
            emit({ type: "done" });
            return;
          }
          emit({
            type: "harness_message",
            label: "plan semantic review retry",
            content: review.retryPrompt,
            phase: "planning",
          });
          reviewMessages.push({ role: "user", content: review.retryPrompt });
          emit({
            type: "activity",
            activity: { kind: "thinking", chars: 0 },
          });
          continue;
        }
        planSemanticReviewPlan = null;
        planSemanticReviewMessages = null;
        planSemanticReviewRetries = 0;
        planAssemblyState = null;
        planAssemblyValidationRetries = 0;
        emit({ type: "set_assistant_content", text: "" });
        emit({ type: "plan_reviewed", review: review.review });
        savePlan(req.conversationId, review.plan.raw);
        emit({
          type: "plan_proposed",
          steps: review.plan.steps.map((s) => ({
            name: s.name,
            prompt: s.prompt,
            verify: s.verify,
          })),
        });
        emit({ type: "activity", activity: { kind: "idle" } });
        emit({ type: "done" });
        return;
      }

      const planFound =
        planState || topLevelPlanHarnessEnabled ? findNextPlan(buffer) : null;
      const planAssemblyDone =
        !planState &&
        !!planAssemblyState &&
        isPlanAssemblyDoneResponse(buffer);
      const planAssemblyStopped =
        !planState &&
        !!planAssemblyState &&
        planAssemblyState.steps.length > 0 &&
        planFound === null &&
        buffer.trim().length > 0;
      if (
        (planFound && planFound !== "incomplete") ||
        planAssemblyDone ||
        planAssemblyStopped
      ) {
        flushBufferToUI();
        if (planState) {
          replaceBodyStripped();
        }
        if (!planState) {
          if (!planAssemblyState) {
            emit({ type: "activity", activity: { kind: "idle" } });
            emit({
              type: "error",
              error: "Plan assembly is not active for this conversation.",
            });
            return;
          }
          const assembled = applyPlanAssemblyResponse(
            planAssemblyState,
            buffer,
            planningTask,
          );
          planAssemblyState = assembled.state;
          if (assembled.kind === "accepted") {
            planAssemblyValidationRetries = 0;
            baseMessages.push({ role: "assistant", content: buffer });
            pushPlanningHarnessPrompt("plan assembly", assembled.nextPrompt);
            emit({
              type: "activity",
              activity: { kind: "thinking", chars: 0 },
            });
            continue;
          }
          if (assembled.kind === "rejected") {
            planAssemblyValidationRetries += 1;
            if (
              planAssemblyValidationRetries >=
              MAX_PLAN_ASSEMBLY_VALIDATION_RETRIES
            ) {
              emit({
                type: "error",
                error: "Plan assembly rejected too many responses.",
              });
              emit({ type: "activity", activity: { kind: "idle" } });
              emit({ type: "done" });
              return;
            }
            baseMessages.push({ role: "assistant", content: buffer });
            pushPlanningHarnessPrompt(
              "plan assembly retry",
              assembled.retryPrompt,
            );
            emit({
              type: "activity",
              activity: { kind: "thinking", chars: 0 },
            });
            continue;
          }
          const validation = validatePlanForExecution(assembled.plan);
          if (!validation.valid) {
            planAssemblyValidationRetries += 1;
            if (
              planAssemblyValidationRetries >=
              MAX_PLAN_ASSEMBLY_VALIDATION_RETRIES
            ) {
              emit({
                type: "error",
                error: "Assembled plan failed deterministic validation too many times.",
              });
              emit({ type: "activity", activity: { kind: "idle" } });
              emit({ type: "done" });
              return;
            }
            const validationPrompt = buildPlanValidationPrompt(
              validation.reason,
            );
            baseMessages.push({ role: "assistant", content: buffer });
            pushPlanningHarnessPrompt("plan assembly validation", validationPrompt);
            emit({
              type: "activity",
              activity: { kind: "thinking", chars: 0 },
            });
            continue;
          }
          planAssemblyValidationRetries = 0;
          baseMessages.push({ role: "assistant", content: buffer });
          startPlanSemanticReview(assembled.plan);
          emit({
            type: "activity",
            activity: { kind: "thinking", chars: 0 },
          });
          continue;
        }
        // Nested plan inside an active step: reject and re-prompt the same
        // step. The state machine is left untouched (still in step phase),
        // so nextPrompt() returns the same step text again.
        usePlanExecutionPrompt();
        const corrective =
          `You emitted a YAML plan while inside an active plan step. That is not allowed and the plan was discarded. ` +
          `Do the work for the current step directly using <action> tags, or write a <summary> of no more than 3 lines if no tools are needed. ` +
          `If you cannot proceed, reply with <error reason="short reason"/>.`;
        pushHarnessPrompt("nested plan correction", corrective);
        const next = planState.nextPrompt();
        if (!next) {
          emit({ type: "activity", activity: { kind: "idle" } });
          emit({ type: "done" });
          return;
        }
        prepareStepEvidence(next);
        pushHarnessPrompt(
          next.kind === "verify" ? "plan verify" : "plan step",
          next.text,
        );
        awaitingVerify = next.kind === "verify";
        emit({ type: "activity", activity: { kind: "thinking", chars: 0 } });
        continue;
      }

      // No action, no plan, no verify pending: if a plan is active, the
      // current step's body has just finished.
      if (planState) {
        const prematureVerify = parseVerifyResult(buffer);
        if (prematureVerify) {
          const criterion = planState.currentStepEvidenceCriterion() ?? "";
          const forcedReason = forcedVerifyFailureReason(
            criterion,
            stepEvidence,
          );
          if (
            prematureVerify.result === "fail" &&
            isMalformedActionSelfReport(prematureVerify.reason)
          ) {
            replaceBodyStripped();
            if (forcedReason) {
              pushStepIncompletePrompt(forcedReason);
              emit({
                type: "activity",
                activity: { kind: "thinking", chars: 0 },
              });
              continue;
            }
            planState.finishStepBody();
            drainPlanEvents();
            if (planState.state !== "running") {
              emit({ type: "activity", activity: { kind: "idle" } });
              emit({ type: "done" });
              return;
            }
            const next = planState.nextPrompt();
            if (!next) {
              emit({ type: "activity", activity: { kind: "idle" } });
              emit({ type: "done" });
              return;
            }
            prepareStepEvidence(next);
            pushHarnessPrompt(
              next.kind === "verify" ? "plan verify" : "plan step",
              next.text,
            );
            awaitingVerify = next.kind === "verify";
            emit({
              type: "activity",
              activity: { kind: "thinking", chars: 0 },
            });
            continue;
          }
          if (
            prematureVerify.result === "fail" &&
            isContradictedBySuccessfulEvidence(
              prematureVerify.reason,
              criterion,
              stepEvidence,
            )
          ) {
            replaceBodyStripped();
            planState.finishStepBody();
            drainPlanEvents();
            if (planState.state !== "running") {
              emit({ type: "activity", activity: { kind: "idle" } });
              emit({ type: "done" });
              return;
            }
            const next = planState.nextPrompt();
            if (!next) {
              emit({ type: "activity", activity: { kind: "idle" } });
              emit({ type: "done" });
              return;
            }
            prepareStepEvidence(next);
            pushHarnessPrompt(
              next.kind === "verify" ? "plan verify" : "plan step",
              next.text,
            );
            awaitingVerify = next.kind === "verify";
            emit({
              type: "activity",
              activity: { kind: "thinking", chars: 0 },
            });
            continue;
          }
          flushBufferToUI();
          replaceBodyStripped();
          baseMessages.push({ role: "assistant", content: buffer });
          if (prematureVerify.result === "fail") {
            const failureReason =
              prematureVerify.reason ??
              forcedReason ??
              "premature verify failure";
            const outcome = planState.failCurrentStepAttempt(failureReason);
            drainPlanEvents();
            awaitingVerify = false;
            resetStepAttemptTracking();
            if (outcome === "abort" || planState.state !== "running") {
              emit({ type: "activity", activity: { kind: "idle" } });
              emit({ type: "done" });
              return;
            }
            const next = planState.nextPrompt();
            if (!next) {
              emit({ type: "activity", activity: { kind: "idle" } });
              emit({ type: "done" });
              return;
            }
            prepareStepEvidence(next);
            pushHarnessPrompt(
              next.kind === "verify" ? "plan verify" : "plan step",
              next.text,
            );
            awaitingVerify = next.kind === "verify";
            emit({
              type: "activity",
              activity: { kind: "thinking", chars: 0 },
            });
            continue;
          }
          if (!forcedReason) {
            planState.finishStepBody();
            drainPlanEvents();
            if (planState.state !== "running") {
              emit({ type: "activity", activity: { kind: "idle" } });
              emit({ type: "done" });
              return;
            }
            const next = planState.nextPrompt();
            if (!next) {
              emit({ type: "activity", activity: { kind: "idle" } });
              emit({ type: "done" });
              return;
            }
            prepareStepEvidence(next);
            pushHarnessPrompt(
              next.kind === "verify" ? "plan verify" : "plan step",
              next.text,
            );
            awaitingVerify = next.kind === "verify";
            emit({
              type: "activity",
              activity: { kind: "thinking", chars: 0 },
            });
            continue;
          }
          pushHarnessPrompt(
            "premature verify",
            buildPrematureVerifyPrompt(forcedReason),
          );
          emit({ type: "activity", activity: { kind: "thinking", chars: 0 } });
          continue;
        }
        const blockedReason = parseBlockedReason(buffer);
        if (blockedReason) {
          flushBufferToUI();
          emit({
            type: "set_assistant_content",
            text: `BLOCKED: ${blockedReason}`,
          });
          baseMessages.push({
            role: "assistant",
            content: `BLOCKED: ${blockedReason}`,
          });
          logExecution("plan_blocked", {
            reason: blockedReason,
            stepId: planState.currentStepId,
          });
          const outcome = planState.failCurrentStepAttempt(
            `blocked: ${blockedReason}`,
          );
          drainPlanEvents();
          awaitingVerify = false;
          resetStepAttemptTracking();
          if (outcome === "abort" || planState.state !== "running") {
            emit({ type: "activity", activity: { kind: "idle" } });
            emit({ type: "done" });
            return;
          }
          const next = planState.nextPrompt();
          if (!next) {
            emit({ type: "activity", activity: { kind: "idle" } });
            emit({ type: "done" });
            return;
          }
          prepareStepEvidence(next);
          pushHarnessPrompt(
            next.kind === "verify" ? "plan verify" : "plan step",
            next.text,
          );
          awaitingVerify = next.kind === "verify";
          emit({
            type: "activity",
            activity: { kind: "thinking", chars: 0 },
          });
          continue;
        }
        const stepSummary = parseStepSummary(buffer);
        const incompleteReason = forcedVerifyFailureReason(
          planState.currentStepEvidenceCriterion() ?? "",
          stepEvidence,
        );
        const invalidToolSelfReportReason =
          stepEvidence.actionCount > 0
            ? invalidToolResultSelfReportReason(buffer)
            : null;
        if (invalidToolSelfReportReason) {
          logStepEvidenceCheck("tool_result_self_report_rejected", {
            reason: invalidToolSelfReportReason,
          });
          flushBufferToUI();
          emit({ type: "set_assistant_content", text: "" });
          pushHarnessPrompt(
            "tool result correction",
            buildToolResultSelfReportPrompt(invalidToolSelfReportReason),
          );
          emit({ type: "activity", activity: { kind: "thinking", chars: 0 } });
          continue;
        }
        if (incompleteReason) {
          stepIncompletePromptCount++;
          if (stepIncompletePromptCount >= MAX_STEP_INCOMPLETE_REPROMPTS) {
            const abortReason =
              `repeated no-action responses for this plan step. ` +
              `Latest missing evidence: ${incompleteReason}`;
            logStepEvidenceCheck("step_incomplete_abort", {
              reason: incompleteReason,
              promptCount: stepIncompletePromptCount,
              abortReason,
            });
            flushBufferToUI();
            emit({
              type: "set_assistant_content",
              text: `BLOCKED: ${abortReason}`,
            });
            planState.abortCurrentStep(abortReason);
            drainPlanEvents();
            awaitingVerify = false;
            resetStepAttemptTracking();
            emit({ type: "activity", activity: { kind: "idle" } });
            emit({ type: "done" });
            return;
          }
          logStepEvidenceCheck("step_incomplete_no_action", {
            reason: incompleteReason,
            promptCount: stepIncompletePromptCount,
          });
          flushBufferToUI();
          emit({ type: "set_assistant_content", text: "" });
          if (buffer.trim().length > 0) {
            baseMessages.push({ role: "assistant", content: buffer });
          }
          pushStepIncompletePrompt(incompleteReason);
          emit({ type: "activity", activity: { kind: "thinking", chars: 0 } });
          continue;
        }
        if (stepSummary?.kind === "invalid") {
          logStepEvidenceCheck("step_summary_rejected", {
            reason: stepSummary.reason,
          });
          flushBufferToUI();
          emit({
            type: "set_assistant_content",
            text: stripPlanArtifacts(buffer),
          });
          baseMessages.push({ role: "assistant", content: buffer });
          pushHarnessPrompt(
            "summary correction",
            buildStepSummaryCorrectionPrompt(stepSummary.reason),
          );
          emit({ type: "activity", activity: { kind: "thinking", chars: 0 } });
          continue;
        }
        flushBufferToUI();
        if (stepSummary?.kind === "summary") {
          emit({ type: "set_assistant_content", text: stepSummary.text });
          baseMessages.push({ role: "assistant", content: stepSummary.text });
        } else {
          replaceBodyStripped();
          baseMessages.push({ role: "assistant", content: buffer });
        }
        logStepEvidenceCheck("finish_step_body_no_forced_failure");
        planState.finishStepBody();
        drainPlanEvents();
        if (planState.state !== "running") {
          emit({ type: "activity", activity: { kind: "idle" } });
          emit({ type: "done" });
          return;
        }
        const next = planState.nextPrompt();
        if (!next) {
          emit({ type: "activity", activity: { kind: "idle" } });
          emit({ type: "done" });
          return;
        }
        prepareStepEvidence(next);
        pushHarnessPrompt(
          next.kind === "verify" ? "plan verify" : "plan step",
          next.text,
        );
        awaitingVerify = next.kind === "verify";
        emit({ type: "activity", activity: { kind: "thinking", chars: 0 } });
        continue;
      }

      // Build and planning fallback: nudge a round-0 narration toward the
      // expected artifact for modes where plain discussion is not the goal.
      const shouldNudgeCodeResponse =
        req.mode === "code" &&
        round === 0 &&
        buffer.trim().length > 0 &&
        (!req.workingDir ||
          !["discuss", "execute"].includes(req.codeSubmode ?? "auto"));
      if (shouldNudgeCodeResponse) {
        flushBufferToUI();
        baseMessages.push({ role: "assistant", content: buffer });
        if (topLevelPlanHarnessEnabled) {
          pushPlanningHarnessPrompt(
            "planning retry",
            PLAN_ASSEMBLY_NO_PROGRESS_PROMPT,
          );
        } else {
          pushHarnessPrompt(
            "mode nudge",
            req.workingDir ? CODE_PLAN_NUDGE : BUILD_ACTION_NUDGE,
          );
        }
        emit({ type: "activity", activity: { kind: "thinking", chars: 0 } });
        continue;
      }

      emit({ type: "activity", activity: { kind: "idle" } });
      emit({ type: "done" });
      return;
    }
    emit({ type: "activity", activity: { kind: "idle" } });
    emit({
      type: "error",
      error: `Reached max tool rounds (${maxRounds}). Ask the model to finish up and try again.`,
    });
  } catch (e) {
    emit({ type: "activity", activity: { kind: "idle" } });
    const error = e as Error;
    if (abort.signal.aborted || error.name === "AbortError") {
      emit({ type: "done" });
    } else {
      emit({ type: "error", error: error.message });
    }
  } finally {
    chatAbortControllers.delete(req.conversationId);
  }
}

const chatAbortControllers = new Map<string, AbortController>();

app.whenReady().then(async () => {
  setRuntimePaths({
    userData: app.getPath("userData"),
    appRoot: app.getAppPath(),
    packaged: app.isPackaged,
  });
  electronApp.setAppUserModelId("com.ammaar.gemmachat");
  nativeTheme.themeSource = "dark";

  // Set dock icon (macOS) — ensures the Gemma icon shows in dev mode
  if (process.platform === "darwin" && app.dock) {
    const dockIcon = nativeImage.createFromPath(
      join(__dirname, "../../build/icon.png"),
    );
    if (!dockIcon.isEmpty()) app.dock.setIcon(dockIcon);
  }

  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  await startWorkspaceServer();

  session.defaultSession.setPermissionRequestHandler(
    (_wc, permission, callback) => {
      if (permission === "media" || permission === "mediaKeySystem") {
        callback(true);
        return;
      }
      callback(false);
    },
  );
  session.defaultSession.setPermissionCheckHandler(() => true);

  ipcMain.handle("setup:start", async (_e, model: string) => {
    await handleSetup(model);
  });

  ipcMain.handle("model:switch", async (_e, model: string) => {
    const label = modelLabel(model);
    send("setup:status", {
      stage: "downloading-model",
      message: `Switching to ${label}…`,
    });
    try {
      stopServer();
      await ensureMLXRunning(model);
      send("setup:status", { stage: "ready", message: "Ready to chat." });
    } catch (e) {
      if (e instanceof ModelCacheRepairRequiredError) {
        sendRepairableModelError(e.model, e.reason);
        return;
      }
      send("setup:status", {
        stage: "error",
        message: "Model switch failed",
        error: (e as Error).message,
        command:
          getLastMlxServerCommand() ||
          `python -m mlx_lm server --model ${model} --port ${MLX_SERVER_PORT}`,
        logFile: getMlxServerLogPath(),
      });
    }
  });

  ipcMain.handle("setup:status", async () => {
    const mlx = locateMLX();
    return { hasMLX: !!(mlx && mlx.installed) };
  });

  ipcMain.handle("model:repair", async (_e, model: string) => {
    await handleRepairModel(model);
  });

  ipcMain.handle("models:list-local", async () => {
    return listLocalModels();
  });

  ipcMain.handle("chat:send", async (_e, req: ChatRequest) => {
    const channel = `chat:stream:${req.conversationId}`;
    handleChat(req, channel).catch((err) =>
      console.error("chat handler error", err),
    );
    return { channel };
  });

  ipcMain.handle("chat:abort", async (_e, conversationId: string) => {
    const c = chatAbortControllers.get(conversationId);
    if (c) c.abort();
  });

  ipcMain.handle("debug:execution-log-path", async () => executionLogPath());

  ipcMain.handle("debug:execution-log-read", async () =>
    readExecutionLogSnapshot(),
  );

  ipcMain.handle("debug:open-execution-log", async () => {
    const path = ensureExecutionLogFile();
    const error = await shell.openPath(path);
    if (error) throw new Error(error);
  });

  ipcMain.handle("tools:list", async () => {
    return Object.values(TOOLS).map((t) => ({
      name: t.name,
      description: t.description,
      mode: t.mode,
    }));
  });

  ipcMain.handle("workspace:info", async (_e, conversationId: string) => {
    await ensureWorkspace(conversationId);
    return {
      conversationId,
      path: workspaceDir(conversationId),
      previewUrl: previewUrl(conversationId),
    };
  });

  ipcMain.handle("workspace:list", async (_e, conversationId: string) => {
    const base = await ensureWorkspace(conversationId);
    return listTree(base, 300);
  });

  ipcMain.handle(
    "workspace:open-external",
    async (_e, conversationId: string) => {
      await ensureWorkspace(conversationId);
      shell.openPath(workspaceDir(conversationId));
    },
  );

  ipcMain.handle("workspace:server-port", async () => getWorkspaceServerPort());

  ipcMain.handle(
    "workspace:set-override",
    async (_e, conversationId: string, absolutePath: string) => {
      setWorkspaceOverride(conversationId, absolutePath);
    },
  );

  ipcMain.handle(
    "workspace:clear-override",
    async (_e, conversationId: string) => {
      clearWorkspaceOverride(conversationId);
    },
  );

  // Native directory picker used by the renderer to bind a Code-mode
  // conversation to a working directory. Returns null when the user cancels.
  ipcMain.handle(
    "dialog:choose-directory",
    async (_e, defaultPath?: string): Promise<string | null> => {
      const win = BrowserWindow.getFocusedWindow() ?? mainWindow ?? undefined;
      const result = win
        ? await dialog.showOpenDialog(win, {
            properties: ["openDirectory", "createDirectory"],
            defaultPath,
          })
        : await dialog.showOpenDialog({
            properties: ["openDirectory", "createDirectory"],
            defaultPath,
          });
      if (result.canceled || result.filePaths.length === 0) return null;
      return result.filePaths[0];
    },
  );

  ipcMain.handle(
    "audio:transcribe",
    async (
      _e,
      { base64: _base64, model: _model }: { base64: string; model: string },
    ) => {
      // Audio transcription via MLX is not yet supported
      // Return empty text so the UI doesn't break
      return { text: "" };
    },
  );

  createWindow();

  app.on("activate", function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  // On macOS, keep the app alive in the dock so reopening is instant and the
  // MLX subprocess + workspace server stay warm. Only non-darwin platforms
  // quit on last-window-close.
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  killAllBackgroundTasks();
  stopServer();
  stopWorkspaceServer();
});
