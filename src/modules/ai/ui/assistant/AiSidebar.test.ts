import { expect, test } from "bun:test";

import {
  applyRetryResultToState,
  applySendResultToState,
  canSendAssistantMessage,
  selectPendingAttempt,
  selectRetryableAttempt,
} from "./assistantState";
import {
  clampSessionSectionHeight,
  resolveNearestSheetState,
  resolvePeekSessionHeight,
  resolveReleasedSheetState,
  resolveSessionSectionHeight,
  resolveSheetAnchors,
  SESSION_PEEK_HEIGHT,
  SHEET_HANDLE_HEIGHT,
} from "./assistantSheetLayout";
import { resolveExpectedActiveHeadAfterArchiveToggle } from "./useAiAssistantController";

const baseState = {
  head: null,
  messages: [],
  attempts: [],
};

const baseHead = {
  id: "head_1",
  projectId: "project_1",
  name: "会话 1",
  currentMessageId: "msg_1",
  forkedFromHeadId: null,
  forkedFromMessageId: null,
  isArchived: false,
  createdAt: 1,
  updatedAt: 1,
};

const baseMessage = {
  id: "msg_1",
  projectId: "project_1",
  prevMessageId: null,
  role: "user" as const,
  content: { text: "hello" },
  summaryText: "hello",
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
  metadata: null,
  createdAt: 1,
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

test("resolvePeekSessionHeight uses a fixed three-row height and respects the available height", () => {
  expect(
    resolvePeekSessionHeight({
      maxHeight: 320,
    }),
  ).toBe(132);

  expect(
    resolvePeekSessionHeight({
      maxHeight: 120,
    }),
  ).toBe(120);
});

test("resolveSheetAnchors keeps the initial unmeasured layout at peek height instead of zero", () => {
  expect(
    resolveSheetAnchors({
      availableBodyHeight: 0,
      hasMeasuredLayout: false,
    }),
  ).toEqual({
    closed: 0,
    peek: SESSION_PEEK_HEIGHT,
    expanded: SESSION_PEEK_HEIGHT,
  });
});

test("resolveSessionSectionHeight only clamps after the body has been measured", () => {
  expect(
    resolveSessionSectionHeight({
      requestedHeight: SESSION_PEEK_HEIGHT,
      availableBodyHeight: 0,
      hasMeasuredLayout: false,
    }),
  ).toBe(SESSION_PEEK_HEIGHT);

  expect(
    resolveSessionSectionHeight({
      requestedHeight: SESSION_PEEK_HEIGHT,
      availableBodyHeight: 120,
      hasMeasuredLayout: true,
    }),
  ).toBe(104);
});

test("resolveSheetAnchors keeps expanded height below the drag handle", () => {
  expect(
    resolveSheetAnchors({
      availableBodyHeight: 320,
      hasMeasuredLayout: true,
    }).expanded,
  ).toBe(320 - SHEET_HANDLE_HEIGHT);
});

test("applySendResultToState appends the optimistic user and assistant messages once", () => {
  const result = applySendResultToState(baseState, {
    head: baseHead,
    userMessage: baseMessage,
    assistantMessage: {
      ...baseMessage,
      id: "msg_2",
      role: "assistant",
      content: { text: "reply" },
      summaryText: "reply",
      prevMessageId: "msg_1",
      createdAt: 2,
    },
    attempt: {
      id: "attempt_1",
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
      createdAt: 2,
      completedAt: 3,
    },
  });

  expect(result.head?.id).toBe("head_1");
  expect(result.messages.map((message) => message.id)).toEqual(["msg_1", "msg_2"]);
  expect(result.attempts.map((attempt) => attempt.id)).toEqual(["attempt_1"]);
});

test("applyRetryResultToState appends a retry reply without dropping existing messages", () => {
  const result = applyRetryResultToState(
    {
      head: baseHead,
      messages: [baseMessage],
      attempts: [],
    },
    {
      head: baseHead,
      assistantMessage: {
        ...baseMessage,
        id: "msg_2",
        role: "assistant",
        content: { text: "retry reply" },
        summaryText: "retry reply",
        prevMessageId: "msg_1",
        createdAt: 2,
      },
      attempt: {
        id: "attempt_2",
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
        createdAt: 2,
        completedAt: 3,
      },
    },
  );

  expect(result.messages.map((message) => message.id)).toEqual(["msg_1", "msg_2"]);
  expect(result.attempts.map((attempt) => attempt.id)).toEqual(["attempt_2"]);
});

test("resolveExpectedActiveHeadAfterArchiveToggle falls back when archiving the active head", () => {
  expect(
    resolveExpectedActiveHeadAfterArchiveToggle({
      activeHeadId: "head_1",
      head: baseHead,
      archived: true,
      unarchivedHeads: [
        baseHead,
        {
          ...baseHead,
          id: "head_2",
          name: "会话 2",
        },
      ],
    }),
  ).toBe("head_2");

  expect(
    resolveExpectedActiveHeadAfterArchiveToggle({
      activeHeadId: null,
      head: {
        ...baseHead,
        id: "head_3",
      },
      archived: false,
      unarchivedHeads: [],
    }),
  ).toBe("head_3");
});
