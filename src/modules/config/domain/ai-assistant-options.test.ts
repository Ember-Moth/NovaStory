import { expect, test } from "vitest";

import { PROJECT_ASSISTANT_MAX_STEPS } from "@/modules/ai/domain/types";
import {
  AI_ASSISTANT_MAX_STEPS_MAX,
  AI_ASSISTANT_MAX_STEPS_MIN,
  getAiAssistantMaxSteps,
  setAiAssistantMaxSteps,
} from "./ai-assistant-options";
import { setGlobalConfig } from "./global-config";

test("reads the default assistant max steps when unset", () => {
  expect(getAiAssistantMaxSteps()).toBe(PROJECT_ASSISTANT_MAX_STEPS);
});

test("stores normalized assistant max steps", () => {
  expect(setAiAssistantMaxSteps(6.8)).toBe(6);
  expect(getAiAssistantMaxSteps()).toBe(6);
});

test("invalid assistant max steps clear back to the default", () => {
  setAiAssistantMaxSteps(8);
  expect(getAiAssistantMaxSteps()).toBe(8);

  expect(setAiAssistantMaxSteps(null)).toBe(PROJECT_ASSISTANT_MAX_STEPS);
  expect(getAiAssistantMaxSteps()).toBe(PROJECT_ASSISTANT_MAX_STEPS);

  setGlobalConfig("ai.assistant.maxSteps", "broken");
  expect(getAiAssistantMaxSteps()).toBe(PROJECT_ASSISTANT_MAX_STEPS);

  setGlobalConfig("ai.assistant.maxSteps", AI_ASSISTANT_MAX_STEPS_MIN - 1);
  expect(getAiAssistantMaxSteps()).toBe(PROJECT_ASSISTANT_MAX_STEPS);

  setGlobalConfig("ai.assistant.maxSteps", AI_ASSISTANT_MAX_STEPS_MAX + 1);
  expect(getAiAssistantMaxSteps()).toBe(PROJECT_ASSISTANT_MAX_STEPS);
});
