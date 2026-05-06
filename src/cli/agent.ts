import { chatStream, type MLXChatMessage } from "../main/mlx";
import { existsSync } from "node:fs";
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
import { formatSystemPromptDisplay, saveLastPrompt } from "../main/debugPrompt";
import { buildPlanReviewPrompt } from "../main/plan/reviewPrompt";
import { validatePlanForExecution } from "../main/plan/validation";
import {
  createPlanStepEvidence,
  forcedVerifyFailureReason,
  recordPlanToolEvidence,
} from "../main/plan/evidence";
import { killBackgroundTasksForConversation } from "../main/backgroundTasks";
import {
  loadCliConversation,
  saveCliConversation,
  type CliConversationSnapshot,
} from "./conversation";

const MAX_ROUNDS_CHAT = 8;
const MAX_ROUNDS_CODE = 40;
const MAX_NESTED_PLAN_REJECTIONS = 3;
const CODE_PLAN_NUDGE =
  "Continue in planning mode. Your next response must be exactly one action tag that inspects the project, such as list_files or read_file. Do not emit a <plan> until after tool results show the exact source files, test paths, and verification commands the plan will name. Do not write files before the plan.";
const INCOMPLETE_ACTION_NUDGE =
  "Your previous response started an <action> tag but did not close it with </action>. Re-send exactly one complete action tag now, or write a brief plain-text summary if no action is needed.";
const MAX_PLAN_REVIEW_ATTEMPTS = 2;

export interface AgentRunOptions {
  mode: "chat" | "code";
  model: string;
  prompt: string;
  enableBash: boolean;
  worktree: boolean;
  initialPlanXml?: string;
  harnessMode?: "active" | "passive";
}

export interface ContinueRunOptions {
  conversationPath: string;
  prompt: string;
  model?: string;
  enableBash: boolean;
}

function out(s: string): void {
  process.stdout.write(s);
}

function meta(line: string): void {
  process.stdout.write(`\n[cli] ${line}\n`);
}

function displaySystemPrompt(label: string, content: string): void {
  out(`\n${formatSystemPromptDisplay(label, content)}\n`);
}

function displayHarnessPrompt(label: string, content: string): void {
  out(
    [
      "",
      `HARNESS PROMPT: ${label}`,
      "=".repeat(80),
      content,
      "=".repeat(80),
      "",
    ].join("\n"),
  );
}

