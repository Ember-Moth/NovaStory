import { afterEach, expect, test } from "bun:test";

import type { ProjectAssistantService } from "@/modules/ai/server/project-assistant";
import { rpcTags } from "@/rpc/tags";

const handlers = await import("./index");
const { getProjectAssistantService, setProjectAssistantServiceForTests } =
  await import("@/modules/ai/server/project-assistant");

const requestCtx = { req: new Request("http://localhost/api/rpc") } as unknown as Parameters<
  typeof handlers.getProjectAssistantState.handler
>[1];

const originalService = getProjectAssistantService();

afterEach(() => {
  setProjectAssistantServiceForTests(originalService);
});

function useService(service: ProjectAssistantService) {
  setProjectAssistantServiceForTests(service);
}

test("getProjectAssistantState watches project heads, attempts, and active head messages", async () => {
  useService({
    getProjectAssistantState: () => ({
      head: {
        id: "ai_head_state",
        projectId: "rpc_assistant_state",
        name: "主会话",
        currentMessageId: null,
        forkedFromHeadId: null,
        forkedFromMessageId: null,
        isArchived: false,
        createdAt: 1,
        updatedAt: 1,
      },
      messages: [],
      attempts: [],
    }),
    sendProjectAssistantMessage: async () => {
      throw new Error("unused");
    },
    retryProjectAssistantMessage: async () => {
      throw new Error("unused");
    },
  });

  const result = await handlers.getProjectAssistantState.handler(
    { projectId: "rpc_assistant_state" },
    requestCtx,
  );

  expect(result.watch).toEqual([
    rpcTags.aiProjectAssistantState("rpc_assistant_state"),
    rpcTags.aiProjectHeads("rpc_assistant_state"),
    rpcTags.aiGenerationAttempts("rpc_assistant_state"),
    rpcTags.aiHeadMessages("ai_head_state"),
  ]);
});

test("sendProjectAssistantMessage invalidates head messages and attempts on success", async () => {
  useService({
    getProjectAssistantState: () => ({
      head: null,
      messages: [],
      attempts: [],
    }),
    sendProjectAssistantMessage: async () => ({
      head: {
        id: "ai_head_send",
        projectId: "rpc_assistant_send",
        name: "主会话",
        currentMessageId: "msg_assistant",
        forkedFromHeadId: null,
        forkedFromMessageId: null,
        isArchived: false,
        createdAt: 1,
        updatedAt: 2,
      },
      userMessage: {
        id: "msg_user",
        projectId: "rpc_assistant_send",
        prevMessageId: null,
        role: "user",
        content: { text: "Hello" },
        summaryText: "Hello",
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
      },
      assistantMessage: {
        id: "msg_assistant",
        projectId: "rpc_assistant_send",
        prevMessageId: "msg_user",
        role: "assistant",
        content: { text: "Hi" },
        summaryText: "Hi",
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
        createdAt: 2,
      },
      attempt: {
        id: "attempt_send",
        projectId: "rpc_assistant_send",
        headId: "ai_head_send",
        triggerMessageId: "msg_user",
        assistantMessageId: "msg_assistant",
        status: "success",
        request: { mode: "send" },
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
    }),
    retryProjectAssistantMessage: async () => {
      throw new Error("unused");
    },
  });

  const result = await handlers.sendProjectAssistantMessage.handler(
    {
      projectId: "rpc_assistant_send",
      headId: "ai_head_send",
      text: "Hello",
    },
    requestCtx,
  );

  expect(result.invalidate).toEqual([
    rpcTags.aiProjectAssistantState("rpc_assistant_send"),
    rpcTags.aiProjectHeads("rpc_assistant_send"),
    rpcTags.aiHeadMessages("ai_head_send"),
    rpcTags.aiGenerationAttempts("rpc_assistant_send"),
  ]);
});

test("retryProjectAssistantMessage invalidates head messages and attempts on success", async () => {
  useService({
    getProjectAssistantState: () => ({
      head: null,
      messages: [],
      attempts: [],
    }),
    sendProjectAssistantMessage: async () => {
      throw new Error("unused");
    },
    retryProjectAssistantMessage: async () => ({
      head: {
        id: "ai_head_retry",
        projectId: "rpc_assistant_retry",
        name: "主会话",
        currentMessageId: "msg_assistant_retry",
        forkedFromHeadId: null,
        forkedFromMessageId: null,
        isArchived: false,
        createdAt: 1,
        updatedAt: 3,
      },
      assistantMessage: {
        id: "msg_assistant_retry",
        projectId: "rpc_assistant_retry",
        prevMessageId: "msg_user_retry",
        role: "assistant",
        content: { text: "Retry ok" },
        summaryText: "Retry ok",
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
        createdAt: 3,
      },
      attempt: {
        id: "attempt_retry",
        projectId: "rpc_assistant_retry",
        headId: "ai_head_retry",
        triggerMessageId: "msg_user_retry",
        assistantMessageId: "msg_assistant_retry",
        status: "success",
        request: { mode: "retry" },
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
    }),
  });

  const result = await handlers.retryProjectAssistantMessage.handler(
    {
      projectId: "rpc_assistant_retry",
      headId: "ai_head_retry",
      triggerMessageId: "msg_user_retry",
    },
    requestCtx,
  );

  expect(result.invalidate).toEqual([
    rpcTags.aiProjectAssistantState("rpc_assistant_retry"),
    rpcTags.aiProjectHeads("rpc_assistant_retry"),
    rpcTags.aiHeadMessages("ai_head_retry"),
    rpcTags.aiGenerationAttempts("rpc_assistant_retry"),
  ]);
});
