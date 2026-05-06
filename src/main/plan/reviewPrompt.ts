export function buildPlanReviewPrompt(candidatePlan: string): string {
  return [
    "Review the plan you just produced before the harness accepts it.",
    "",
    "Explain why you chose this plan.",
    "Check whether it meets all of the user's requirements and the project instructions.",
    "Check whether every step is executable by the harness, names concrete files or discovery actions, includes tests before implementation, and includes verification.",
    "Reject placeholder wording such as relevant tests, relevant files, needed files, implementation files, or files needed.",
    "A valid plan names exact source files, exact test files to create or update, and exact commands for focused tests, full tests, and build verification.",
    "Do not use tools or action tags during this review.",
    "If the plan is missing anything, emit an amended complete <plan> that fixes it.",
    "If the plan is acceptable, repeat the complete final <plan> unchanged.",
    "In all cases, include exactly one complete final <plan> in this response so the harness can save the reviewed plan.",
    "",
    "Candidate plan:",
    candidatePlan,
  ].join("\n");
}