function pushHarnessPrompt(
  messages: MLXChatMessage[],
  label: string,
  content: string,
): void {
  displayHarnessPrompt(label, content);
  messages.push({ role: "user", content });
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
    messages.push({ role: "user", content: opts.prompt });

    const ctx: ToolContext = {
      conversationId,
      onFileChange: () => {
        /* no-op in CLI */
      },
    };

    const maxRounds = opts.mode === "code" ? MAX_ROUNDS_CODE : MAX_ROUNDS_CHAT;
    const initialPlan = opts.initialPlanXml
      ? parseInitialPlan(opts.initialPlanXml)
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
  let pendingPlanReview = false;
  let planReviewAttempts = 0;
  let lastActionKey: string | null = null;
  let repeatedActionCount = 0;
  let stepEvidence = createPlanStepEvidence();

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
    displaySystemPrompt("plan execution", planExecutionSystemPrompt);
    meta("system prompt: plan execution");
  };

  const harnessMode = opts.harnessMode ?? "active";

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
    if (next.kind === "step") {
      stepEvidence = createPlanStepEvidence();
    }
    pushHarnessPrompt(messages, next.kind, next.text);
    awaitingVerify = next.kind === "verify";
  }

  for (let round = 0; round < maxRounds; round++) {
    meta(`--- round ${round + 1} ---`);
    let buffer = "";
    try {
      saveLastPrompt(messages, { mode: opts.mode, model: opts.model });
    } catch {
      /* debug aid only */
    }
    for await (const chunk of chatStream({
      model: opts.model,
      messages,
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

    if (action && action !== "incomplete") {
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
        messages.push({
          role: "tool",
          content: `[error] run_bash: blocked by CLI policy (RUN_BASH not set)`,
        });
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
      const resPreview = result.slice(0, 200).replace(/\n/g, " ");
      meta(
        `result (${result.length} chars): ${resPreview}${result.length > 200 ? "…" : ""}`,
      );

      messages.push({
        role: "assistant",
        content: buffer.slice(0, action.end),
      });
      messages.push({
        role: "tool",
        content: `[ok] ${action.name}: ${result}`,
      });
      if (planState?.currentStepId) {
        recordPlanToolEvidence(stepEvidence, action.name, result);
      }
      if (repeatedActionCount > 1) {
        pushHarnessPrompt(
          messages,
          "repeated action",
          `You repeated the same ${action.name} action ${repeatedActionCount} times. Use the tool result already provided and move to the next distinct action or emit a concrete <plan>. Do not call ${action.name} with the same parameters again.`,
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
      const forcedReason =
        vr.result === "pass"
          ? forcedVerifyFailureReason(
              planState.currentVerifyCriterion() ?? "",
              stepEvidence,
            )
          : null;
      if (forcedReason) {
        meta(`verify pass overridden: ${forcedReason}`);
        vr = { result: "fail", reason: forcedReason };
      }
      messages.push({ role: "assistant", content: buffer });
      const outcome = planState.applyVerify(vr);
      logPlanEvents();
      awaitingVerify = false;
      if (outcome === "abort" || planState.state !== "running") {
        meta(`done — plan ${planState.state}`);
        return;
      }
      const next = planState.nextPrompt();
      if (!next) {
        meta("done — plan complete");
        return;
      }
      if (next.kind === "step") {
        stepEvidence = createPlanStepEvidence();
      }
      pushHarnessPrompt(messages, next.kind, next.text);
      awaitingVerify = next.kind === "verify";
      continue;
    }

    const planFound = findNextPlan(buffer);
    if (planFound && planFound !== "incomplete") {
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
            "You emitted a <plan> while inside an active plan step. That is not allowed and the plan was discarded. Do the work for the current step directly using <action> tags, or write a brief plain-text summary if no tools are needed. If the step is too large, do what you can and let verify fail with a reason describing what's left.",
          );
        } else {
          if (!pendingPlanReview) {
            pendingPlanReview = true;
            planReviewAttempts = 1;
            meta("reviewing proposed plan before execution");
            pushHarnessPrompt(
              messages,
              "plan review",
              buildPlanReviewPrompt(planFound.raw),
            );
            continue;
          }
          const validation = validatePlanForExecution(planFound);
          if (!validation.valid) {
            messages.push({ role: "assistant", content: buffer });
            pendingPlanReview = false;
            pushHarnessPrompt(
              messages,
              "plan rejected - gather context",
              `The reviewed plan is not executable yet: ${validation.reason}\n\nYour next response must be exactly one action tag that inspects the project, such as list_files or read_file. Do not emit another <plan> until you have tool evidence for the exact file paths and commands the plan will name.`,
            );
            continue;
          }
          pendingPlanReview = false;
          planState = new PlanExecutionState(planFound);
          usePlanExecutionPrompt();
        }
      } catch (e) {
        meta(`plan rejected: ${(e as Error).message}`);
        return;
      }
      logPlanEvents();
      const next = planState.nextPrompt();
      if (!next) {
        meta("done — plan complete");
        return;
      }
      if (next.kind === "step") {
        stepEvidence = createPlanStepEvidence();
      }
      pushHarnessPrompt(messages, next.kind, next.text);
      awaitingVerify = next.kind === "verify";
      continue;
    }

    if (pendingPlanReview) {
      messages.push({ role: "assistant", content: buffer });
      if (planReviewAttempts >= MAX_PLAN_REVIEW_ATTEMPTS) {
        meta("done - plan review did not return a complete plan");
        return;
      }
      planReviewAttempts += 1;
      pushHarnessPrompt(
        messages,
        "plan review retry",
        "The plan review response did not include one complete final <plan>. Explain the gap briefly, then emit one amended complete <plan> now.",
      );
      continue;
    }

    if (planState) {
      messages.push({ role: "assistant", content: buffer });
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
      if (next.kind === "step") {
        stepEvidence = createPlanStepEvidence();
      }
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

    meta("done — no more actions");
    return;
  }

  meta(`stopped at max rounds (${maxRounds})`);
}

function parseInitialPlan(planXml: string): ParsedPlan {
  const plan = findNextPlan(planXml);
  if (!plan || plan === "incomplete" || plan.steps.length === 0) {
    throw new Error("execute-plan requires one complete <plan> with steps");
  }
  return plan;
}
