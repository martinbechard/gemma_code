import type { SetupStatus } from "@shared/types";

export const RUNTIME_PREPARATION_STATUS: SetupStatus = {
  stage: "checking",
  message: "Preparing selected model...",
};

export type AppState =
  | { phase: "boot" }
  | { phase: "setup"; status: SetupStatus; model: string }
  | { phase: "ready"; model: string }
  | { phase: "switching"; model: string; toModel: string; status: SetupStatus };

export function selectReadyModel(prev: AppState, model: string): AppState {
  if (prev.phase === "setup") {
    return { ...prev, model };
  }
  if (prev.phase === "ready") {
    return { phase: "ready", model };
  }
  return prev;
}

export function runtimePreparationState(
  prev: AppState,
  model: string,
): AppState {
  if (prev.phase !== "ready") return prev;
  return {
    phase: "switching",
    model: prev.model,
    toModel: model,
    status: RUNTIME_PREPARATION_STATUS,
  };
}

export function preparedModelFromSetupStatus(
  prev: AppState,
  status: SetupStatus,
): string | null {
  if (status.stage !== "ready") return null;
  if (prev.phase === "setup") return prev.model;
  if (prev.phase === "switching") return prev.toModel;
  return null;
}

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
