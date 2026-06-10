import { expect, test } from "bun:test";

import {
  canSendAssistantMessage,
  clampSessionSectionHeight,
  resolveNearestSheetState,
  resolveReleasedSheetState,
  resolvePeekSessionHeight,
  resolvePreviewSessionBodyHeight,
  selectPendingAttempt,
  selectRetryableAttempt,
} from "./AiSidebar";

const baseState = {
  head: null,
  messages: [],
  attempts: [],
};

test("canSendAssistantMessage requires a hydrated model selection, non-empty draft, and idle state", () => {
  expect(
    canSendAssistantMessage({
      draft: "Hello",
      headId: "head_1",
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
      headId: "head_1",
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
      headId: "head_1",
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
      headId: "head_1",
      selectedConnectionId: "conn_1",
      selectedModelId: "custom:model_1",
      selectionHydrated: true,
      isBusy: true,
      hasPendingAttempt: false,
    }),
  ).toBe(false);

  expect(
    canSendAssistantMessage({
      draft: "Hello",
      headId: null,
      selectedConnectionId: "conn_1",
      selectedModelId: "custom:model_1",
      selectionHydrated: true,
      isBusy: false,
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

test("clampSessionSectionHeight keeps drag heights inside the allowed range", () => {
  expect(clampSessionSectionHeight(-12, 320)).toBe(0);
  expect(clampSessionSectionHeight(160, 320)).toBe(160);
  expect(clampSessionSectionHeight(480, 320)).toBe(320);
});

test("resolveNearestSheetState snaps intermediate heights to the nearest anchor", () => {
  const anchors = {
    closed: 0,
    peek: 120,
    expanded: 360,
  } as const;

  expect(resolveNearestSheetState(18, anchors)).toBe("closed");
  expect(resolveNearestSheetState(140, anchors)).toBe("peek");
  expect(resolveNearestSheetState(310, anchors)).toBe("expanded");
});

test("resolveReleasedSheetState keeps expanded easier to reach from peek", () => {
  const anchors = {
    closed: 0,
    peek: 120,
    expanded: 344,
  } as const;

  expect(
    resolveReleasedSheetState({
      height: 200,
      anchors,
      startState: "peek",
    }),
  ).toBe("expanded");

  expect(
    resolveReleasedSheetState({
      height: 180,
      anchors,
      startState: "closed",
    }),
  ).toBe("peek");
});

test("resolveReleasedSheetState caps the peek-to-expanded threshold on tall layouts", () => {
  const anchors = {
    closed: 0,
    peek: 120,
    expanded: 520,
  } as const;

  expect(
    resolveReleasedSheetState({
      height: 192,
      anchors,
      startState: "peek",
    }),
  ).toBe("expanded");
});

test("resolveReleasedSheetState also caps the expanded-to-peek threshold on tall layouts", () => {
  const anchors = {
    closed: 0,
    peek: 120,
    expanded: 520,
  } as const;

  expect(
    resolveReleasedSheetState({
      height: 448,
      anchors,
      startState: "expanded",
    }),
  ).toBe("peek");

  expect(
    resolveReleasedSheetState({
      height: 470,
      anchors,
      startState: "expanded",
    }),
  ).toBe("expanded");
});

test("resolvePreviewSessionBodyHeight picks the first three visible session rows", () => {
  expect(
    resolvePreviewSessionBodyHeight({
      visibleRowBottoms: [],
      emptyStateHeight: 68,
    }),
  ).toBe(68);

  expect(
    resolvePreviewSessionBodyHeight({
      visibleRowBottoms: [44],
      emptyStateHeight: 68,
    }),
  ).toBe(44);

  expect(
    resolvePreviewSessionBodyHeight({
      visibleRowBottoms: [44, 88],
      emptyStateHeight: 68,
    }),
  ).toBe(88);

  expect(
    resolvePreviewSessionBodyHeight({
      visibleRowBottoms: [44, 88, 132, 176, 220],
      emptyStateHeight: 68,
    }),
  ).toBe(132);
});

test("resolvePeekSessionHeight uses only preview body height and respects the available height", () => {
  expect(
    resolvePeekSessionHeight({
      previewBodyHeight: 132,
      maxHeight: 320,
    }),
  ).toBe(132);

  expect(
    resolvePeekSessionHeight({
      previewBodyHeight: 132,
      maxHeight: 120,
    }),
  ).toBe(120);
});
