import type { ParsedPlan, ParsedStep } from "./parser";

export type PlanValidationResult =
  | { valid: true }
  | { valid: false; reason: string };

interface PlaceholderPattern {
  label: string;
  pattern: RegExp;
}

export const EXECUTABLE_PLAN_VALIDATION_GUIDANCE_LINES = [
  "The plan must contain at least one executable step.",
  "Every step must have non-empty string name, prompt, and verify fields.",
  "Every step name must be unique.",
  "Do not create report-only or final-answer steps; include final reporting in the summary of the evidence-gathering step.",
  "The deterministic validator checks plan document shape, obvious placeholders, and target-discovery instructions that should have happened during planning.",
  "Do not use placeholder wording such as relevant tests, relevant files, needed files, files needed, implementation files, documentation files needed, runtime files needed, prompt files needed, search through the codebase, find the file or module, identify and locate, or related code.",
] as const;

const REPORT_ONLY_STEP_START_RE =
  /^\s*(?:report|summari[sz]e|return|output|provide|tell|respond|extract|confirm)\b/i;
const EXECUTION_ACTION_RE =
  /\b(?:read(?:ing)?|inspect(?:ing)?|list(?:ing)?|search(?:ing)?|grep|run(?:ning)?|execut(?:e|ing)|edit(?:ing)?|updat(?:e|ing)|writ(?:e|ing)|creat(?:e|ing)|delet(?:e|ing)|modify(?:ing)?|test(?:ing)?|build(?:ing)?|verify(?:ing)?|open(?:ing)?|retriev(?:e|ing))\b/i;
const TOOL_MODULE_REMOVAL_RE =
  /\b(?:remove|delete|deleted|deleting|disable|disabled|disabling)\b[\s\S]*\bsrc\/main\/tools\/(?!index\.ts\b)[A-Za-z0-9_-]+\.ts\b/i;
const TOOL_MODULE_DELETE_RE =
  /\bdelete\b[\s\S]*\bsrc\/main\/tools\/(?!index\.ts\b)[A-Za-z0-9_-]+\.ts\b/i;
const TOOL_REGISTRY_PATH = "src/main/tools/index.ts";
const REMOVAL_ABSENCE_VERIFY_RE =
  /\b(?:no longer|does not exist|deleted|removed|no matches|no references|not reference|not contain|absent)\b/i;

const PLACEHOLDER_PATTERNS: PlaceholderPattern[] = [
  { label: "relevant tests", pattern: /\brelevant tests?\b/i },
  { label: "relevant files", pattern: /\brelevant files?\b/i },
  { label: "needed files", pattern: /\bneeded files?\b/i },
  { label: "files needed", pattern: /\bfiles needed\b/i },
  { label: "implementation files", pattern: /\bimplementation files?\b/i },
  {
    label: "documentation files needed",
    pattern: /\bdocumentation files? needed\b/i,
  },
  {
    label: "runtime files needed",
    pattern: /\bruntime files? needed\b/i,
  },
  {
    label: "prompt files needed",
    pattern: /\bprompt files? needed\b/i,
  },
  {
    label: "exampleTool.test.ts",
    pattern: /\bexampleTool\.test\.ts\b/,
  },
  {
    label: "requested_tool_name",
    pattern: /\brequested_tool_name\b/,
  },
  {
    label: "newToolName.test.ts",
    pattern: /\bnewToolName\.test\.ts\b/,
  },
  {
    label: "TODO",
    pattern: /\bTODO\b/i,
  },
  {
    label: "TBD",
    pattern: /\bTBD\b/i,
  },
  {
    label: "search through the codebase",
    pattern: /\bsearch\s+(?:(?:through|in)\s+)?(?:the\s+)?(?:codebase|file\s+tree|src\/[A-Za-z0-9_./-]+)\b/i,
  },
  {
    label: "find the file or module",
    pattern: /\bfind\s+(?:the\s+)?(?:file|module|path)(?:\s+or\s+(?:module|file|path))?\b|\bfile\s+that\s+(?:handles|implements|contains|owns)\b/i,
  },
  {
    label: "identify the file",
    pattern: /\bidentif(?:y|ied)\s+(?:the\s+)?(?:file|module|path|code\s+module)\b/i,
  },
  {
    label: "locate the file",
    pattern: /\bloc(?:ate|ated|ating)\s+(?:the\s+)?(?:file|module|path|code\s+module)\b/i,
  },
  {
    label: "identify and locate",
    pattern:
      /\bidentif(?:y|ied|ying)\b[\s\S]{0,80}\bloc(?:ate|ated|ating)\b|\bloc(?:ate|ated|ating)\b[\s\S]{0,80}\bidentif(?:y|ied|ying)\b/i,
  },
  {
    label: "confirm which module",
    pattern: /\bconfirm\s+which\s+(?:file|module|path|code\s+module)\b/i,
  },
  {
    label: "confirm target",
    pattern:
      /\bconfirm\s+(?:this\s+file|the\s+(?:file|module|path)|.*\bcorrect\s+target|.*\bmodule\s+to\s+be\s+removed)\b/i,
  },
  {
    label: "related code",
    pattern: /\b(?:code|paths?|files?|references?)\s+related\s+to\b/i,
  },
  {
    label: "relevant files",
    pattern: /\brelevant\s+(?:files?|modules?|paths?)\b/i,
  },
  {
    label: "neutralized",
    pattern: /\bneutraliz(?:e|ed|ing)\b/i,
  },
  {
    label: "disable",
    pattern: /\bdisabl(?:e|ed|ing)\b/i,
  },
  {
    label: "commented out",
    pattern: /\bcomment(?:ed|ing)?\s+out\b/i,
  },
  {
    label: "non-functional state",
    pattern: /\bnon-functional\s+state\b/i,
  },
  {
    label: "empty the file",
    pattern: /\b(?:empty|emptied|emptying)\b|\bemptied\s+of\b/i,
  },
  {
    label: "starting with",
    pattern: /\bstarting\s+with\b/i,
  },
];

