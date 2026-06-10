import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeEach, expect, test } from "bun:test";
const tempDir = mkdtempSync(join(tmpdir(), "novel-evolver-ai-assistant-"));
const dbPath = join(tempDir, "assistant.sqlite");
process.env.DATABASE_URL = dbPath;

const { db, schema } = await import("@/db");
const logs = await import("@/modules/ai/domain/logs");
const { PROJECT_ASSISTANT_SYSTEM_PROMPT_ID, createProjectAssistantService } =
  await import("./project-assistant");

function seedProject(projectId: string) {
  db.insert(schema.projects)
    .values({
      id: projectId,
      name: `Project ${projectId}`,
      description: null,
    })
    .run();
}

function seedCustomConnection({
  connectionId,
  modelId,
  modelRowId,
  apiKey = "sk-test",
}: {
  connectionId: string;
  modelId: string;
  modelRowId: string;
  apiKey?: string | null;
}) {
  db.insert(schema.aiConnections)
    .values({
      id: connectionId,
      kind: "custom",
      name: "Primary Connection",
      sdkPackage: "@ai-sdk/openai-compatible",
      baseUrl: "https://example.test/v1",
      apiKey,
      configJson: "{}",
      isEnabled: true,
    })
    .run();
  db.insert(schema.aiConnectionCustomModels)
    .values({
      id: modelRowId,
      connectionId,
      modelId,
      displayName: "Story Model",
      supportsReasoning: true,
      isEnabled: true,
    })
    .run();

  return {
    connectionId,
    selection: {
      connectionId,
      modelId: `custom:${modelRowId}`,
    },
  };
}

function getText(content: unknown) {
  if (!content || typeof content !== "object") {
    return "";
  }

  const text = Reflect.get(content as Record<string, unknown>, "text");
  return typeof text === "string" ? text : "";
}

