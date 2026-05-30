import { chatStream, type MLXChatMessage } from "../main/mlx";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import {
  chatSystemPrompt,
  codeSystemPrompt,
  findNextAction,
  runTool,
  type ToolContext,
} from "../main/tools";
import {
  ensureWorkspace,
  startWorkspaceServer,
  stopWorkspaceServer,
  previewUrl,
  setWorkspaceOverride,
  clearWorkspaceOverride,
} from "../main/workspace";
import { ensureMlxRunning, stopMlxServer } from "./setup";
import { cleanupHint, prepareProjectRootForRun } from "./worktree";
import {
  findNextPlan,
  parseVerifyResult,
  type ParsedPlan,
} from "../main/plan/parser";
import { PlanExecutionState } from "../main/plan/executionState";
import { saveLastPrompt } from "../main/debugPrompt";
import {
  buildExecutablePlanValidationPrompt,
  validatePlanForExecution,
} from "../main/plan/validation";
import {
  applyPlanAssemblyResponse,
  buildPlanAssemblyInitialPrompt,
  applyPlanSemanticReviewResponse,
  buildPlanSemanticReviewMessages,
  createPlanAssemblyState,
  isPlanAssemblyDoneResponse,
  type PlanAssemblyState,
} from "../main/plan/assembly";
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
} from "../main/plan/evidence";
import { killBackgroundTasksForConversation } from "../main/backgroundTasks";
import {
  loadCliConversation,
  saveCliConversation,
} from "./conversation";
import { appendToolResultMessage } from "../main/chatHistory";
import {
  buildReadOnlyRequestToolBlockMessage,
  isFileMutationToolName,
  requestForbidsFileMutation,
} from "../main/plan/requestPolicy";

export {
  buildIncompleteStepPrompt,
  hasSatisfiedReadOnlyStepEvidence,
} from "../main/plan/evidence";

const MAX_ROUNDS_CHAT = 8;
const MAX_ROUNDS_CODE = 40;
const MAX_NESTED_PLAN_REJECTIONS = 3;
const MAX_PLAN_ASSEMBLY_VALIDATION_RETRIES = 6;
const MAX_PLAN_SEMANTIC_REVIEW_RETRIES = 4;
const CODE_PLAN_NUDGE =
  "Continue in planning mode. Use an action to inspect files if you need more context, or emit exactly one YAML plan step when another executable instruction is needed. Do not write files before the assembled plan is approved.";
const PLAN_ONLY_CONTINUE_NUDGE =
  "Continue in plan-only mode. Emit exactly one YAML plan step when another executable instruction is needed. Do not write files, do not emit verify tags, and do not stop with plain prose until the plan has enough concrete steps.";
const INCOMPLETE_ACTION_NUDGE =
  'Your previous response started an <action> tag but did not close it with </action>. Re-send exactly one complete action tag now. If no action can be taken, reply exactly with <error reason="short reason"/>. Do not emit a verify tag about the malformed response.';
const MAX_PLAN_ONLY_NUDGES = 3;
const MAX_CODE_NO_PROGRESS_NUDGES = 3;
const REPEATED_FAILED_EDIT_THRESHOLD = 2;
const FAILED_EDIT_PREVIEW_CHARS = 240;
type PlanCompletionMode = "executable" | "model-done";
type AssembledPlanHandlingResult = "retry" | "done" | "started";

export interface AgentRunOptions {
  mode: "chat" | "code";
  model: string;
  prompt: string;
  enableBash: boolean;
  worktree: boolean;
  initialPlanYaml?: string;
  harnessMode?: "active" | "passive";
  planOnly?: boolean;
  planCompletionMode?: PlanCompletionMode;
  approveBeforeExecute?: boolean;
}

export interface ContinueRunOptions {
  conversationPath: string;
  prompt: string;
  model?: string;
  enableBash: boolean;
}

interface PlanInspectionEvidence {
  listedFiles: boolean;
  readPaths: Set<string>;
  bashCommands: string[];
}

interface PlanAssemblyBufferCheck {
  planStateActive: boolean;
  planAssemblyState: PlanAssemblyState | null;
  planFound: ParsedPlan | "incomplete" | null;
  buffer: string;
}

const TOOL_ERROR_RESULT_RE =
  /^(Error\b|Error reading|Error editing|Error writing|Error deleting|Error fetching)/i;

function out(s: string): void {
  process.stdout.write(s);
}

function meta(line: string): void {
  process.stdout.write(`\n[cli] ${line}\n`);
}