export function validatePlanForExecution(
  plan: ParsedPlan,
): PlanValidationResult {
  if (plan.steps.length === 0) {
    return { valid: false, reason: "Plan has no executable steps." };
  }

  const names = new Set<string>();
  for (const step of plan.steps) {
    const stepValidation = validatePlanStepText(step);
    if (!stepValidation.valid) return stepValidation;
    const name = step.name.trim();
    if (names.has(name)) {
      return {
        valid: false,
        reason: `Duplicate step name "${name}".`,
      };
    }
    names.add(name);
  }
  const crossStepValidation = validateCrossStepPlanText(plan);
  if (!crossStepValidation.valid) return crossStepValidation;

  return { valid: true };
}

export function validatePlanStepText(
  step: ParsedStep,
): PlanValidationResult {
  const fieldValidation = validateStepFields(step);
  if (!fieldValidation.valid) return fieldValidation;

  const text = `${step.name}\n${step.prompt}\n${step.verify}`;
  const placeholder = PLACEHOLDER_PATTERNS.find(({ pattern }) =>
    pattern.test(text),
  );
  if (placeholder) {
    return {
      valid: false,
      reason:
        `Step "${step.name}" still uses placeholder wording "${placeholder.label}". ` +
        "Name exact files, artifacts, commands, or verification evidence before the plan can run.",
    };
  }
  if (isReportOnlyStep(step)) {
    return {
      valid: false,
      reason:
        `Step "${step.name}" is a report-only or final-answer step. ` +
        "Keep final reporting in the summary of the evidence-gathering step instead of adding a separate plan step.",
    };
  }
  return { valid: true };
}

export function buildExecutablePlanValidationPrompt(reason: string): string {
  return [
    "The assembled plan is not executable yet: " + reason,
    "",
    "Return one complete corrected YAML plan for the AI coding agent.",
    "Do not return one extra patch step; the defect may be in an already accepted step.",
    "Do not use tools.",
    "",
    "Executable-plan validation gates:",
    ...EXECUTABLE_PLAN_VALIDATION_GUIDANCE_LINES,
    "",
    "The corrected YAML plan must have top-level plan.steps, and every step must have string name, prompt, and verify fields.",
    "Every prompt and verify field must contain exact task-specific files, artifacts, commands, or verification evidence.",
    "Return no prose.",
  ].join("\n");
}

function validateStepFields(step: ParsedStep): PlanValidationResult {
  if (step.name.trim().length === 0) {
    return { valid: false, reason: "Plan step name must be a non-empty string." };
  }
  if (step.prompt.trim().length === 0) {
    return {
      valid: false,
      reason: `Step "${step.name}" prompt must be a non-empty string.`,
    };
  }
  if (step.verify.trim().length === 0) {
    return {
      valid: false,
      reason: `Step "${step.name}" verify must be a non-empty string.`,
    };
  }
  return { valid: true };
}

function validateCrossStepPlanText(plan: ParsedPlan): PlanValidationResult {
  const text = plan.steps
    .map((step) => `${step.name}\n${step.prompt}\n${step.verify}`)
    .join("\n");
  if (TOOL_MODULE_REMOVAL_RE.test(text) && !text.includes(TOOL_REGISTRY_PATH)) {
    return {
      valid: false,
      reason:
        `A tool module removal plan must also update ${TOOL_REGISTRY_PATH}. ` +
        "Name the registry file explicitly before the plan can run.",
    };
  }
  if (TOOL_MODULE_REMOVAL_RE.test(text) && !TOOL_MODULE_DELETE_RE.test(text)) {
    return {
      valid: false,
      reason:
        "A tool module removal plan must delete the obsolete tool module file, not only remove references inside it.",
    };
  }
  if (
    TOOL_MODULE_REMOVAL_RE.test(text) &&
    !plan.steps.some((step) => REMOVAL_ABSENCE_VERIFY_RE.test(step.verify))
  ) {
    return {
      valid: false,
      reason:
        "A tool module removal plan must verify absence of the deleted file or removed references, not only compile or run.",
    };
  }
  return { valid: true };
}

function isReportOnlyStep(step: ParsedStep): boolean {
  const prompt = step.prompt.trim();
  if (!REPORT_ONLY_STEP_START_RE.test(prompt)) return false;
  const promptWithoutPriorResultReferences = prompt.replace(
    /\bresult of reading\b/gi,
    "prior result",
  );
  if (EXECUTION_ACTION_RE.test(promptWithoutPriorResultReferences)) return false;
  return true;
}