beforeEach(() => {
  db.delete(schema.globalConfigOptions).run();
  db.delete(schema.aiProjectGenerationAttempts).run();
  db.delete(schema.aiProjectHeads).run();
  db.delete(schema.aiProjectMessages).run();
  db.delete(schema.aiConnectionCatalogOverrides).run();
  db.delete(schema.aiConnectionCustomModels).run();
  db.delete(schema.aiConnections).run();
  db.delete(schema.aiCatalogModels).run();
  db.delete(schema.aiCatalogProviders).run();
  db.delete(schema.aiRegistryState).run();
  db.delete(schema.auxNodeLayers).run();
  db.delete(schema.contentNodes).run();
  db.delete(schema.timelinePoints).run();
  db.delete(schema.auxNodes).run();
  db.delete(schema.workspaces).run();
  db.delete(schema.projects).run();
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

test("send appends messages to the explicit head and records attempt state", async () => {
  seedProject("assistant_send");
  const seeded = seedCustomConnection({
    connectionId: "conn_send",
    modelId: "story-model",
    modelRowId: "cmodel_send",
  });
  const calls: Array<{ system: string; messages: Array<{ role: string; content: string }> }> = [];
  const service = createProjectAssistantService({
    readStoredSelection: () => seeded.selection,
    generateAssistantText: async ({ system, messages }) => {
      calls.push({ system, messages });
      return {
        text: "Assistant reply",
        usage: { totalTokens: 42 },
        finishReason: "stop",
      };
    },
  });
  const head = logs.createAssistantSession("assistant_send");

  const result = await service.sendProjectAssistantMessage({
    projectId: "assistant_send",
    headId: head.id,
    text: "  Hello world  ",
  });
  const state = service.getProjectAssistantState("assistant_send");

  expect(result.head.id).toBe(head.id);
  expect(state.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
  expect(getText(state.messages[0]?.content)).toBe("Hello world");
  expect(getText(state.messages[1]?.content)).toBe("Assistant reply");
  expect(state.attempts).toHaveLength(1);
  const attempt = state.attempts[0];
  expect(attempt?.status).toBe("success");
  expect((attempt?.request as Record<string, unknown> | undefined)?.systemPromptId).toBe(
    PROJECT_ASSISTANT_SYSTEM_PROMPT_ID,
  );
  expect(calls[0]?.messages).toEqual([{ role: "user", content: "Hello world" }]);
});

test("send uses the provided head and makes it the active assistant session", async () => {
  seedProject("assistant_active_head");
  const seeded = seedCustomConnection({
    connectionId: "conn_active_head",
    modelId: "story-model",
    modelRowId: "cmodel_active_head",
  });
  const service = createProjectAssistantService({
    readStoredSelection: () => seeded.selection,
    generateAssistantText: async () => ({
      text: "Follow-up",
      usage: null,
      finishReason: "stop",
    }),
  });

  const headA = logs.createHead({
    projectId: "assistant_active_head",
    name: "Head A",
  });
  const headB = logs.createHead({
    projectId: "assistant_active_head",
    name: "Head B",
  });
  logs.appendMessage({
    projectId: "assistant_active_head",
    headId: headA.id,
    prevMessageId: null,
    role: "user",
    content: { text: "existing" },
    summaryText: "existing",
  });
  logs.setActiveAssistantHead("assistant_active_head", headB.id);

  const result = await service.sendProjectAssistantMessage({
    projectId: "assistant_active_head",
    headId: headA.id,
    text: "Next prompt",
  });

  expect(result.head.id).toBe(headA.id);
  expect(logs.resolveHeadMessages(headA.id).map((message) => getText(message.content))).toEqual([
    "existing",
    "Next prompt",
    "Follow-up",
  ]);
  expect(logs.resolveHeadMessages(headB.id)).toEqual([]);
  expect(service.getProjectAssistantState("assistant_active_head").head?.id).toBe(headA.id);
});

test("retry reuses the trigger user message and appends only a new assistant reply", async () => {
  seedProject("assistant_retry");
  const seeded = seedCustomConnection({
    connectionId: "conn_retry",
    modelId: "story-model",
    modelRowId: "cmodel_retry",
  });
  const service = createProjectAssistantService({
    readStoredSelection: () => seeded.selection,
    generateAssistantText: async () => ({
      text: "Retried reply",
      usage: { totalTokens: 9 },
      finishReason: "stop",
    }),
  });

  const head = logs.createHead({
    projectId: "assistant_retry",
    name: "主会话",
    initialMessage: {
      role: "user",
      content: { text: "Need help" },
      summaryText: "Need help",
    },
  });
  const triggerMessageId = head.currentMessageId!;
  const failedAttempt = logs.recordGenerationAttempt({
    projectId: "assistant_retry",
    headId: head.id,
    triggerMessageId,
    request: { prompt: "Need help" },
  });
  logs.completeGenerationAttemptError({
    attemptId: failedAttempt.id,
    error: { message: "boom" },
  });

  await service.retryProjectAssistantMessage({
    projectId: "assistant_retry",
    headId: head.id,
    triggerMessageId,
  });

  const state = service.getProjectAssistantState("assistant_retry");
  expect(state.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
  expect(state.messages.filter((message) => message.role === "user")).toHaveLength(1);
  expect(getText(state.messages.at(-1)?.content)).toBe("Retried reply");
  expect(state.attempts.map((attempt) => attempt.status)).toEqual(["error", "success"]);
});

test("send records an error attempt when generation fails", async () => {
  seedProject("assistant_failure");
  const seeded = seedCustomConnection({
    connectionId: "conn_failure",
    modelId: "story-model",
    modelRowId: "cmodel_failure",
  });
  const service = createProjectAssistantService({
    readStoredSelection: () => seeded.selection,
    generateAssistantText: async () => {
      throw new Error("provider exploded");
    },
  });

  await expect(
    service.sendProjectAssistantMessage({
      projectId: "assistant_failure",
      headId: logs.createAssistantSession("assistant_failure").id,
      text: "Hello",
    }),
  ).rejects.toThrow("provider exploded");

  const state = service.getProjectAssistantState("assistant_failure");
  expect(state.messages.map((message) => message.role)).toEqual(["user"]);
  expect(state.attempts).toHaveLength(1);
  expect(state.attempts[0]?.status).toBe("error");
  expect(getAttemptErrorMessage(state.attempts[0]?.error)).toBe("provider exploded");
});

test("send rejects while the head has a pending attempt", async () => {
  seedProject("assistant_pending");
  const seeded = seedCustomConnection({
    connectionId: "conn_pending",
    modelId: "story-model",
    modelRowId: "cmodel_pending",
  });
  const service = createProjectAssistantService({
    readStoredSelection: () => seeded.selection,
    generateAssistantText: async () => ({
      text: "unused",
      usage: null,
      finishReason: "stop",
    }),
  });

  const head = logs.createHead({
    projectId: "assistant_pending",
    name: "主会话",
  });
  logs.recordGenerationAttempt({
    projectId: "assistant_pending",
    headId: head.id,
    request: { prompt: "pending" },
  });

  await expect(
    service.sendProjectAssistantMessage({
      projectId: "assistant_pending",
      headId: head.id,
      text: "Blocked",
    }),
  ).rejects.toThrow("当前会话正在生成回复，请稍后再试。");
});

function getAttemptErrorMessage(error: unknown) {
  if (!error || typeof error !== "object") {
    return "";
  }

  const message = Reflect.get(error as Record<string, unknown>, "message");
  return typeof message === "string" ? message : "";
}
