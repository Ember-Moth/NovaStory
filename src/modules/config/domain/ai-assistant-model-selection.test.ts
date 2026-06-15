import { expect, test } from "bun:test";

import { setGlobalConfig } from "./global-config";
import {
  getAiAssistantModelSelection,
  setAiAssistantModelSelection,
} from "./ai-assistant-model-selection";

test("reads back a stored ai assistant model selection", () => {
  const selection = setAiAssistantModelSelection({
    connectionId: " conn-1 ",
    modelId: " model-1 ",
  });

  expect(selection).toEqual({
    connectionId: "conn-1",
    modelId: "model-1",
  });
  expect(getAiAssistantModelSelection()).toEqual({
    connectionId: "conn-1",
    modelId: "model-1",
  });
});

test("returns null for missing or malformed selections", () => {
  expect(getAiAssistantModelSelection()).toBeNull();

  setGlobalConfig("ai.assistant.modelSelection", { connectionId: "conn-only" });
  expect(getAiAssistantModelSelection()).toBeNull();

  setGlobalConfig("ai.assistant.modelSelection", "broken");
  expect(getAiAssistantModelSelection()).toBeNull();
});

test("clearing or writing incomplete selections removes the stored value", () => {
  setAiAssistantModelSelection({
    connectionId: "conn-1",
    modelId: "model-1",
  });
  expect(getAiAssistantModelSelection()).not.toBeNull();

  expect(setAiAssistantModelSelection(null)).toBeNull();
  expect(getAiAssistantModelSelection()).toBeNull();

  setAiAssistantModelSelection({
    connectionId: "conn-2",
    modelId: "model-2",
  });
  expect(setAiAssistantModelSelection({ connectionId: "conn-2", modelId: " " })).toBeNull();
  expect(getAiAssistantModelSelection()).toBeNull();
});
