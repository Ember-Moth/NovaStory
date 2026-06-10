import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

const tempDir = mkdtempSync(join(tmpdir(), "novel-evolver-ai-logs-domain-"));
const dbPath = join(tempDir, "ai-logs-domain.sqlite");
process.env.DATABASE_URL = dbPath;

const { db, schema } = await import("@/db");
const logs = await import("./logs");

function seedProject(projectId: string, updatedAt = 1) {
  db.insert(schema.projects)
    .values({
      id: projectId,
      name: `Project ${projectId}`,
      description: null,
      createdAt: updatedAt,
      updatedAt,
    })
    .run();
}

function seedCustomConnection(params: {
  connectionId: string;
  modelId: string;
  modelRowId: string;
}) {
  db.insert(schema.aiConnections)
    .values({
      id: params.connectionId,
      kind: "custom",
      name: "Primary Connection",
      sdkPackage: "@ai-sdk/openai-compatible",
      baseUrl: "https://example.test/v1",
      apiKey: "sk-test",
      configJson: "{}",
      isEnabled: true,
    })
    .run();
  db.insert(schema.aiConnectionCustomModels)
    .values({
      id: params.modelRowId,
      connectionId: params.connectionId,
      modelId: params.modelId,
      displayName: "Story Model",
      supportsToolUse: true,
      supportsReasoning: true,
      inputPricePer1m: 1.25,
      outputPricePer1m: 4.5,
      isEnabled: true,
    })
    .run();
}

beforeEach(() => {
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

test("create head, append messages, and resolve the active chain in order", () => {
  seedProject("project_ai_chain");

  const head = logs.createHead({
    projectId: "project_ai_chain",
    name: "Main",
    initialMessage: {
      role: "user",
      content: { text: "Hello" },
      summaryText: "Hello",
    },
  });

  const initialMessages = logs.resolveHeadMessages(head.id);
  expect(initialMessages).toHaveLength(1);
  expect(initialMessages[0]?.content).toEqual({ text: "Hello" });

  const appended = logs.appendMessage({
    projectId: "project_ai_chain",
    headId: head.id,
    prevMessageId: head.currentMessageId,
    role: "assistant",
    content: { text: "Hi there" },
    summaryText: "Hi there",
  });

  const resolved = logs.resolveHeadMessages(head.id);
  expect(resolved.map((message) => message.role)).toEqual(["user", "assistant"]);
  expect(resolved.at(-1)?.id).toBe(appended.id);

  const project = db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, "project_ai_chain"))
    .get();
  expect(project?.updatedAt).toBeGreaterThan(1);
});

test("forking from a historical message creates a sibling revision without copying the tail", () => {
  seedProject("project_ai_fork");

  const head = logs.createHead({
    projectId: "project_ai_fork",
    name: "Draft",
    initialMessage: {
      role: "system",
      content: { text: "root" },
      summaryText: "root",
    },
  });
  const originalRoot = logs.resolveHeadMessages(head.id)[0]!;
  const middle = logs.appendMessage({
    projectId: "project_ai_fork",
    headId: head.id,
    prevMessageId: head.currentMessageId,
    role: "user",
    content: { text: "version-a" },
    summaryText: "version-a",
  });
  logs.appendMessage({
    projectId: "project_ai_fork",
    headId: head.id,
    prevMessageId: middle.id,
    role: "assistant",
    content: { text: "tail-a" },
    summaryText: "tail-a",
  });

  const forkedHead = logs.forkHeadFromMessage({
    projectId: "project_ai_fork",
    sourceHeadId: head.id,
    sourceMessageId: middle.id,
    name: "Draft v2",
    role: "user",
    content: { text: "version-b" },
    summaryText: "version-b",
  });

  expect(logs.resolveHeadMessages(head.id).map((message) => message.summaryText)).toEqual([
    "root",
    "version-a",
    "tail-a",
  ]);
  expect(logs.resolveHeadMessages(forkedHead.id).map((message) => message.summaryText)).toEqual([
    "root",
    "version-b",
  ]);

  const rootChildren = logs.listHeadChildren("project_ai_fork", originalRoot.id);
  expect(rootChildren.map((message) => message.summaryText)).toEqual(["version-a", "version-b"]);
  expect(
    logs.listHeadChildren("project_ai_fork", middle.id).map((message) => message.summaryText),
  ).toEqual(["tail-a"]);
});

test("append rejects stale prevMessageId for a moved head", () => {
  seedProject("project_ai_stale");

  const head = logs.createHead({
    projectId: "project_ai_stale",
    initialMessage: {
      role: "user",
      content: { text: "draft" },
      summaryText: "draft",
    },
  });
  const firstLeaf = head.currentMessageId;
  const next = logs.appendMessage({
    projectId: "project_ai_stale",
    headId: head.id,
    prevMessageId: firstLeaf,
    role: "assistant",
    content: { text: "reply" },
    summaryText: "reply",
  });

  expect(next.prevMessageId).toBe(firstLeaf);
  expect(() =>
    logs.appendMessage({
      projectId: "project_ai_stale",
      headId: head.id,
      prevMessageId: firstLeaf,
      role: "assistant",
      content: { text: "stale" },
      summaryText: "stale",
    }),
  ).toThrow("AI 分支已经推进，请基于最新叶子继续对话。");
});

