import type { SetupStatus } from "@shared/types";

export type AppState =
  | { phase: "boot" }
  | { phase: "setup"; status: SetupStatus; model: string }
  | { phase: "ready"; model: string }
  | { phase: "switching"; model: string; toModel: string; status: SetupStatus };

export function applySetupStatus(
  prev: AppState,
  status: SetupStatus,
): AppState {
  if (prev.phase === "ready" || prev.phase === "boot") return prev;

  if (status.stage === "ready") {
    if (prev.phase === "switching") {
      return { phase: "ready", model: prev.toModel };
    }
    return { phase: "ready", model: prev.model };
  }

  if (status.stage === "error") {
    if (status.repair) {
      return { phase: "setup", status, model: status.repair.model };
    }
    if (prev.phase === "switching") {
      return { phase: "setup", status, model: prev.toModel };
    }
  }

  if (prev.phase === "switching") {
    return { ...prev, status };
  }

  return { ...prev, status };
}