async function askForPlanApproval(): Promise<boolean> {
  if (!stdin.isTTY) {
    meta("plan approval requested but stdin is not interactive");
    return false;
  }
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await rl.question("\nApprove this plan for execution? [y/N] ");
    return /^(?:y|yes)$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

function displaySystemPrompt(_label: string, _content: string): void {
  return;
}

function displayHarnessPrompt(_label: string, _content: string): void {
  return;
}

function pushHarnessPrompt(
  messages: MLXChatMessage[],
  label: string,
  content: string,
): void {
  displayHarnessPrompt(label, content);
  messages.push({ role: "user", content });
}

export function createPlanInspectionEvidence(): PlanInspectionEvidence {
  return {
    listedFiles: false,
    readPaths: new Set(),
    bashCommands: [],
  };
}

export function recordPlanInspectionEvidence(
  evidence: PlanInspectionEvidence,
  actionName: string,
  actionArgs: Record<string, unknown>,
  result: string,
): void {
  if (TOOL_ERROR_RESULT_RE.test(result.trimStart())) return;
  if (actionName === "list_files") {
    evidence.listedFiles = true;
    return;
  }
  if (actionName === "read_file") {
    const path = actionArgs.path;
    if (typeof path === "string" && path.length > 0) {
      evidence.readPaths.add(path);
    }
    return;
  }
  if (actionName === "run_bash") {
    const command = actionArgs.command;
    if (typeof command === "string" && command.length > 0) {
      evidence.bashCommands.push(command);
    }
  }
}

export function shouldHandlePlanAssemblyBuffer(
  check: PlanAssemblyBufferCheck,
): boolean {
  if (check.planFound && check.planFound !== "incomplete") return true;
  if (check.planStateActive) return false;
  if (!check.planAssemblyState) return false;
  if (isPlanAssemblyDoneResponse(check.buffer)) return true;
  return (
    check.planAssemblyState.steps.length > 0 &&
    check.planFound === null &&
    check.buffer.trim().length > 0
  );
}

export function buildRepeatedActionPrompt(
  _opts: AgentRunOptions,
  _evidence: PlanInspectionEvidence,
  actionName: string,
  repeatedActionCount: number,
): string {
  return [
    `You repeated the same ${actionName} action ${repeatedActionCount} times.`,
    "Use the existing tool result already provided in this conversation and move to the next distinct action.",
    'If the required tool result is not visible or is not usable, reply exactly with <error reason="short reason"/>.',
    "Do not assume hidden output, wait silently, or continue from guessed file information.",
    "Do not emit a YAML plan while recovering from a repeated action.",
    `Do not call ${actionName} with the same parameters again.`,
  ].join(" ");
}

export function buildCodeNoProgressPrompt(
  _opts: AgentRunOptions,
  _evidence: PlanInspectionEvidence,
): string {
  return CODE_PLAN_NUDGE;
}

export function buildPlanAmendmentPrompt(
  reason: string,
): string {
  return buildExecutablePlanValidationPrompt(reason);
}

export function buildEditFailureRecoveryPrompt(path: string): string {
  return [
    "The edit_file action failed because old_string could not be applied safely.",
    "Before retrying the edit, running tests, or verifying, reread the target file and use its exact current contents.",
    "Your next response must be exactly this action tag and nothing else:",
    `<action name="read_file">`,
    `<path>${path}</path>`,
    `</action>`,
  ].join("\n");
}

export function buildRepeatedEditFailureRecoveryPrompt(
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

export function buildPrematureVerifyPrompt(reason: string | null): string {
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

export function buildRepeatedRecoveryReadPrompt(path: string): string {
  return [
    `You are recovering from a failed edit_file action for ${path}.`,
    "The file has already been reread and the tool result is already in the conversation.",
    "Your next response must be exactly one write_file action for this same path and nothing else.",
    "The write_file content must preserve the current file content and apply the requested change.",
    "Do not emit read_file, edit_file, run_bash, run_project_script, verify, or a plan.",
  ].join("\n");
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

export async function runChat(opts: AgentRunOptions): Promise<void> {
  const conversationId = `cli-${Date.now()}`;
  const repoRoot = process.cwd();
  const messages: MLXChatMessage[] = [];
  let planExecutionSystemPrompt: string | null = null;
  let projectRoot = repoRoot;
  // CLI runs against the current working directory rather than the per-id
  // sandbox the Electron app uses. Tools (write_file, list_files, run_bash,
  // etc.) operate on real project files; rely on git for isolation.
  const runRoot = await prepareProjectRootForRun({
    repoRoot,
    conversationId,
    worktree: opts.worktree,
  });
  projectRoot = runRoot.projectRoot;
  setWorkspaceOverride(conversationId, projectRoot);
  let startedMlxServer = false;
  try {
    if (runRoot.createdWorktree) {
      meta(`worktree:  ${runRoot.createdWorktree.path}`);
      meta(`branch:    ${runRoot.createdWorktree.branch}`);
    }
    startedMlxServer = await ensureMlxRunning(opts.model);
    await startWorkspaceServer();

    if (opts.mode === "code") {
      const wsPath = await ensureWorkspace(conversationId);
      const href = previewUrl(conversationId);
      const systemPrompt = codeSystemPrompt(wsPath, href, "plan");
      messages.push({
        role: "system",
        // CLI always runs against the user's current directory, so it is
        // always Code mode (never the per-conversation sandbox).
        content: systemPrompt,
      });
      displaySystemPrompt("code plan", systemPrompt);
      planExecutionSystemPrompt = codeSystemPrompt(wsPath, href, "execute");
      meta(`workspace: ${wsPath} (cwd)`);
      meta(`preview:   ${href}`);
    } else {
      const systemPrompt = chatSystemPrompt(true /* enableTools */);
      messages.push({
        role: "system",
        content: systemPrompt,
      });
      displaySystemPrompt("chat", systemPrompt);
      meta(`cwd:       ${projectRoot}`);
    }
    messages.push({
      role: "user",
      content:
        opts.mode === "code" && !opts.initialPlanYaml
          ? buildPlanAssemblyInitialPrompt(opts.prompt)
          : opts.prompt,
    });

    const ctx: ToolContext = {
      conversationId,
      onFileChange: () => {
        /* no-op in CLI */
      },
    };

    const maxRounds = opts.mode === "code" ? MAX_ROUNDS_CODE : MAX_ROUNDS_CHAT;
    const initialPlan = opts.initialPlanYaml
      ? parseInitialPlan(opts.initialPlanYaml)
      : null;
    await runAgentLoop(
      opts,
      messages,
      ctx,
      maxRounds,
      planExecutionSystemPrompt,
      initialPlan,
    );
  } finally {
    if (messages.length > 0) {
      const savedPath = saveCliConversation(repoRoot, {
        conversationId,
        mode: opts.mode,
        model: opts.model,
        repoRoot,
        projectRoot,
        messages,
        planExecutionSystemPrompt,
      });
      meta(`conversation: ${savedPath}`);
    }
    const killedTasks = killBackgroundTasksForConversation(conversationId);
    if (killedTasks.length > 0) {
      meta(
        `stopped ${killedTasks.length} background task${killedTasks.length === 1 ? "" : "s"}`,
      );
    }
    stopWorkspaceServer();
    if (startedMlxServer) {
      stopMlxServer();
    }
    if (runRoot.createdWorktree) {
      meta(cleanupHint(runRoot.createdWorktree));
    }
    clearWorkspaceOverride(conversationId);
  }
}

export async function runContinue(opts: ContinueRunOptions): Promise<void> {
  const snapshot = loadCliConversation(opts.conversationPath);
  const model = opts.model ?? snapshot.model;
  const messages: MLXChatMessage[] = [
    ...snapshot.messages,
    { role: "user", content: opts.prompt },
  ];
  setWorkspaceOverride(snapshot.conversationId, snapshot.projectRoot);
  let startedMlxServer = false;
  try {
    if (!existsSync(snapshot.projectRoot)) {
      throw new Error(`Conversation workspace is missing: ${snapshot.projectRoot}`);
    }
    startedMlxServer = await ensureMlxRunning(model);
    await startWorkspaceServer();
    displaySystemPrompt("continued conversation", messages[0]?.content ?? "");
    meta(`conversation: ${opts.conversationPath}`);
    meta(`workspace: ${snapshot.projectRoot}`);

    const ctx: ToolContext = {
      conversationId: snapshot.conversationId,
      onFileChange: () => {
        /* no-op in CLI */
      },
    };
    const maxRounds =
      snapshot.mode === "code" ? MAX_ROUNDS_CODE : MAX_ROUNDS_CHAT;
    await runAgentLoop(
      {
        mode: snapshot.mode,
        model,
        prompt: opts.prompt,
        enableBash: opts.enableBash,
        worktree: false,
        harnessMode: "passive",
      },
      messages,
      ctx,
      maxRounds,
      snapshot.planExecutionSystemPrompt,
    );
  } finally {
    const savedPath = saveCliConversation(snapshot.repoRoot, {
      ...snapshot,
      model,
      messages,
    });
    meta(`conversation: ${savedPath}`);
    const killedTasks = killBackgroundTasksForConversation(snapshot.conversationId);
    if (killedTasks.length > 0) {
      meta(
        `stopped ${killedTasks.length} background task${killedTasks.length === 1 ? "" : "s"}`,
      );
    }
    stopWorkspaceServer();
    if (startedMlxServer) {
      stopMlxServer();
    }
    clearWorkspaceOverride(snapshot.conversationId);
  }
}

async function runAgentLoop(
  opts: AgentRunOptions,
  messages: MLXChatMessage[],
  ctx: ToolContext,
  maxRounds: number,
  planExecutionSystemPrompt: string | null,
  initialPlan: ParsedPlan | null = null,
): Promise<void> {
  let planState: PlanExecutionState | null = null;
  let awaitingVerify = false;
  let nestedPlanRejections = 0;
  let planAssemblyState: PlanAssemblyState | null =
    opts.mode === "code" && !initialPlan ? createPlanAssemblyState() : null;
  let planSemanticReviewPlan: ParsedPlan | null = null;
  let planSemanticReviewMessages: MLXChatMessage[] | null = null;
  let planSemanticReviewRetries = 0;
  let planAssemblyValidationRetries = 0;
  let lastActionKey: string | null = null;
  let repeatedActionCount = 0;
  let planOnlyNudges = 0;
  let codeNoProgressNudges = 0;
  let stepEvidence = createPlanStepEvidence();
  let stepEvidenceStepId: string | null = null;
  const failedEditCounts = new Map<string, number>();
  let pendingEditRecoveryPath: string | null = null;
  const planInspectionEvidence = createPlanInspectionEvidence();

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
    pendingEditRecoveryPath = null;
  };

  const resetStepAttemptTracking = (): void => {
    lastActionKey = null;
    repeatedActionCount = 0;
    stepEvidence = createPlanStepEvidence();
    stepEvidenceStepId = null;
    pendingEditRecoveryPath = null;
  };

  const logPlanEvents = (): void => {
    if (!planState) return;
    for (const ev of planState.drainEvents()) {
      if (ev.type === "plan_node_start") {
        meta(
          `plan: start ${ev.kind}${ev.name ? ` "${ev.name}"` : ""} (${ev.id})`,
        );
      } else {
        meta(`plan: end ${ev.kind} (${ev.id}) ${ev.status}`);
      }
    }
  };

  const usePlanExecutionPrompt = (): void => {
    if (!planExecutionSystemPrompt || messages[0]?.role !== "system") return;
    messages[0] = {
      role: "system",
      content: planExecutionSystemPrompt,
    };
    displaySystemPrompt("code execute", planExecutionSystemPrompt);
    meta("system prompt: code execute");
  };

  const startPlanSemanticReview = (plan: ParsedPlan): void => {
    const reviewMessages = buildPlanSemanticReviewMessages(
      plan,
      opts.prompt,
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
    displaySystemPrompt("plan semantic review", systemMessage.content);
    displayHarnessPrompt("plan semantic review", userMessage.content);
    meta("system prompt: plan semantic review");
  };

  const handleAssembledPlan = async (
    plan: ParsedPlan,
  ): Promise<AssembledPlanHandlingResult> => {
    const validation = validatePlanForExecution(plan);
    if (!validation.valid) {
      pushHarnessPrompt(
        messages,
        "plan assembly validation",
        buildPlanAmendmentPrompt(validation.reason),
      );
      return "retry";
    }
    meta("assembled plan ready");
    out(`\n${plan.raw}\n`);
    messages.push({ role: "assistant", content: plan.raw });
    if (opts.planOnly) {
      meta("done — assembled plan ready");
      return "done";
    }
    if (opts.approveBeforeExecute) {
      const approved = await askForPlanApproval();
      if (!approved) {
        meta("done — plan execution not approved");
        return "done";
      }
      meta("plan approved");
    }
    planState = new PlanExecutionState(plan);
    usePlanExecutionPrompt();
    return "started";
  };

  const harnessMode = opts.harnessMode ?? "active";
  const readOnlyRequest = requestForbidsFileMutation(opts.prompt);

  if (initialPlan) {
    if (opts.mode !== "code") {
      throw new Error("Initial plan execution is only supported in code mode");
    }
    planState = new PlanExecutionState(initialPlan);
    usePlanExecutionPrompt();
    logPlanEvents();
    const next = planState.nextPrompt();
    if (!next) {
      meta("done — plan complete");
      return;
    }
    prepareStepEvidence(next);
    pushHarnessPrompt(messages, next.kind, next.text);
    awaitingVerify = next.kind === "verify";
  }

  for (let round = 0; round < maxRounds; round++) {
    meta(`--- round ${round + 1} ---`);
    let buffer = "";
    const requestMessages = planSemanticReviewMessages ?? messages;
    try {
      saveLastPrompt(requestMessages, { mode: opts.mode, model: opts.model });
    } catch {
      /* debug aid only */
    }
    for await (const chunk of chatStream({
      model: opts.model,
      messages: requestMessages,
    })) {
      if (chunk.content) {
        buffer += chunk.content;
        out(chunk.content);
      }
    }
    out("\n");

    if (harnessMode === "passive") {
      messages.push({ role: "assistant", content: buffer });
      meta("done — passive continue response");
      return;
    }

    const action = findNextAction(buffer);

    if (action === "incomplete") {
      meta("incomplete action; requesting a complete action tag");
      pushHarnessPrompt(messages, "incomplete action", INCOMPLETE_ACTION_NUDGE);
      continue;
    }

    if (action) {
      const actionKey = `${action.name}:${JSON.stringify(action.args)}`;
      if (actionKey === lastActionKey) {
        repeatedActionCount += 1;
      } else {
        lastActionKey = actionKey;
        repeatedActionCount = 1;
      }

      if (action.name === "run_bash" && !opts.enableBash) {
        meta(
          "run_bash blocked (set RUN_BASH=1 to allow). Stopping to avoid skewing the test.",
        );
        messages.push({
          role: "assistant",
          content: buffer.slice(0, action.end),
        });
        appendToolResultMessage(messages, {
          toolName: "run_bash",
          args: action.args,
          result: "blocked by CLI policy (RUN_BASH not set)",
          hadError: true,
        });
        continue;
      }

      if (planState?.currentStepId && !awaitingVerify && action.name === "verify") {
        const criterion = planState.currentStepEvidenceCriterion() ?? "";
        const forcedReason = forcedVerifyFailureReason(criterion, stepEvidence);
        const resultText =
          typeof action.args.result === "string"
            ? action.args.result.toLowerCase()
            : "";
        const reason =
          typeof action.args.reason === "string"
            ? action.args.reason
            : undefined;
        if (resultText === "fail" && forcedReason) {
          pushHarnessPrompt(
            messages,
            "step incomplete",
            buildIncompleteStepPrompt(forcedReason),
          );
          continue;
        }
        if (
          resultText === "fail" &&
          reason &&
          !isContradictedBySuccessfulEvidence(reason, criterion, stepEvidence)
        ) {
          meta(`step attempt failed: ${reason}`);
          const outcome = planState.failCurrentStepAttempt(reason);
          logPlanEvents();
          awaitingVerify = false;
          resetStepAttemptTracking();
          if (outcome === "abort" || planState.state !== "running") {
            meta(`done — plan ${planState.state}`);
            return;
          }
        } else {
          planState.finishStepBody();
          logPlanEvents();
        }
        const next = planState.nextPrompt();
        if (!next) {
          meta("done — plan complete");
          return;
        }
        prepareStepEvidence(next);
        pushHarnessPrompt(messages, next.kind, next.text);
        awaitingVerify = next.kind === "verify";
        continue;
      }

      if (readOnlyRequest && isFileMutationToolName(action.name)) {
        const result = buildReadOnlyRequestToolBlockMessage(action.name);
        meta(`tool blocked by read-only request: ${action.name}`);
        messages.push({
          role: "assistant",
          content: buffer.slice(0, action.end),
        });
        appendToolResultMessage(messages, {
          toolName: action.name,
          args: action.args,
          result,
          hadError: true,
        });
        pushHarnessPrompt(messages, "read-only request policy", result);
        continue;
      }

      meta(`tool: ${action.name}`);
      for (const [k, v] of Object.entries(action.args)) {
        const preview = String(v).slice(0, 80).replace(/\n/g, "\\n");
        meta(`  ${k}: ${preview}${String(v).length > 80 ? "…" : ""}`);
      }

      let result: string;
      try {
        result = await runTool(action.name, action.args, ctx);
      } catch (e) {
        result = `Error: ${(e as Error).message}`;
      }
      if (!planState) {
        recordPlanInspectionEvidence(
          planInspectionEvidence,
          action.name,
          action.args,
          result,
        );
        planOnlyNudges = 0;
      }
      const resPreview = result.slice(0, 200).replace(/\n/g, " ");
      meta(
        `result (${result.length} chars): ${resPreview}${result.length > 200 ? "…" : ""}`,
      );

      messages.push({
        role: "assistant",
        content: buffer.slice(0, action.end),
      });
      appendToolResultMessage(messages, {
        toolName: action.name,
        args: action.args,
        result,
        hadError: false,
      });
      if (planState?.currentStepId) {
        recordPlanToolEvidence(stepEvidence, action.name, result, action.args);
      }
      if (
        planState?.currentStepId &&
        !awaitingVerify &&
        hasSatisfiedReadOnlyStepEvidence(
          planState.currentStepEvidenceCriterion() ?? "",
          stepEvidence,
        )
      ) {
        meta("read/inspection evidence satisfied; advancing to verify");
        planState.finishStepBody();
        logPlanEvents();
        if (planState.state !== "running") {
          meta(`done — plan ${planState.state}`);
          return;
        }
        const next = planState.nextPrompt();
        if (!next) {
          meta("done — plan complete");
          return;
        }
        prepareStepEvidence(next);
        pushHarnessPrompt(messages, next.kind, next.text);
        awaitingVerify = next.kind === "verify";
        continue;
      }
      if (
        planState?.currentStepId &&
        !awaitingVerify &&
        hasGuardedAlreadyPresentEvidence(
          planState.currentStepEvidenceCriterion() ?? "",
          stepEvidence,
        )
      ) {
        meta("guarded existing implementation detected; advancing to verify");
        planState.finishStepBody();
        logPlanEvents();
        if (planState.state !== "running") {
          meta(`done — plan ${planState.state}`);
          return;
        }
        const next = planState.nextPrompt();
        if (!next) {
          meta("done — plan complete");
          return;
        }
        prepareStepEvidence(next);
        pushHarnessPrompt(messages, next.kind, next.text);
        awaitingVerify = next.kind === "verify";
        continue;
      }
      if (
        planState?.currentStepId &&
        !awaitingVerify &&
        hasSuccessfulRequiredCommandEvidence(
          planState.currentVerifyCriterion() ?? "",
          stepEvidence,
        )
      ) {
        meta("required command evidence satisfied; advancing to verify");
        planState.finishStepBody();
        logPlanEvents();
        if (planState.state !== "running") {
          meta(`done — plan ${planState.state}`);
          return;
        }
        const next = planState.nextPrompt();
        if (!next) {
          meta("done — plan complete");
          return;
        }
        prepareStepEvidence(next);
        pushHarnessPrompt(messages, next.kind, next.text);
        awaitingVerify = next.kind === "verify";
        continue;
      }
      codeNoProgressNudges = 0;
      planOnlyNudges = 0;
      if (
        action.name === "edit_file" &&
        isRecoverableEditFailureResult(result) &&
        typeof action.args.path === "string"
      ) {
        pendingEditRecoveryPath = action.args.path;
        const failedEdit = buildFailedEditKey(action.args);
        const failedEditAttempts = failedEdit
          ? (failedEditCounts.get(failedEdit.key) ?? 0) + 1
          : 1;
        if (failedEdit) {
          failedEditCounts.set(failedEdit.key, failedEditAttempts);
        }
        pushHarnessPrompt(
          messages,
          failedEditAttempts >= REPEATED_FAILED_EDIT_THRESHOLD
            ? "edit failed - repeated old string"
            : "edit failed - reread target",
          failedEdit && failedEditAttempts >= REPEATED_FAILED_EDIT_THRESHOLD
            ? buildRepeatedEditFailureRecoveryPrompt(
                failedEdit.path,
                failedEdit.oldString,
                failedEditAttempts,
              )
            : buildEditFailureRecoveryPrompt(action.args.path),
        );
        continue;
      }
      if (action.name === "edit_file") {
        const failedEdit = buildFailedEditKey(action.args);
        if (failedEdit && !isRecoverableEditFailureResult(result)) {
          failedEditCounts.delete(failedEdit.key);
        }
        if (
          typeof action.args.path === "string" &&
          action.args.path === pendingEditRecoveryPath &&
          !isRecoverableEditFailureResult(result)
        ) {
          pendingEditRecoveryPath = null;
        }
      }
      if (
        action.name === "write_file" &&
        typeof action.args.path === "string" &&
        action.args.path === pendingEditRecoveryPath &&
        !result.startsWith("Error")
      ) {
        pendingEditRecoveryPath = null;
      }
      if (repeatedActionCount > 1) {
        if (
          action.name === "read_file" &&
          typeof action.args.path === "string" &&
          action.args.path === pendingEditRecoveryPath
        ) {
          pushHarnessPrompt(
            messages,
            "edit recovery read repeated",
            buildRepeatedRecoveryReadPrompt(action.args.path),
          );
          continue;
        }
        const repeatedFailureReason =
          planState?.currentStepId
            ? repeatedActionForcedFailureReason({
                actionName: action.name,
                repeatedActionCount,
                criterion: planState.currentStepEvidenceCriterion() ?? "",
                evidence: stepEvidence,
              })
            : null;
        if (repeatedFailureReason && planState) {
          meta(`step attempt failed: ${repeatedFailureReason}`);
          const outcome = planState.failCurrentStepAttempt(
            repeatedFailureReason,
          );
          logPlanEvents();
          awaitingVerify = false;
          resetStepAttemptTracking();
          if (outcome === "abort" || planState.state !== "running") {
            meta(`done — plan ${planState.state}`);
            return;
          }
          const next = planState.nextPrompt();
          if (!next) {
            meta("done — plan complete");
            return;
          }
          prepareStepEvidence(next);
          pushHarnessPrompt(messages, next.kind, next.text);
          awaitingVerify = next.kind === "verify";
          continue;
        }
        pushHarnessPrompt(
          messages,
          "repeated action",
          buildRepeatedActionPrompt(
            opts,
            planInspectionEvidence,
            action.name,
            repeatedActionCount,
          ),
        );
      }
      continue;
    }

    if (planState && awaitingVerify) {
      let vr = parseVerifyResult(buffer);
      if (!vr) {
        meta("done — verify response missing or malformed");
        return;
      }
      const forcedReason = forcedVerifyFailureReason(
        planState.currentVerifyCriterion() ?? "",
        stepEvidence,
      );
      if (vr.result === "pass" && forcedReason) {
        meta(`verify pass overridden: ${forcedReason}`);
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
      messages.push({ role: "assistant", content: buffer });
      const outcome = planState.applyVerify(vr);
      logPlanEvents();
      awaitingVerify = false;
      if (outcome === "retry") {
        resetStepAttemptTracking();
      }
      if (outcome === "abort" || planState.state !== "running") {
        meta(`done — plan ${planState.state}`);
        return;
      }
      const next = planState.nextPrompt();
      if (!next) {
        meta("done — plan complete");
        return;
      }
      prepareStepEvidence(next);
      pushHarnessPrompt(messages, next.kind, next.text);
      awaitingVerify = next.kind === "verify";
      continue;
    }

    if (planSemanticReviewPlan) {
      const reviewMessages = planSemanticReviewMessages as
        | MLXChatMessage[]
        | null;
      if (!reviewMessages) {
        meta("done - plan semantic review context is missing");
        return;
      }
      reviewMessages.push({ role: "assistant", content: buffer });
      const review = applyPlanSemanticReviewResponse(
        planSemanticReviewPlan,
        buffer,
      );
      if (review.kind === "rejected") {
        planSemanticReviewRetries += 1;
        meta(
          `plan semantic review rejected ${planSemanticReviewRetries}/${MAX_PLAN_SEMANTIC_REVIEW_RETRIES}: ${review.reason}`,
        );
        if (
          planSemanticReviewRetries >= MAX_PLAN_SEMANTIC_REVIEW_RETRIES
        ) {
          meta("done - plan semantic review rejected too many responses");
          return;
        }
        displayHarnessPrompt("plan semantic review retry", review.retryPrompt);
        reviewMessages.push({ role: "user", content: review.retryPrompt });
        continue;
      }
      planSemanticReviewPlan = null;
      planSemanticReviewMessages = null;
      planSemanticReviewRetries = 0;
      planAssemblyState = null;
      planAssemblyValidationRetries = 0;
      const handling = await handleAssembledPlan(review.plan);
      if (handling === "retry") continue;
      if (handling === "done") return;
      logPlanEvents();
      const next = planState?.nextPrompt();
      if (!next) {
        meta("done — plan complete");
        return;
      }
      prepareStepEvidence(next);
      pushHarnessPrompt(messages, next.kind, next.text);
      awaitingVerify = next.kind === "verify";
      continue;
    }

    const planFound = findNextPlan(buffer);
    if (
      shouldHandlePlanAssemblyBuffer({
        planStateActive: !!planState,
        planAssemblyState,
        planFound,
        buffer,
      })
    ) {
      try {
        if (planState) {
          nestedPlanRejections += 1;
          if (nestedPlanRejections > MAX_NESTED_PLAN_REJECTIONS) {
            meta(
              `done - nested plan rejected ${MAX_NESTED_PLAN_REJECTIONS} times`,
            );
            return;
          }
          meta("nested plan rejected; requesting direct step work");
          pushHarnessPrompt(
            messages,
            "nested plan rejection",
            'You emitted a YAML plan while inside an active plan step. That is not allowed and the plan was discarded. Do the work for the current step directly using <action> tags, or write a <summary> of no more than 3 lines if no tools are needed. If you cannot proceed, reply with <error reason="short reason"/>.',
          );
        } else {
          if (!planAssemblyState) {
            meta("done - plan assembly is not active");
            return;
          }
          const assembled = applyPlanAssemblyResponse(
            planAssemblyState,
            buffer,
            opts.prompt,
          );
          planAssemblyState = assembled.state;
          messages.push({ role: "assistant", content: buffer });
          if (assembled.kind === "accepted") {
            planAssemblyValidationRetries = 0;
            pushHarnessPrompt(messages, "plan assembly", assembled.nextPrompt);
            continue;
          } else if (assembled.kind === "rejected") {
            planAssemblyValidationRetries += 1;
            if (
              planAssemblyValidationRetries >=
              MAX_PLAN_ASSEMBLY_VALIDATION_RETRIES
            ) {
              meta("done - plan assembly rejected too many responses");
              return;
            }
            pushHarnessPrompt(
              messages,
              "plan assembly retry",
              assembled.retryPrompt,
            );
            continue;
          } else {
            const validation = validatePlanForExecution(assembled.plan);
            if (!validation.valid) {
              planAssemblyValidationRetries += 1;
              if (
                planAssemblyValidationRetries >=
                MAX_PLAN_ASSEMBLY_VALIDATION_RETRIES
              ) {
                meta("done - assembled plan failed deterministic validation too many times");
                return;
              }
              pushHarnessPrompt(
                messages,
                "plan assembly validation",
                buildPlanAmendmentPrompt(validation.reason),
              );
              continue;
            }
            planAssemblyValidationRetries = 0;
            startPlanSemanticReview(assembled.plan);
            continue;
          }
        }
      } catch (e) {
        meta(`plan rejected: ${(e as Error).message}`);
        return;
      }
      if (!planState) {
        meta("done - plan assembly response handled");
        return;
      }
      logPlanEvents();
      const next = planState.nextPrompt();
      if (!next) {
        meta("done — plan complete");
        return;
      }
      prepareStepEvidence(next);
      pushHarnessPrompt(messages, next.kind, next.text);
      awaitingVerify = next.kind === "verify";
      continue;
    }

    if (planState) {
      const prematureVerify = parseVerifyResult(buffer);
      if (prematureVerify) {
        const criterion = planState.currentStepEvidenceCriterion() ?? "";
        const forcedReason = forcedVerifyFailureReason(criterion, stepEvidence);
        if (
          prematureVerify.result === "fail" &&
          isMalformedActionSelfReport(prematureVerify.reason)
        ) {
          if (forcedReason) {
            pushHarnessPrompt(
              messages,
              "step incomplete",
              buildIncompleteStepPrompt(forcedReason),
            );
            continue;
          }
          planState.finishStepBody();
          logPlanEvents();
          if (planState.state !== "running") {
            meta(`done — plan ${planState.state}`);
            return;
          }
          const next = planState.nextPrompt();
          if (!next) {
            meta("done — plan complete");
            return;
          }
          prepareStepEvidence(next);
          pushHarnessPrompt(messages, next.kind, next.text);
          awaitingVerify = next.kind === "verify";
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
          planState.finishStepBody();
          logPlanEvents();
          if (planState.state !== "running") {
            meta(`done — plan ${planState.state}`);
            return;
          }
          const next = planState.nextPrompt();
          if (!next) {
            meta("done — plan complete");
            return;
          }
          prepareStepEvidence(next);
          pushHarnessPrompt(messages, next.kind, next.text);
          awaitingVerify = next.kind === "verify";
          continue;
        }
        messages.push({ role: "assistant", content: buffer });
        if (prematureVerify.result === "fail") {
          const failureReason =
            prematureVerify.reason ?? forcedReason ?? "premature verify failure";
          meta(`step attempt failed: ${failureReason}`);
          const outcome = planState.failCurrentStepAttempt(failureReason);
          logPlanEvents();
          awaitingVerify = false;
          resetStepAttemptTracking();
          if (outcome === "abort" || planState.state !== "running") {
            meta(`done — plan ${planState.state}`);
            return;
          }
          const next = planState.nextPrompt();
          if (!next) {
            meta("done — plan complete");
            return;
          }
          prepareStepEvidence(next);
          pushHarnessPrompt(messages, next.kind, next.text);
          awaitingVerify = next.kind === "verify";
          continue;
        }
        if (forcedReason) {
          pushHarnessPrompt(
            messages,
            "premature verify",
            buildPrematureVerifyPrompt(forcedReason),
          );
          continue;
        }
        planState.finishStepBody();
        logPlanEvents();
        if (planState.state !== "running") {
          meta(`done — plan ${planState.state}`);
          return;
        }
        const next = planState.nextPrompt();
        if (!next) {
          meta("done — plan complete");
          return;
        }
        prepareStepEvidence(next);
        pushHarnessPrompt(messages, next.kind, next.text);
        awaitingVerify = next.kind === "verify";
        continue;
      }
      const blockedReason = parseBlockedReason(buffer);
      if (blockedReason) {
        messages.push({
          role: "assistant",
          content: `BLOCKED: ${blockedReason}`,
        });
        meta(`step attempt blocked: ${blockedReason}`);
        const outcome = planState.failCurrentStepAttempt(
          `blocked: ${blockedReason}`,
        );
        logPlanEvents();
        awaitingVerify = false;
        resetStepAttemptTracking();
        if (outcome === "abort" || planState.state !== "running") {
          meta(`done — plan ${planState.state}`);
          return;
        }
        const next = planState.nextPrompt();
        if (!next) {
          meta("done — plan complete");
          return;
        }
        prepareStepEvidence(next);
        pushHarnessPrompt(messages, next.kind, next.text);
        awaitingVerify = next.kind === "verify";
        continue;
      }
      const stepSummary = parseStepSummary(buffer);
      const incompleteReason = forcedVerifyFailureReason(
        planState.currentStepEvidenceCriterion() ?? "",
        stepEvidence,
      );
      if (incompleteReason) {
        messages.push({ role: "assistant", content: buffer });
        pushHarnessPrompt(
          messages,
          "step incomplete",
          buildIncompleteStepPrompt(incompleteReason),
        );
        continue;
      }
      if (stepSummary?.kind === "invalid") {
        messages.push({ role: "assistant", content: buffer });
        pushHarnessPrompt(
          messages,
          "summary correction",
          buildStepSummaryCorrectionPrompt(stepSummary.reason),
        );
        continue;
      }
      messages.push({
        role: "assistant",
        content: stepSummary?.kind === "summary" ? stepSummary.text : buffer,
      });
      planState.finishStepBody();
      logPlanEvents();
      if (planState.state !== "running") {
        meta(`done — plan ${planState.state}`);
        return;
      }
      const next = planState.nextPrompt();
      if (!next) {
        meta("done — plan complete");
        return;
      }
      prepareStepEvidence(next);
      pushHarnessPrompt(messages, next.kind, next.text);
      awaitingVerify = next.kind === "verify";
      continue;
    }

    if (opts.mode === "code" && round === 0 && buffer.trim().length > 0) {
      meta("no action in first code response; requesting an action");
      messages.push({ role: "assistant", content: buffer });
      pushHarnessPrompt(messages, "code plan nudge", CODE_PLAN_NUDGE);
      continue;
    }

    if (opts.planOnly && opts.mode === "code") {
      messages.push({ role: "assistant", content: buffer });
      if (planOnlyNudges >= MAX_PLAN_ONLY_NUDGES) {
        meta("done — plan-only mode did not produce a plan");
        return;
      }
      planOnlyNudges += 1;
      pushHarnessPrompt(messages, "plan-only continue", PLAN_ONLY_CONTINUE_NUDGE);
      continue;
    }

    if (opts.mode === "code") {
      messages.push({ role: "assistant", content: buffer });
      if (codeNoProgressNudges >= MAX_CODE_NO_PROGRESS_NUDGES) {
        meta("done — code mode did not produce an action or plan");
        return;
      }
      codeNoProgressNudges += 1;
      pushHarnessPrompt(
        messages,
        "code continue",
        buildCodeNoProgressPrompt(opts, planInspectionEvidence),
      );
      continue;
    }

    meta("done — no more actions");
    return;
  }

  meta(`stopped at max rounds (${maxRounds})`);
}

function parseInitialPlan(planYaml: string): ParsedPlan {
  const plan = findNextPlan(planYaml);
  if (!plan || plan === "incomplete" || plan.steps.length === 0) {
    throw new Error("execute-plan requires one complete YAML plan with steps");
  }
  return plan;
}
