import { expect, test } from "vitest";

import {
  PROJECT_ASSISTANT_READ_ONLY_TOOL_NAMES,
  PROJECT_ASSISTANT_WRITE_TOOL_NAMES,
} from "@/modules/ai/domain/types";

import {
  buildProjectAssistantRetryActiveTools,
  buildProjectAssistantSendActiveTools,
} from "./activeTools";

test("buildProjectAssistantSendActiveTools excludes write tools when writes are disabled", () => {
  expect(buildProjectAssistantSendActiveTools({ allowWrites: false })).toEqual([
    ...PROJECT_ASSISTANT_READ_ONLY_TOOL_NAMES,
  ]);
});

test("buildProjectAssistantSendActiveTools includes write tools when writes are enabled", () => {
  expect(buildProjectAssistantSendActiveTools({ allowWrites: true })).toEqual([
    ...PROJECT_ASSISTANT_READ_ONLY_TOOL_NAMES,
    ...PROJECT_ASSISTANT_WRITE_TOOL_NAMES,
  ]);
});

test("buildProjectAssistantRetryActiveTools always stays read-only", () => {
  expect(buildProjectAssistantRetryActiveTools()).toEqual([
    ...PROJECT_ASSISTANT_READ_ONLY_TOOL_NAMES,
  ]);
});
