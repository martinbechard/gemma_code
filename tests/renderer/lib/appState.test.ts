import { describe, expect, it } from "vitest";
import {
  applySetupStatus,
  preparedModelFromSetupStatus,
  runtimePreparationState,
  selectReadyModel,
  type AppState,
} from "../../../src/renderer/src/lib/appState";
import type { SetupStatus } from "../../../src/shared/types";

const CHECKING_STATUS: SetupStatus = {
  stage: "checking",
  message: "Checking system...",
};

const READY_STATUS: SetupStatus = {
  stage: "ready",
  message: "Ready to chat.",
};

const ERROR_STATUS: SetupStatus = {
  stage: "error",
  message: "Model switch failed",
  error: "Missing COHERE_API_KEY",
};

describe("applySetupStatus", () => {
  it("ignores late setup statuses after chat is already ready", () => {
    const ready: AppState = {
      phase: "ready",
      model: "north-mini-code-1-0",
    };

    expect(applySetupStatus(ready, CHECKING_STATUS)).toBe(ready);
    expect(applySetupStatus(ready, READY_STATUS)).toBe(ready);
  });

  it("keeps the selected setup model when setup becomes ready", () => {
    expect(
      applySetupStatus(
        {
          phase: "setup",
          model: "north-mini-code-1-0",
          status: CHECKING_STATUS,
        },
        READY_STATUS,
      ),
    ).toEqual({ phase: "ready", model: "north-mini-code-1-0" });
  });

  it("uses the target model when a runtime switch succeeds", () => {
    expect(
      applySetupStatus(
        {
          phase: "switching",
          model: "mlx-community/gemma-4-e4b-it-4bit",
          toModel: "north-mini-code-1-0",
          status: CHECKING_STATUS,
        },
        READY_STATUS,
      ),
    ).toEqual({ phase: "ready", model: "north-mini-code-1-0" });
  });

  it("shows setup error state for the target model when switching fails", () => {
    expect(
      applySetupStatus(
        {
          phase: "switching",
          model: "mlx-community/gemma-4-e4b-it-4bit",
          toModel: "north-mini-code-1-0",
          status: CHECKING_STATUS,
        },
        ERROR_STATUS,
      ),
    ).toEqual({
      phase: "setup",
      model: "north-mini-code-1-0",
      status: ERROR_STATUS,
    });
  });
});

describe("selectReadyModel", () => {
  it("changes the selected ready model without starting runtime switching", () => {
    expect(
      selectReadyModel(
        {
          phase: "ready",
          model: "gemma-4-31b-it",
        },
        "mlx-community/gemma-4-e4b-it-4bit",
      ),
    ).toEqual({
      phase: "ready",
      model: "mlx-community/gemma-4-e4b-it-4bit",
    });
  });

  it("keeps setup selection inside setup state", () => {
    expect(
      selectReadyModel(
        {
          phase: "setup",
          model: "gemma-4-31b-it",
          status: CHECKING_STATUS,
        },
        "mlx-community/gemma-4-e4b-it-4bit",
      ),
    ).toEqual({
      phase: "setup",
      model: "mlx-community/gemma-4-e4b-it-4bit",
      status: CHECKING_STATUS,
    });
  });
});

describe("runtimePreparationState", () => {
  it("enters switching only when a send needs a different prepared model", () => {
    expect(
      runtimePreparationState(
        {
          phase: "ready",
          model: "mlx-community/gemma-4-e4b-it-4bit",
        },
        "gemma-4-31b-it",
      ),
    ).toEqual({
      phase: "switching",
      model: "mlx-community/gemma-4-e4b-it-4bit",
      toModel: "gemma-4-31b-it",
      status: {
        stage: "checking",
        message: "Preparing selected model...",
      },
    });
  });
});

describe("preparedModelFromSetupStatus", () => {
  it("records the setup model when setup reaches ready", () => {
    expect(
      preparedModelFromSetupStatus(
        {
          phase: "setup",
          model: "mlx-community/gemma-4-e4b-it-4bit",
          status: CHECKING_STATUS,
        },
        READY_STATUS,
      ),
    ).toBe("mlx-community/gemma-4-e4b-it-4bit");
  });

  it("records the target model when switching reaches ready", () => {
    expect(
      preparedModelFromSetupStatus(
        {
          phase: "switching",
          model: "gemma-4-31b-it",
          toModel: "mlx-community/gemma-4-e4b-it-4bit",
          status: CHECKING_STATUS,
        },
        READY_STATUS,
      ),
    ).toBe("mlx-community/gemma-4-e4b-it-4bit");
  });

  it("does not record a prepared model for non-ready statuses", () => {
    expect(
      preparedModelFromSetupStatus(
        {
          phase: "switching",
          model: "gemma-4-31b-it",
          toModel: "mlx-community/gemma-4-e4b-it-4bit",
          status: CHECKING_STATUS,
        },
        CHECKING_STATUS,
      ),
    ).toBeNull();
  });
});
