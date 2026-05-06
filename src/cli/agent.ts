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
import { saveLastPrompt } from "../main/debugPrompt";
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
  "Continue in planning mode. Your next response must be exactly one action tag that inspects the project. For a host-project tool change, list_files alone is not enough: inspect src/main/tools.ts, Gemma.md, package.json, and the exact tests/main test file you will name. Do not emit a YAML plan until tool results show the exact source files, test paths, documentation files, and verification commands the plan will name. Do not write files before the plan.";
const PLAN_ONLY_CONTINUE_NUDGE =
  "Continue in plan-only mode. Do not emit a plan if your only evidence is list_files or a source-file read. For a host-project tool change, you need tool evidence for src/main/tools.ts, Gemma.md, package.json, and the exact tests/main test file you will create or update. If any of those are missing, emit exactly one more inspection action, preferably a focused read_file or run_bash search for tests/main tool tests. Once those exact paths and commands are known, emit exactly one complete executable YAML plan. Do not write files, do not emit verify tags, and do not stop without a plan.";
const INCOMPLETE_ACTION_NUDGE =
  "Your previous response started an <action> tag but did not close it with </action>. Re-send exactly one complete action tag now, or write a brief plain-text summary if no action is needed.";
const MAX_PLAN_REVIEW_ATTEMPTS = 2;
const MAX_PLAN_ONLY_NUDGES = 3;
const MAX_CODE_NO_PROGRESS_NUDGES = 3;
const REPEATED_FAILED_EDIT_THRESHOLD = 2;
const FAILED_EDIT_PREVIEW_CHARS = 240;
const HOST_TOOL_CANONICAL_PATHS = [
  "src/main/tools.ts",
  "Gemma.md",
  "package.json",
] as const;

export interface AgentRunOptions {
  mode: "chat" | "code";
  model: string;
  prompt: string;
  enableBash: boolean;
  worktree: boolean;
  initialPlanYaml?: string;
  harnessMode?: "active" | "passive";
  planOnly?: boolean;
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
  testPaths: Set<string>;
}

const TOOL_ERROR_RESULT_RE =
  /^(Error\b|Error reading|Error editing|Error writing|Error deleting|Error fetching)/i;

function out(s: string): void {
  process.stdout.write(s);
}

function meta(line: string): void {
  process.stdout.write(`\n[cli] ${line}\n`);
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
    testPaths: new Set(),
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
      if (/^tests\/main\/.+\.test\.ts$/.test(path)) {
        evidence.testPaths.add(path);
      }
    }
    return;
  }
  if (actionName === "run_bash") {
    const command = actionArgs.command;
    if (typeof command === "string" && command.length > 0) {
      evidence.bashCommands.push(command);
      const combinedOutput = `${command}\n${result}`;
      for (const match of combinedOutput.matchAll(
        /tests\/+main\/[^\s"'<>]+\.test\.ts/g,
      )) {
        evidence.testPaths.add(match[0].replace(/\/+/g, "/"));
      }
    }
  }
}

function hasInspectedPath(
  evidence: PlanInspectionEvidence,
  path: string,
): boolean {
  return (
    evidence.readPaths.has(path) ||
    evidence.bashCommands.some((command) => command.includes(path))
  );
}

function isHostToolRequest(text: string): boolean {
  return (
    /\bget_current_datetime\b/i.test(text) ||
    /\bcurrent\s+date\s+time\b/i.test(text) ||
    /\bcurrent\s+datetime\b/i.test(text) ||
    /\bcurrent\s+working\s+directory\b/i.test(text) ||
    /\bprocess\s+current\s+working\s+directory\b/i.test(text) ||
    /\bget_current_working_directory\b/i.test(text) ||
    /\bnew\s+[^.\n]*tool\b/i.test(text) ||
    /\bcreate\s+[^.\n]*tool\b/i.test(text) ||
    /\badd\s+[^.\n]*tool\b/i.test(text) ||
    /\bsrc\/main\/tools\.ts\b/.test(text)
  );
}

export function findRequestedToolNames(text: string): string[] {
  return [...new Set(text.match(/\bget_current_[a-z_]+\b/g) ?? [])];
}