test("message snapshots stay readable after referenced connection and model are deleted", () => {
  seedProject("project_ai_snapshot");
  seedCustomConnection({
    connectionId: "conn_snapshot",
    modelId: "story-model",
    modelRowId: "cmodel_snapshot",
  });

  const head = logs.createHead({
    projectId: "project_ai_snapshot",
    initialMessage: {
      role: "user",
      content: { text: "snapshot" },
      summaryText: "snapshot",
      aiSelection: {
        customModelId: "cmodel_snapshot",
      },
    },
  });

  db.delete(schema.aiConnections).where(eq(schema.aiConnections.id, "conn_snapshot")).run();

  const [message] = logs.resolveHeadMessages(head.id);
  expect(message?.selection.connectionId).toBeNull();
  expect(message?.selection.customModelId).toBeNull();
  expect(message?.selection.connectionName).toBe("Primary Connection");
  expect(message?.selection.modelDisplayName).toBe("Story Model");
  expect(message?.selection.capabilities).toEqual({
    supportsVision: false,
    supportsToolUse: true,
    supportsReasoning: true,
    supportsTemperature: false,
  });
});

test("generation attempts can be completed with success or error payloads", () => {
  seedProject("project_ai_attempts");

  const head = logs.createHead({
    projectId: "project_ai_attempts",
    initialMessage: {
      role: "user",
      content: { text: "trigger" },
      summaryText: "trigger",
    },
  });
  const triggerMessage = logs.resolveHeadMessages(head.id)[0]!;

  const pending = logs.recordGenerationAttempt({
    projectId: "project_ai_attempts",
    headId: head.id,
    triggerMessageId: triggerMessage.id,
    request: { prompt: "go" },
  });
  expect(pending.status).toBe("pending");

  const assistant = logs.appendMessage({
    projectId: "project_ai_attempts",
    headId: head.id,
    prevMessageId: head.currentMessageId,
    role: "assistant",
    content: { text: "done" },
    summaryText: "done",
  });
  const success = logs.completeGenerationAttemptSuccess({
    attemptId: pending.id,
    assistantMessageId: assistant.id,
    usage: { totalTokens: 42 },
  });
  expect(success.status).toBe("success");
  expect(success.assistantMessageId).toBe(assistant.id);
  expect(success.usage).toEqual({ totalTokens: 42 });

  const failedPending = logs.recordGenerationAttempt({
    projectId: "project_ai_attempts",
    headId: head.id,
    triggerMessageId: assistant.id,
    request: { prompt: "retry" },
  });
  const failed = logs.completeGenerationAttemptError({
    attemptId: failedPending.id,
    error: { message: "rate limited" },
  });
  expect(failed.status).toBe("error");
  expect(failed.error).toEqual({ message: "rate limited" });
});

test("resolveActiveAssistantHead falls back to the latest unarchived head and persists assistant state", () => {
  seedProject("project_ai_active_fallback");

  const older = logs.createHead({
    projectId: "project_ai_active_fallback",
    name: "Older",
  });
  const newer = logs.createHead({
    projectId: "project_ai_active_fallback",
    name: "Newer",
  });

  db.update(schema.aiProjectHeads)
    .set({ updatedAt: newer.updatedAt + 5_000 })
    .where(eq(schema.aiProjectHeads.id, older.id))
    .run();

  const active = logs.resolveActiveAssistantHead("project_ai_active_fallback");
  const assistantState = logs.getProjectAssistantStateView("project_ai_active_fallback");

  expect(active?.id).toBe(older.id);
  expect(assistantState?.activeHeadId).toBe(older.id);
});

test("createAssistantSession activates the new head and renameHead trims whitespace", () => {
  seedProject("project_ai_assistant_session");

  const head = logs.createAssistantSession("project_ai_assistant_session");
  expect(head.name).toBe("新会话 1");
  expect(logs.resolveActiveAssistantHead("project_ai_assistant_session")?.id).toBe(head.id);

  const renamed = logs.renameHead(head.id, "  第一轮脑暴  ");
  expect(renamed.name).toBe("第一轮脑暴");
  expect(() => logs.renameHead(head.id, "   ")).toThrow("名称不能为空。");
});

test("archiving the active head switches to another unarchived head and restoring only auto-activates when none exists", () => {
  seedProject("project_ai_archive_active");

  const headA = logs.createAssistantSession("project_ai_archive_active");
  const headB = logs.createAssistantSession("project_ai_archive_active");
  logs.setActiveAssistantHead("project_ai_archive_active", headA.id);

  logs.archiveHead(headA.id, true);
  expect(logs.resolveActiveAssistantHead("project_ai_archive_active")?.id).toBe(headB.id);

  logs.archiveHead(headA.id, false);
  expect(logs.resolveActiveAssistantHead("project_ai_archive_active")?.id).toBe(headB.id);

  logs.archiveHead(headA.id, true);
  logs.archiveHead(headB.id, true);
  expect(logs.resolveActiveAssistantHead("project_ai_archive_active")).toBeNull();

  logs.archiveHead(headA.id, false);
  expect(logs.resolveActiveAssistantHead("project_ai_archive_active")?.id).toBe(headA.id);
});
