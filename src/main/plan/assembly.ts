import { parse, stringify } from "yaml";
import type {
  PlanReview,
  PlanReviewChecklistItem,
  PlanReviewVerdict,
} from "../../shared/types";
import {
  findNextPlan,
  findNextStepPlan,
  type ParsedPlan,
  type ParsedStep,
} from "./parser";
import { validatePlanForExecution, validatePlanStepText } from "./validation";

const MAX_PLAN_ASSEMBLY_STEPS = 16;
const WHOLE_RESPONSE_YAML_FENCE_RE =
  /^```(?:yaml|yml)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/i;

export const PLAN_ASSEMBLY_DONE_TEXT = "plan: done";
const PLAN_QUESTION_RE =
  /^\s*<Question\b[^>]*>([\s\S]*?)<\/Question\s*>\s*$/i;
const STEP_TAG_RE = /<\/?Step\b/i;
const PLAN_SEMANTIC_REVIEW_VERDICT_PASS = "pass";
const PLAN_SEMANTIC_REVIEW_VERDICT_NEEDS_CORRECTION = "needs_correction";
const PLAN_SEMANTIC_REVIEW_VERDICTS: readonly PlanReviewVerdict[] = [
  PLAN_SEMANTIC_REVIEW_VERDICT_PASS,
  PLAN_SEMANTIC_REVIEW_VERDICT_NEEDS_CORRECTION,
];
const SEMANTIC_REVIEW_FREE_TEXT_FIELD_RE =
  /^(\s*(?:summary|additional_info):\s+)(.+)$/;

interface PlanSemanticReviewChecklistPromptItem {
  id: string;
  question: string;
  allowedAnswers: readonly string[];
}

const PLAN_SEMANTIC_REVIEW_CHECKLIST_ITEMS: readonly PlanSemanticReviewChecklistPromptItem[] = [
  {
    id: "request_fit",
    question: "Does the plan directly address the original request?",
    allowedAnswers: ["yes", "no", "partial"],
  },
  {
    id: "grounding",
    question: "Does the plan include enough project grounding before edits?",
    allowedAnswers: ["yes", "no", "not_applicable"],
  },
  {
    id: "specificity",
    question:
      "Are files, commands, artifacts, and verification evidence task-specific?",
    allowedAnswers: ["yes", "no", "partial"],
  },
  {
    id: "placeholder_present",
    question: "Does the plan contain placeholder wording or made-up examples?",
    allowedAnswers: ["true", "false"],
  },
  {
    id: "verification",
    question: "Does the plan include appropriate verification for the request?",
    allowedAnswers: ["yes", "no", "not_applicable"],
  },
  {
    id: "residual_risk",
    question: "What residual risk remains if this plan is executed?",
    allowedAnswers: ["low", "medium", "high"],
  },
];
export const PLAN_SEMANTIC_REVIEW_SYSTEM_PROMPT = [
  "You are validating an assembled implementation plan.",
  "This is a fresh review context after plan construction has ended.",
  "Do not continue plan construction and do not return plan: done.",
  "Do not return the old review: pass shorthand.",
  "Use only the original request and assembled plan supplied by the user message.",
  "Return exactly one YAML document containing a structured review checklist.",
  "If the review verdict is needs_correction, also return one complete corrected plan under the top-level key named plan.",
  "Do not use corrected_plan, correctedPlan, or a nested review.corrected_plan key.",
  "Return no prose.",
].join("\n");
const PLAN_ASSEMBLY_USER_REQUEST_OPEN = "<UserRequest>";
const PLAN_ASSEMBLY_USER_REQUEST_CLOSE = "</UserRequest>";
const PLAN_SEMANTIC_REVIEW_ORIGINAL_REQUEST_OPEN = "<OriginalRequest>";
const PLAN_SEMANTIC_REVIEW_ORIGINAL_REQUEST_CLOSE = "</OriginalRequest>";
const PLAN_SEMANTIC_REVIEW_PLAN_OPEN = "<AssembledPlan>";
const PLAN_SEMANTIC_REVIEW_PLAN_CLOSE = "</AssembledPlan>";
const LEGACY_PLAN_ASSEMBLY_INITIAL_PROMPT_PREFIX =
  "As an expert in software development and AI-assisted coding, I need your help in instructing an AI coding agent. Our task: ";
const LEGACY_PLAN_ASSEMBLY_INITIAL_PROMPT_SUFFIX =
  " What should I start by telling the agent? in YAML only no extra explanations, just the prompt?";
const PLAN_ASSEMBLY_INITIAL_PROMPT_PREFIX =
  "Our task is to create clear, executable instructions for an AI coding agent.";
const PLAN_ASSEMBLY_INITIAL_PROMPT_SUFFIX =
  "Research and emit the first step now. Respond with exactly one of: one read-only inspection action, one YAML plan step wrapped in <Step>...</Step>, or one focused question wrapped in <Question>...</Question>.";
const PLAN_ASSEMBLY_RELEVANT_TERM_MIN_LENGTH = 4;
const PLAN_ASSEMBLY_RELEVANT_TERM_MIN_COUNT = 2;
const PLAN_ASSEMBLY_RELEVANT_TERM_RE = /[a-z0-9_]+/gi;
const PLAN_ASSEMBLY_TASK_TERM_STOP_WORDS = new Set([
  "about",
  "after",
  "agent",
  "also",
  "another",
  "application",
  "around",
  "before",
  "build",
  "change",
  "changes",
  "check",
  "code",
  "coding",
  "create",
  "current",
  "file",
  "files",
  "from",
  "implementation",
  "make",
  "plan",
  "project",
  "remove",
  "request",
  "should",
  "task",
  "that",
  "there",
  "this",
  "update",
  "with",
]);

export const PLAN_ASSEMBLY_NEXT_PROMPT = [
  "Continue preparing the plan for the AI coding agent.",
  "Respond with exactly one of: one read-only inspection action, one YAML plan step wrapped in <Step>...</Step>, plan: done, or one focused question wrapped in <Question>...</Question>.",
  "Read-only inspection actions are planning work, not plan steps; do not create steps that read, search, inspect, locate, identify, confirm, or trace targets.",
  "When evidence has identified the files, emit the next executable mutation or verification step.",
  "Return exactly plan: done, with no prose and no <Step> wrapper, only when the accepted steps form a complete executable plan for the user request.",
  "Do not pass target discovery to the coding agent; mutation steps must name exact files or artifacts.",
].join("\n");

export interface PlanAssemblyState {
  steps: ParsedStep[];
}

export type PlanAssemblyResult =
  | {
      kind: "accepted";
      state: PlanAssemblyState;
      nextPrompt: string;
    }
  | {
      kind: "finished";
      state: PlanAssemblyState;
      plan: ParsedPlan;
    }
  | {
      kind: "rejected";
      state: PlanAssemblyState;
      reason: string;
      retryPrompt: string;
    };

export type PlanSemanticReviewResult =
  | {
      kind: "accepted";
      plan: ParsedPlan;
      review: PlanReview;
    }
  | {
      kind: "corrected";
      plan: ParsedPlan;
      review: PlanReview;
    }
  | {
      kind: "rejected";
      reason: string;
      retryPrompt: string;
    };

export type PlanCorrectionResult =
  | {
      kind: "accepted";
      plan: ParsedPlan;
    }
  | {
      kind: "rejected";
      reason: string;
      retryPrompt: string;
    };

export interface PlanSemanticReviewMessage {
  role: "system" | "user";
  content: string;
}

export function createPlanAssemblyState(): PlanAssemblyState {
  return { steps: [] };
}

export function buildPlanAssemblyInitialPrompt(task: string): string {
  const trimmedTask = task.trim();
  const existingUserRequest = extractPlanAssemblyUserRequest(trimmedTask);
  if (existingUserRequest && isStructuredPlanAssemblyPrompt(trimmedTask)) {
    return trimmedTask;
  }
  const userRequest =
    existingUserRequest ?? extractLegacyPlanAssemblyTask(trimmedTask) ?? trimmedTask;
  const trimmedUserRequest = userRequest.trim();
  const taskSentence = /[.!?]$/.test(trimmedUserRequest)
    ? trimmedUserRequest
    : trimmedUserRequest + ".";
  return [
    PLAN_ASSEMBLY_INITIAL_PROMPT_PREFIX,
    "",
    "Here is the user request to be realized by the AI agent: " +
      PLAN_ASSEMBLY_USER_REQUEST_OPEN +
      taskSentence +
      PLAN_ASSEMBLY_USER_REQUEST_CLOSE,
    "",
    "Prepare a plan for another AI coding agent; include all information that agent needs.",
    "Use one read-only inspection action first if project evidence is missing.",
    "Read-only inspection actions are planning work, not plan steps; do not create steps that read, search, inspect, locate, identify, confirm, or trace targets.",
    "Emit executable plan steps one at a time. When enough evidence is visible, emit exactly one YAML plan step wrapped in <Step>...</Step>.",
    "Mutation steps must name exact files or artifacts; do not pass target discovery to the coding agent.",
    "",
    PLAN_ASSEMBLY_INITIAL_PROMPT_SUFFIX,
  ].join("\n");
}

export function applyPlanAssemblyResponse(
  state: PlanAssemblyState,
  response: string,
  task = "",
): PlanAssemblyResult {
  if (isPlanAssemblyDoneResponse(response)) {
    const plan = finalizePlanAssembly(state);
    if (!plan) {
      return rejected(
        state,
        "The assembled plan needs at least one step before it can finish.",
        task,
      );
    }
    return { kind: "finished", state, plan };
  }

  const parsed = findPlanAssemblyStep(response);
  if (parsed === "incomplete") {
    return rejected(state, "The response contains incomplete YAML.", task);
  }
  if (!parsed) {
    return rejected(
      state,
      state.steps.length > 0
        ? "The response must contain exactly one <Step>-wrapped YAML plan step or exactly plan: done."
        : "The response must contain exactly one <Step>-wrapped YAML plan step.",
      task,
    );
  }
  const planShapeReason = validateRawPlanDocumentShape(parsed.raw);
  if (
    planShapeReason &&
    (rawPlanDocumentParses(parsed.raw) || parsed.steps.length === 0)
  ) {
    return rejected(state, planShapeReason, task);
  }
  const rawStepCount = countRawPlanSteps(parsed.raw);
  if ((rawStepCount ?? parsed.steps.length) !== 1) {
    return rejected(
      state,
      "The response must contain exactly one step; received " +
        (rawStepCount ?? parsed.steps.length) +
        ".",
      task,
    );
  }
  if (parsed.steps.length !== 1) {
    return rejected(
      state,
      "The response must contain exactly one step; received " +
        parsed.steps.length +
        ".",
      task,
    );
  }
  if (state.steps.length >= MAX_PLAN_ASSEMBLY_STEPS) {
    return rejected(
      state,
      "The assembled plan reached the limit of " +
        MAX_PLAN_ASSEMBLY_STEPS +
        " steps.",
      task,
    );
  }

  const [step] = parsed.steps;
  const stepValidation = validatePlanStepText(step);
  if (!stepValidation.valid) {
    return rejected(state, stepValidation.reason, task);
  }
  if (state.steps.some((existing) => existing.name === step.name)) {
    return rejected(state, 'Duplicate step name "' + step.name + '".', task, {
      duplicateStepName: step.name,
    });
  }
  if (!isStepRelevantToTask(step, task, state)) {
    return rejected(
      state,
      "The new step appears unrelated to the original user request.",
      task,
      { unrelatedStep: true },
    );
  }

  const nextState = { steps: [...state.steps, step] };
  return {
    kind: "accepted",
    state: nextState,
    nextPrompt: buildPlanAssemblyNextPrompt(nextState, task),
  };
}

export function buildPlanSemanticReviewPrompt(
  plan: ParsedPlan,
  task: string,
): string {
  return [
    "Validate the assembled plan against the original user request.",
    "",
    PLAN_SEMANTIC_REVIEW_ORIGINAL_REQUEST_OPEN,
    task.trim(),
    PLAN_SEMANTIC_REVIEW_ORIGINAL_REQUEST_CLOSE,
    "",
    PLAN_SEMANTIC_REVIEW_PLAN_OPEN,
    plan.raw,
    PLAN_SEMANTIC_REVIEW_PLAN_CLOSE,
    "",
    "Deterministic syntax validation has already passed. Do not critique YAML formatting unless the corrected plan you return would fail the documented shape.",
    "Check whether the plan has enough concrete grounding, implementation, test, documentation, and verification work for this specific request. Some requests may not need every category.",
    "Check that files, folders, commands, and artifacts are task-specific choices made by the plan, not placeholders.",
    "If a plan removes a tool module under src/main/tools, check that it also updates src/main/tools/index.ts and any prompt, documentation, or tests that would still expose or require the removed tool.",
    "For removal requests, a plan must delete the obsolete references; disabling or commenting them out is not sufficient unless the original request explicitly asks for that.",
    "",
    "Checklist questions and allowed answers:",
    ...PLAN_SEMANTIC_REVIEW_CHECKLIST_ITEMS.map(
      (item) =>
        `- ${item.id}: ${item.question} Answer: ${item.allowedAnswers.join(" | ")}`,
    ),
    "",
    "Return exactly one compact YAML document using this schema:",
    "review:",
    "  verdict: pass | needs_correction",
    "  summary: Short review summary.",
    "  checklist:",
    "    - id: request_fit",
    "      answer: yes | no | partial",
    "      additional_info: Short task-specific reason.",
    "    - id: grounding",
    "      answer: yes | no | not_applicable",
    "      additional_info: Short task-specific reason.",
    "    - id: specificity",
    "      answer: yes | no | partial",
    "      additional_info: Short task-specific reason.",
    "    - id: placeholder_present",
    "      answer: true | false",
    "      additional_info: Short task-specific reason.",
    "    - id: verification",
    "      answer: yes | no | not_applicable",
    "      additional_info: Short task-specific reason.",
    "    - id: residual_risk",
    "      answer: low | medium | high",
    "      additional_info: Short task-specific reason.",
    "",
    "Do not include question fields in the YAML; the checklist ids already identify the questions.",
    "If verdict is pass, do not include a plan key.",
    "If verdict is needs_correction, include one complete corrected top-level plan key named plan after review, with all steps, not just an added step.",
    "Do not use corrected_plan, correctedPlan, or review.corrected_plan.",
    "Return no prose.",
  ].join("\n");
}

export function buildPlanSemanticReviewMessages(
  plan: ParsedPlan,
  task: string,
): PlanSemanticReviewMessage[] {
  return [
    { role: "system", content: PLAN_SEMANTIC_REVIEW_SYSTEM_PROMPT },
    { role: "user", content: buildPlanSemanticReviewPrompt(plan, task) },
  ];
}

export function applyPlanSemanticReviewResponse(
  currentPlan: ParsedPlan,
  response: string,
): PlanSemanticReviewResult {
  const structuredReview = parseStructuredPlanSemanticReviewResponse(response);
  if (structuredReview.kind === "rejected") {
    return semanticReviewRejected(structuredReview.reason);
  }
  if (structuredReview.kind === "accepted") {
    return {
      kind: "accepted",
      plan: currentPlan,
      review: structuredReview.review,
    };
  }
  return {
    kind: "corrected",
    plan: structuredReview.plan,
    review: structuredReview.review,
  };
}

export function applyPlanCorrectionResponse(
  response: string,
): PlanCorrectionResult {
  const parsed = findNextPlan(response);
  if (parsed === "incomplete") {
    return planCorrectionRejected("The corrected plan contains incomplete YAML.");
  }
  if (!parsed || parsed.steps.length === 0) {
    return planCorrectionRejected(
      "The response must contain one complete corrected top-level plan.",
    );
  }
  const planShapeReason = validateRawPlanDocumentShape(parsed.raw);
  if (planShapeReason) return planCorrectionRejected(planShapeReason);
  const validation = validatePlanForExecution(parsed);
  if (!validation.valid) return planCorrectionRejected(validation.reason);
  return { kind: "accepted", plan: parsed };
}

function findPlanAssemblyStep(
  response: string,
): ParsedPlan | "incomplete" | null {
  const wrapped = findNextStepPlan(response);
  if (wrapped) return wrapped;
  if (STEP_TAG_RE.test(response)) return "incomplete";

  const text = normalizeWholeResponseYaml(response);
  const parsed = findNextPlan(text);
  if (!parsed || parsed === "incomplete") return parsed;
  const isWholeResponse =
    text.slice(parsed.start, parsed.end).trim() === text.trim();
  return isWholeResponse ? parsed : null;
}

type StructuredPlanSemanticReviewResult =
  | {
      kind: "accepted";
      review: PlanReview;
    }
  | {
      kind: "corrected";
      review: PlanReview;
      plan: ParsedPlan;
    }
  | {
      kind: "rejected";
      reason: string;
    };

function parseStructuredPlanSemanticReviewResponse(
  response: string,
): StructuredPlanSemanticReviewResult {
  const text = normalizeWholeResponseYaml(response);
  let doc: unknown;
  try {
    doc = parseSemanticReviewYaml(text);
  } catch {
    return {
      kind: "rejected",
      reason: "Semantic review response must be valid YAML.",
    };
  }

  if (!isRecord(doc) || !isRecord(doc.review)) {
    return {
      kind: "rejected",
      reason: "Semantic review must contain a review object.",
    };
  }

  const verdict = stringField(doc.review, "verdict")?.trim();
  if (!verdict || !isPlanReviewVerdict(verdict)) {
    return {
      kind: "rejected",
      reason: "Semantic review verdict must be pass or needs_correction.",
    };
  }

  const summary = stringField(doc.review, "summary");
  if (!summary) {
    return {
      kind: "rejected",
      reason: "Semantic review summary must be a non-empty string.",
    };
  }

  const checklist = parsePlanReviewChecklist(doc.review.checklist);
  if (typeof checklist === "string") {
    return { kind: "rejected", reason: checklist };
  }

  const review: PlanReview = {
    verdict,
    summary: summary.trim(),
    checklist,
  };

  if (verdict === PLAN_SEMANTIC_REVIEW_VERDICT_PASS) {
    return { kind: "accepted", review };
  }

  const correctedPlan = findCorrectedPlan(text, doc);
  if (correctedPlan === "incomplete") {
    return {
      kind: "rejected",
      reason: "The corrected plan contains incomplete YAML.",
    };
  }
  if (!correctedPlan || correctedPlan.steps.length === 0) {
    return {
      kind: "rejected",
      reason:
        "A needs_correction review must include one complete corrected top-level plan.",
    };
  }
  const planShapeReason = validateRawPlanDocumentShape(correctedPlan.raw);
  if (planShapeReason) {
    return { kind: "rejected", reason: planShapeReason };
  }
  const validation = validatePlanForExecution(correctedPlan);
  if (!validation.valid) {
    return { kind: "rejected", reason: validation.reason };
  }

  return { kind: "corrected", review, plan: correctedPlan };
}

function parsePlanReviewChecklist(
  value: unknown,
): PlanReviewChecklistItem[] | string {
  if (!Array.isArray(value)) {
    return "Semantic review checklist must be an array.";
  }

  const expectedItems = new Map(
    PLAN_SEMANTIC_REVIEW_CHECKLIST_ITEMS.map((item) => [item.id, item]),
  );
  const seen = new Set<string>();
  const checklist: PlanReviewChecklistItem[] = [];

  for (const item of value) {
    if (!isRecord(item)) {
      return "Each semantic review checklist item must be an object.";
    }
    const id = stringField(item, "id");
    if (!id) {
      return "Each semantic review checklist item must have a non-empty id.";
    }
    const expected = expectedItems.get(id.trim());
    if (!expected) {
      return `Unknown semantic review checklist id "${id.trim()}".`;
    }
    if (seen.has(expected.id)) {
      return `Duplicate semantic review checklist id "${expected.id}".`;
    }
    seen.add(expected.id);

    const question = stringField(item, "question");
    if (question && question.trim() !== expected.question) {
      return `Checklist item "${expected.id}" must use the expected question text.`;
    }

    const answer = enumField(item, "answer");
    if (!answer) {
      return `Checklist item "${expected.id}" answer must be a non-empty string.`;
    }
    const trimmedAnswer = answer.trim();
    if (!expected.allowedAnswers.includes(trimmedAnswer)) {
      return (
        `Checklist item "${expected.id}" answer must be one of: ` +
        expected.allowedAnswers.join(", ") +
        "."
      );
    }

    const additionalInfo = stringField(item, "additional_info");
    if (!additionalInfo) {
      return `Checklist item "${expected.id}" additional_info must be a non-empty string.`;
    }

    checklist.push({
      id: expected.id,
      question: expected.question,
      allowedAnswers: [...expected.allowedAnswers],
      answer: trimmedAnswer,
      additionalInfo: additionalInfo.trim(),
    });
  }

  for (const expected of PLAN_SEMANTIC_REVIEW_CHECKLIST_ITEMS) {
    if (!seen.has(expected.id)) {
      return `Semantic review checklist is missing "${expected.id}".`;
    }
  }

  return checklist;
}

function parseSemanticReviewYaml(text: string): unknown {
  try {
    return parse(text);
  } catch (error) {
    return parse(quoteSemanticReviewFreeTextScalars(text));
  }
}

function quoteSemanticReviewFreeTextScalars(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => {
      const match = line.match(SEMANTIC_REVIEW_FREE_TEXT_FIELD_RE);
      if (!match) return line;
      const value = match[2].trim();
      if (!shouldQuoteSemanticReviewTextValue(value)) return line;
      return match[1] + JSON.stringify(value);
    })
    .join("\n");
}

function shouldQuoteSemanticReviewTextValue(value: string): boolean {
  if (value.length === 0) return false;
  return !/^(?:"|'|\||>|\{|\[|&|\*)/.test(value);
}

function findCorrectedPlan(
  text: string,
  doc: unknown,
): ParsedPlan | "incomplete" | null {
  const topLevelPlan = findNextPlan(text);
  if (topLevelPlan) return topLevelPlan;
  if (!isRecord(doc)) return null;

  const raw = correctedPlanRawFromRecord(doc);
  if (!raw) return null;
  return findNextPlan(raw);
}

function correctedPlanRawFromRecord(
  doc: Record<string, unknown>,
): string | null {
  return (
    rawPlanFromCandidate(doc) ??
    rawPlanFromCandidate(doc.corrected_plan) ??
    rawPlanFromCandidate(doc.correctedPlan) ??
    (isRecord(doc.review)
      ? rawPlanFromCandidate(doc.review.plan) ??
        rawPlanFromCandidate(doc.review.corrected_plan) ??
        rawPlanFromCandidate(doc.review.correctedPlan)
      : null)
  );
}

function rawPlanFromCandidate(candidate: unknown): string | null {
  if (!isRecord(candidate)) return null;
  if (isRecord(candidate.plan)) {
    return stringify({ plan: candidate.plan }).trimEnd();
  }
  if (Array.isArray(candidate.steps)) {
    return stringify({ plan: { steps: candidate.steps } }).trimEnd();
  }
  return null;
}

function isPlanReviewVerdict(value: string): value is PlanReviewVerdict {
  return PLAN_SEMANTIC_REVIEW_VERDICTS.includes(value as PlanReviewVerdict);
}

export function isPlanAssemblyDoneResponse(response: string): boolean {
  const text = normalizeWholeResponseYaml(response);
  if (text === PLAN_ASSEMBLY_DONE_TEXT) return true;

  let doc: unknown;
  try {
    doc = parse(text);
  } catch {
    return false;
  }
  if (!isRecord(doc)) return false;
  const keys = Object.keys(doc);
  return keys.length === 1 && doc.plan === "done";
}

export function parsePlanQuestion(response: string): string | null {
  const match = PLAN_QUESTION_RE.exec(response.trim());
  if (!match) return null;
  const question = match[1].trim();
  return question.length > 0 ? question : null;
}

export function finalizePlanAssembly(
  state: PlanAssemblyState,
): ParsedPlan | null {
  if (state.steps.length === 0) return null;
  const raw = stringify({ plan: { steps: state.steps } }).trimEnd();
  return {
    steps: [...state.steps],
    raw,
    start: 0,
    end: raw.length,
  };
}

export function finalizeExecutablePlanAssembly(
  state: PlanAssemblyState,
): ParsedPlan | null {
  const plan = finalizePlanAssembly(state);
  if (!plan) return null;
  const validation = validatePlanForExecution(plan);
  return validation.valid ? plan : null;
}

function isStructuredPlanAssemblyPrompt(text: string): boolean {
  return (
    text.startsWith(PLAN_ASSEMBLY_INITIAL_PROMPT_PREFIX) &&
    text.endsWith(PLAN_ASSEMBLY_INITIAL_PROMPT_SUFFIX)
  );
}

function extractPlanAssemblyUserRequest(text: string): string | null {
  const start = text.indexOf(PLAN_ASSEMBLY_USER_REQUEST_OPEN);
  if (start < 0) return null;
  const contentStart = start + PLAN_ASSEMBLY_USER_REQUEST_OPEN.length;
  const end = text.indexOf(PLAN_ASSEMBLY_USER_REQUEST_CLOSE, contentStart);
  if (end < 0) return null;
  const userRequest = text.slice(contentStart, end).trim();
  return userRequest.length > 0 ? userRequest : null;
}

function extractLegacyPlanAssemblyTask(text: string): string | null {
  if (
    !text.startsWith(LEGACY_PLAN_ASSEMBLY_INITIAL_PROMPT_PREFIX) ||
    !text.endsWith(LEGACY_PLAN_ASSEMBLY_INITIAL_PROMPT_SUFFIX.trimStart())
  ) {
    return null;
  }
  const userRequest = text.slice(
    LEGACY_PLAN_ASSEMBLY_INITIAL_PROMPT_PREFIX.length,
    text.length - LEGACY_PLAN_ASSEMBLY_INITIAL_PROMPT_SUFFIX.trimStart().length,
  ).trim();
  return userRequest.length > 0 ? userRequest : null;
}

function rejected(
  state: PlanAssemblyState,
  reason: string,
  task = "",
  options: { duplicateStepName?: string; unrelatedStep?: boolean } = {},
): PlanAssemblyResult {
  const acceptedStepNames = state.steps.map((step) => step.name);
  const originalRequest = originalRequestLine(task);
  const acceptedNameGuidance =
    acceptedStepNames.length > 0
      ? [
          "",
          `Already accepted step names: ${acceptedStepNames.join(", ")}.`,
          "The new step name must be unique and must not reuse any accepted step name.",
          "A new step adds new work; it does not replace or restate an accepted step under a new name.",
          "If the accepted steps already cover the task, return only " + PLAN_ASSEMBLY_DONE_TEXT + ".",
        ]
      : [];
  const relevanceGuidance = options.unrelatedStep
    ? [
        "",
        "A new step must directly advance the original user request.",
        ...(originalRequest ? [originalRequest] : []),
        "Do not continue from unrelated files, examples, or previous design documents.",
        "If the accepted steps already cover the request, return only " +
          PLAN_ASSEMBLY_DONE_TEXT +
          ".",
      ]
    : [];
  const duplicateNameGuidance = options.duplicateStepName
    ? [
        `The rejected name "${options.duplicateStepName}" is already used.`,
        `Do not return another step named "${options.duplicateStepName}".`,
        "Use a task-specific name that has not appeared in the accepted plan.",
      ]
    : [];
  return {
    kind: "rejected",
    state,
    reason,
    retryPrompt: [
      "The previous planning response was rejected: " + reason,
      ...acceptedNameGuidance,
      ...relevanceGuidance,
      ...duplicateNameGuidance,
      "",
      "Return exactly one <Step>-wrapped YAML plan containing one step, with name, prompt, and verify string fields.",
      "The step must be executable by the coding agent; do not return read/search/inspect/locate/identify/confirm/trace work as a step.",
      ...(acceptedStepNames.length > 0
        ? [
            "If the assembled plan is complete, return exactly " +
              PLAN_ASSEMBLY_DONE_TEXT +
              " and nothing else.",
            "Do not explain, introduce, or wrap " +
              PLAN_ASSEMBLY_DONE_TEXT +
              " in <Step> tags.",
          ]
        : []),
      "Use exact task-specific files, artifacts, commands, and verification evidence; do not use placeholders.",
    ].join("\n"),
  };
}

function buildPlanAssemblyNextPrompt(
  state: PlanAssemblyState,
  task = "",
): string {
  const originalRequest = originalRequestLine(task);
  const acceptedSteps = acceptedStepsBlock(state);
  return [
    PLAN_ASSEMBLY_NEXT_PROMPT,
    ...(originalRequest ? ["", originalRequest] : []),
    ...(acceptedSteps ? ["", acceptedSteps] : []),
    "",
    "Only add a new step if it is a distinct remaining action needed for the original request.",
    "If the accepted steps already form a complete executable plan, return exactly " +
      PLAN_ASSEMBLY_DONE_TEXT +
      " and nothing else.",
  ].join("\n");
}

function originalRequestLine(task: string): string {
  const request = extractPlanAssemblyUserRequest(task)?.trim() || task.trim();
  return request ? "Original user request: " + request : "";
}

function acceptedStepsBlock(state: PlanAssemblyState): string {
  if (state.steps.length === 0) return "";
  return [
    "Accepted steps so far:",
    ...state.steps.map((step, index) =>
      [
        `${index + 1}. ${step.name}`,
        `   prompt: ${step.prompt}`,
        `   verify: ${step.verify}`,
      ].join("\n"),
    ),
  ].join("\n");
}

function isStepRelevantToTask(
  step: ParsedStep,
  task: string,
  state: PlanAssemblyState,
): boolean {
  if (state.steps.length === 0) return true;
  const taskTerms = meaningfulTaskTerms(task);
  if (taskTerms.size < PLAN_ASSEMBLY_RELEVANT_TERM_MIN_COUNT) return true;
  const stepText = `${step.name}\n${step.prompt}\n${step.verify}`.toLowerCase();
  return [...taskTerms].some((term) => stepText.includes(term));
}

function meaningfulTaskTerms(task: string): Set<string> {
  const request = extractPlanAssemblyUserRequest(task)?.trim() || task.trim();
  const terms = new Set<string>();
  for (const match of request.matchAll(PLAN_ASSEMBLY_RELEVANT_TERM_RE)) {
    const term = match[0].toLowerCase();
    if (term.length < PLAN_ASSEMBLY_RELEVANT_TERM_MIN_LENGTH) continue;
    if (PLAN_ASSEMBLY_TASK_TERM_STOP_WORDS.has(term)) continue;
    terms.add(term);
  }
  return terms;
}

function semanticReviewRejected(reason: string): PlanSemanticReviewResult {
  return {
    kind: "rejected",
    reason,
    retryPrompt: [
      "The semantic review response was rejected: " + reason,
      "Start over from the top of the YAML document; do not continue any previous partial response.",
      "Return the compact structured review YAML with verdict, summary, and every checklist item.",
      "Each checklist item must contain only id, answer, and additional_info.",
      "If verdict is pass, do not include a plan key.",
      "If verdict is needs_correction, include one complete corrected top-level plan key named plan after review, with all steps.",
      "Do not use corrected_plan, correctedPlan, or review.corrected_plan.",
      "Return no prose.",
    ].join("\n"),
  };
}

function planCorrectionRejected(reason: string): PlanCorrectionResult {
  return {
    kind: "rejected",
    reason,
    retryPrompt: [
      "The corrected plan response was rejected: " + reason,
      "Return one complete corrected YAML plan with top-level plan.steps.",
      "Every step must have string name, prompt, and verify fields.",
      "Use exact task-specific files, artifacts, commands, and verification evidence.",
      "Return no prose.",
    ].join("\n"),
  };
}

function validateRawPlanDocumentShape(raw: string): string | null {
  let doc: unknown;
  try {
    doc = parse(raw);
  } catch {
    return "The response contains incomplete YAML.";
  }
  if (!isRecord(doc) || !isRecord(doc.plan)) {
    return "The YAML must contain a plan object.";
  }
  if (!Array.isArray(doc.plan.steps)) {
    return "The YAML must contain a plan.steps array.";
  }
  for (const [index, step] of doc.plan.steps.entries()) {
    if (!isRecord(step)) {
      return `Plan step ${index + 1} must be an object.`;
    }
    if (
      typeof step.name !== "string" ||
      step.name.trim().length === 0 ||
      typeof step.prompt !== "string" ||
      step.prompt.trim().length === 0 ||
      typeof step.verify !== "string" ||
      step.verify.trim().length === 0
    ) {
      return `Plan step ${index + 1} must have name, prompt, and verify string fields.`;
    }
  }
  return null;
}

function countRawPlanSteps(raw: string): number | null {
  let doc: unknown;
  try {
    doc = parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(doc) || !isRecord(doc.plan)) return null;
  return Array.isArray(doc.plan.steps) ? doc.plan.steps.length : null;
}

function rawPlanDocumentParses(raw: string): boolean {
  try {
    parse(raw);
    return true;
  } catch {
    return false;
  }
}

function normalizeWholeResponseYaml(response: string): string {
  const raw = response.trim();
  const fenced = WHOLE_RESPONSE_YAML_FENCE_RE.exec(raw);
  return (fenced?.[1] ?? raw).trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(
  source: Record<string, unknown>,
  key: string,
): string | null {
  const value = source[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? value : null;
}

function enumField(
  source: Record<string, unknown>,
  key: string,
): string | null {
  const value = source[key];
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? value : null;
}