export function findPlanTestPaths(text: string): string[] {
  return [
    ...new Set(
      [...text.matchAll(/\btests\/+main\/[^\s"'<>]+\.test\.ts\b/g)].map(
        (match) => match[0].replace(/\/+/g, "/"),
      ),
    ),
  ];
}

function findMissingHostToolInspectionEvidence(
  evidence: PlanInspectionEvidence,
): string[] {
  const missing = HOST_TOOL_CANONICAL_PATHS.filter(
    (path) => !hasInspectedPath(evidence, path),
  );
  const hasTestEvidence = evidence.testPaths.size > 0;
  if (!hasTestEvidence) {
    missing.push("one exact tests/main/*.test.ts file or focused tests/main search");
  }
  return missing;
}

function findMissingPlanEvidence(
  opts: AgentRunOptions,
  evidence: PlanInspectionEvidence,
  plan: ParsedPlan,
): string[] {
  if (opts.mode !== "code") return [];
  const actionCount =
    Number(evidence.listedFiles) +
    evidence.readPaths.size +
    evidence.bashCommands.length;
  if (actionCount === 0) {
    return ["at least one inspection action before emitting a plan"];
  }

  const planText = `${opts.prompt}\n${plan.raw}`;
  if (!isHostToolRequest(planText)) return [];

  return findMissingHostToolInspectionEvidence(evidence);
}

function findUninspectedPlanTestPaths(
  plan: ParsedPlan,
  evidence: PlanInspectionEvidence,
): string[] {
  if (evidence.testPaths.size === 0) return [];
  return findPlanTestPaths(plan.raw).filter(
    (path) => !evidence.testPaths.has(path),
  );
}

function nextInspectionPathForMissing(missingEvidence: string[]): string {
  for (const path of HOST_TOOL_CANONICAL_PATHS) {
    if (missingEvidence.includes(path)) return path;
  }
  return "tests/main/currentDatetimeTool.test.ts";
}

function buildInspectionActionForMissing(missingEvidence: string[]): string[] {
  for (const path of HOST_TOOL_CANONICAL_PATHS) {
    if (missingEvidence.includes(path)) {
      return [
        `<action name="read_file">`,
        `<path>${path}</path>`,
        `</action>`,
      ];
    }
  }

  if (
    missingEvidence.some((entry) =>
      entry.includes("one exact tests/main/*.test.ts"),
    )
  ) {
    return [
      `<action name="run_bash">`,
      `<command>rg --files tests/main | rg "Tool|tools|Datetime|WorkingDirectory|ProjectScript|codeSystemPrompt"</command>`,
      `</action>`,
    ];
  }

  const nextPath = nextInspectionPathForMissing(missingEvidence);
  return [
    `<action name="read_file">`,
    `<path>${nextPath}</path>`,
    `</action>`,
  ];
}

function buildPlanEvidencePrompt(missingEvidence: string[]): string {
  return [
    `The plan was emitted before enough planning evidence was gathered. Missing evidence: ${missingEvidence.join(", ")}.`,
    "",
    "Do not emit a plan yet. Your next response must be exactly this action tag and nothing else:",
    ...buildInspectionActionForMissing(missingEvidence),
  ].join("\n");
}

export function buildRepeatedActionPrompt(
  opts: AgentRunOptions,
  evidence: PlanInspectionEvidence,
  actionName: string,
  repeatedActionCount: number,
): string {
  const missingEvidence =
    opts.mode === "code" && isHostToolRequest(opts.prompt)
      ? findMissingHostToolInspectionEvidence(evidence)
      : [];
  if (missingEvidence.length > 0) {
    return [
      `You repeated the same ${actionName} action ${repeatedActionCount} times.`,
      `Missing inspection evidence: ${missingEvidence.join(", ")}.`,
      "Your next response must be exactly this action tag and nothing else:",
      ...buildInspectionActionForMissing(missingEvidence),
    ].join("\n");
  }
  return `You repeated the same ${actionName} action ${repeatedActionCount} times. Use the tool result already provided and move to the next distinct action or emit a concrete YAML plan. Do not call ${actionName} with the same parameters again.`;
}

export function buildCodeNoProgressPrompt(
  opts: AgentRunOptions,
  evidence: PlanInspectionEvidence,
): string {
  const missingEvidence =
    opts.mode === "code" && isHostToolRequest(opts.prompt)
      ? findMissingHostToolInspectionEvidence(evidence)
      : [];
  if (missingEvidence.length > 0) {
    return [
      "You stopped without an action or YAML plan, but the host-project tool plan still needs concrete inspection evidence.",
      `Missing inspection evidence: ${missingEvidence.join(", ")}.`,
      "Your next response must be exactly this action tag and nothing else:",
      ...buildInspectionActionForMissing(missingEvidence),
    ].join("\n");
  }
  if (opts.mode === "code" && isHostToolRequest(opts.prompt)) {
    return [
      "All required host-project tool inspection evidence has been gathered.",
      "Do not use tools. Emit exactly one complete well-formed YAML plan now.",
      "The YAML plan must have top-level plan.steps, and every step must have string name, prompt, and verify fields.",
      "The plan must include grounding, test, implementation, and verification steps with exact file paths and exact commands.",
    ].join("\n");
  }
  return CODE_PLAN_NUDGE;
}

export function buildPlanAmendmentPrompt(
  reason: string,
  exactTestPaths: string[] = [],
  exactToolNames: string[] = [],
): string {
  const testPathGuidance =
    exactTestPaths.length > 0
      ? [
          "",
          `Use the already inspected test path exactly: ${exactTestPaths.join(", ")}.`,
          "Do not invent a new test path.",
        ]
      : [];
  const toolNameGuidance =
    exactToolNames.length > 0
      ? [
          "",
          `Keep the requested tool name exactly: ${exactToolNames.join(", ")}.`,
          "Do not replace it with a different tool name.",
        ]
      : [];
  return [
    `The reviewed plan is not executable yet: ${reason}`,
    ...testPathGuidance,
    ...toolNameGuidance,
    "",
    "Do not use tools. Emit exactly one amended complete well-formed YAML plan now.",
    "The YAML plan must have top-level plan.steps, and every step must have string name, prompt, and verify fields.",
    "The plan must include grounding, test, implementation, and verification steps with exact file paths and exact commands.",
  ].join("\n");
}

export function buildEditFailureRecoveryPrompt(path: string): string {
  return [
    "The edit_file action failed because old_string was not found.",
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
    "That exact old_string is not in the current file. Do not use it again.",
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
    "Only emit verify tags after the host sends a Verify request.",
    reasonLine,
    "Continue the current step now with the next required action tag, or write a blocker summary if you cannot proceed.",
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
    messages.push({ role: "user", content: opts.prompt });

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
  let pendingPlanReview = false;
  let planReviewAttempts = 0;
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
    prepareStepEvidence(next);
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
      messages.push({
        role: "tool",
        content: `[ok] ${action.name}: ${result}`,
      });
      if (planState?.currentStepId) {
        recordPlanToolEvidence(stepEvidence, action.name, result, action.args);
      }
      codeNoProgressNudges = 0;
      planOnlyNudges = 0;
      if (
        action.name === "edit_file" &&
        result.startsWith("Error editing") &&
        result.includes("old_string not found") &&
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
        if (failedEdit) {
          failedEditCounts.delete(failedEdit.key);
        }
        if (
          typeof action.args.path === "string" &&
          action.args.path === pendingEditRecoveryPath
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
      prepareStepEvidence(next);
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
            "You emitted a YAML plan while inside an active plan step. That is not allowed and the plan was discarded. Do the work for the current step directly using <action> tags, or write a brief plain-text summary if no tools are needed. If the step is too large, do what you can and let verify fail with a reason describing what's left.",
          );
        } else {
          if (!pendingPlanReview) {
            const missingEvidence = findMissingPlanEvidence(
              opts,
              planInspectionEvidence,
              planFound,
            );
            if (missingEvidence.length > 0) {
              messages.push({ role: "assistant", content: buffer });
              pushHarnessPrompt(
                messages,
                "plan rejected - inspect first",
                buildPlanEvidencePrompt(missingEvidence),
              );
              continue;
            }
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
            const missingEvidence = findMissingPlanEvidence(
              opts,
              planInspectionEvidence,
              planFound,
            );
            if (missingEvidence.length === 0) {
              pushHarnessPrompt(
                messages,
                "plan rejected - amend yaml",
                buildPlanAmendmentPrompt(
                  validation.reason,
                  [...planInspectionEvidence.testPaths],
                  findRequestedToolNames(opts.prompt),
                ),
              );
              continue;
            }
            pushHarnessPrompt(
              messages,
              "plan rejected - gather context",
              `The reviewed plan is not executable yet: ${validation.reason}\n\nYour next response must be exactly one action tag that gathers the missing concrete evidence. For host-project tool plans, do not call list_files again if it already ran; inspect src/main/tools.ts, Gemma.md, package.json, and the exact tests/main file you will create or update. If you need to discover that test file, use a focused run_bash search such as rg --files tests/main | rg "Tool|tools|Datetime|ProjectScript|codeSystemPrompt". Do not emit another YAML plan until the plan can name exact file paths and commands.`,
            );
            continue;
          }
          const uninspectedPlanTestPaths = findUninspectedPlanTestPaths(
            planFound,
            planInspectionEvidence,
          );
          if (uninspectedPlanTestPaths.length > 0) {
            messages.push({ role: "assistant", content: buffer });
            pendingPlanReview = false;
            pushHarnessPrompt(
              messages,
              "plan rejected - amend yaml",
              buildPlanAmendmentPrompt(
                `Plan names test paths that were not inspected: ${uninspectedPlanTestPaths.join(", ")}.`,
                [...planInspectionEvidence.testPaths],
                findRequestedToolNames(opts.prompt),
              ),
            );
            continue;
          }
          const missingRequestedToolNames = findRequestedToolNames(
            opts.prompt,
          ).filter((name) => !planFound.raw.includes(name));
          if (missingRequestedToolNames.length > 0) {
            messages.push({ role: "assistant", content: buffer });
            pendingPlanReview = false;
            pushHarnessPrompt(
              messages,
              "plan rejected - amend yaml",
              buildPlanAmendmentPrompt(
                `Plan switched away from the requested tool name: ${missingRequestedToolNames.join(", ")}.`,
                [...planInspectionEvidence.testPaths],
                missingRequestedToolNames,
              ),
            );
            continue;
          }
          pendingPlanReview = false;
          messages.push({ role: "assistant", content: buffer });
          if (opts.planOnly) {
            meta("done — reviewed plan ready");
            return;
          }
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
      prepareStepEvidence(next);
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
        "The plan review response did not include one complete final YAML plan. Explain the gap briefly, then emit one amended complete YAML plan now.",
      );
      continue;
    }

    if (planState) {
      const prematureVerify = parseVerifyResult(buffer);
      if (prematureVerify) {
        const forcedReason = forcedVerifyFailureReason(
          planState.currentVerifyCriterion() ?? "",
          stepEvidence,
        );
        messages.push({ role: "assistant", content: buffer });
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
