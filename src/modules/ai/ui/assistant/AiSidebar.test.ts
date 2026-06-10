import { expect, test } from "bun:test";

import { canSendAssistantMessage, selectPendingAttempt, selectRetryableAttempt } from "./AiSidebar";

const baseState = {
  head: null,
  messages: [],
  attempts: [],
};

test("canSendAssistantMessage requires a hydrated model selection, non-empty draft, and idle state", () => {
  expect(
    canSendAssistantMessage({
      draft: "Hello",
      selectedConnectionId: "conn_1",
      selectedModelId: "custom:model_1",
      selectionHydrated: true,
      isBusy: false,
      hasPendingAttempt: false,
    }),
  ).toBe(true);

  expect(
    canSendAssistantMessage({
      draft: "   ",
      selectedConnectionId: "conn_1",
      selectedModelId: "custom:model_1",
      selectionHydrated: true,
      isBusy: false,
      hasPendingAttempt: false,
    }),
  ).toBe(false);

  expect(
    canSendAssistantMessage({
      draft: "Hello",
      selectedConnectionId: "",
      selectedModelId: "custom:model_1",
      selectionHydrated: true,
      isBusy: false,
      hasPendingAttempt: false,
    }),
  ).toBe(false);

  expect(
    canSendAssistantMessage({
      draft: "Hello",
      selectedConnectionId: "conn_1",
      selectedModelId: "custom:model_1",
      selectionHydrated: true,
      isBusy: true,
      hasPendingAttempt: false,
    }),
  ).toBe(false);
});

test("selectRetryableAttempt only returns the latest failed attempt with a trigger message", () => {
  expect(selectRetryableAttempt(baseState)).toBeNull();

  expect(
    selectRetryableAttempt({
      ...baseState,
      attempts: [
        {
          id: "attempt_ok",
          projectId: "project_1",
          headId: "head_1",
          triggerMessageId: "msg_1",
          assistantMessageId: "msg_2",
          status: "success",
          request: {},
          usage: null,
          error: null,
          selection: {
            connectionId: null,
            catalogModelId: null,
            customModelId: null,
            connectionName: null,
            sdkPackage: null,
            baseUrl: null,
            modelOrigin: null,
            modelId: null,
            modelDisplayName: null,
            modelFamily: null,
            capabilities: null,
            pricing: null,
          },
          createdAt: 1,
          completedAt: 2,
        },
        {
          id: "attempt_failed",
          projectId: "project_1",
          headId: "head_1",
          triggerMessageId: "msg_3",
          assistantMessageId: null,
          status: "error",
          request: {},
          usage: null,
          error: { message: "boom" },
          selection: {
            connectionId: null,
            catalogModelId: null,
            customModelId: null,
            connectionName: null,
            sdkPackage: null,
            baseUrl: null,
            modelOrigin: null,
            modelId: null,
            modelDisplayName: null,
            modelFamily: null,
            capabilities: null,
            pricing: null,
          },
          createdAt: 3,
          completedAt: 4,
        },
      ],
    })?.id,
  ).toBe("attempt_failed");
});

test("selectPendingAttempt only returns the latest pending attempt with a trigger message", () => {
  expect(selectPendingAttempt(baseState)).toBeNull();

  expect(
    selectPendingAttempt({
      ...baseState,
      attempts: [
        {
          id: "attempt_pending",
          projectId: "project_1",
          headId: "head_1",
          triggerMessageId: "msg_1",
          assistantMessageId: null,
          status: "pending",
          request: {},
          usage: null,
          error: null,
          selection: {
            connectionId: null,
            catalogModelId: null,
            customModelId: null,
            connectionName: null,
            sdkPackage: null,
            baseUrl: null,
            modelOrigin: null,
            modelId: null,
            modelDisplayName: null,
            modelFamily: null,
            capabilities: null,
            pricing: null,
          },
          createdAt: 5,
          completedAt: null,
        },
      ],
    })?.id,
  ).toBe("attempt_pending");
});
