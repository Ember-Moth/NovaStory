import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeEach, expect, test } from "bun:test";

const tempDir = mkdtempSync(join(tmpdir(), "novel-evolver-ai-logs-rpc-"));
const dbPath = join(tempDir, "ai-logs-rpc.sqlite");
process.env.DATABASE_URL = dbPath;

const { db, schema } = await import("@/db");
const logs = await import("@/modules/ai/domain/logs");
const handlers = await import("./index");
const { rpcTags } = await import("@/rpc/tags");

const requestCtx = { req: new Request("http://localhost/api/rpc") } as unknown as Parameters<
  typeof handlers.getHeadMessages.handler
>[1];

function seedProject(projectId: string) {
  db.insert(schema.projects)
    .values({
      id: projectId,
      name: `Project ${projectId}`,
      description: null,
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

test("listProjectHeads watches the project head tag", async () => {
  seedProject("rpc_ai_heads");
  logs.createHead({
    projectId: "rpc_ai_heads",
    name: "Main",
  });

  const result = await handlers.listProjectHeads.handler({ projectId: "rpc_ai_heads" }, requestCtx);
  expect(result.watch).toEqual([rpcTags.aiProjectHeads("rpc_ai_heads")]);
  expect(result.data).toHaveLength(1);
});

test("appendMessage invalidates the head chain and parent children tags", async () => {
  seedProject("rpc_ai_append");
  const head = logs.createHead({
    projectId: "rpc_ai_append",
    initialMessage: {
      role: "user",
      content: { text: "hello" },
      summaryText: "hello",
    },
  });

  const result = await handlers.appendMessage.handler(
    {
      projectId: "rpc_ai_append",
      headId: head.id,
      prevMessageId: head.currentMessageId,
      role: "assistant",
      content: { text: "reply" },
      summaryText: "reply",
    },
    requestCtx,
  );

  expect(result.invalidate).toEqual([
    rpcTags.aiProjectAssistantState("rpc_ai_append"),
    rpcTags.aiProjectHeads("rpc_ai_append"),
    rpcTags.aiHeadMessages(head.id),
    rpcTags.aiMessageChildren("rpc_ai_append", head.currentMessageId!),
  ]);
});

test("forkHeadFromMessage invalidates the source message children and new head chain", async () => {
  seedProject("rpc_ai_fork");
  const head = logs.createHead({
    projectId: "rpc_ai_fork",
    initialMessage: {
      role: "system",
      content: { text: "root" },
      summaryText: "root",
    },
  });
  const root = logs.resolveHeadMessages(head.id)[0]!;
  const branchA = logs.appendMessage({
    projectId: "rpc_ai_fork",
    headId: head.id,
    prevMessageId: head.currentMessageId,
    role: "user",
    content: { text: "branch-a" },
    summaryText: "branch-a",
  });

  const result = await handlers.forkProjectHeadFromMessage.handler(
    {
      projectId: "rpc_ai_fork",
      sourceHeadId: head.id,
      sourceMessageId: branchA.id,
      replacementRole: "user",
      replacementContent: { text: "branch-b" },
      replacementSummaryText: "branch-b",
    },
    requestCtx,
  );

  expect(result.invalidate).toEqual([
    rpcTags.aiProjectAssistantState("rpc_ai_fork"),
    rpcTags.aiProjectHeads("rpc_ai_fork"),
    rpcTags.aiHeadMessages(result.data.id),
    rpcTags.aiMessageChildren("rpc_ai_fork", branchA.id),
  ]);
  expect(logs.resolveHeadMessages(result.data.id).map((message) => message.summaryText)).toEqual([
    "root",
    "branch-b",
  ]);
  expect(root.id).toBeTruthy();
});

test("finishing a generation attempt invalidates the project attempt tag", async () => {
  seedProject("rpc_ai_attempt");
  const head = logs.createHead({
    projectId: "rpc_ai_attempt",
    initialMessage: {
      role: "user",
      content: { text: "trigger" },
      summaryText: "trigger",
    },
  });
  const trigger = logs.resolveHeadMessages(head.id)[0]!;
  const attempt = logs.recordGenerationAttempt({
    projectId: "rpc_ai_attempt",
    headId: head.id,
    triggerMessageId: trigger.id,
    request: { prompt: "go" },
  });

  const result = await handlers.finishGenerationAttemptError.handler(
    {
      attemptId: attempt.id,
      error: { message: "boom" },
    },
    requestCtx,
  );

  expect(result.invalidate).toEqual([rpcTags.aiGenerationAttempts("rpc_ai_attempt")]);
  expect(result.data.status).toBe("error");
});

test("createProjectAssistantSession invalidates assistant state, heads, and the new head messages", async () => {
  seedProject("rpc_ai_create_session");

  const result = await handlers.createProjectAssistantSession.handler(
    { projectId: "rpc_ai_create_session" },
    requestCtx,
  );

  expect(result.invalidate).toEqual([
    rpcTags.aiProjectAssistantState("rpc_ai_create_session"),
    rpcTags.aiProjectHeads("rpc_ai_create_session"),
    rpcTags.aiHeadMessages(result.data.id),
  ]);
});

test("renameProjectHead invalidates assistant state, heads, and head messages", async () => {
  seedProject("rpc_ai_rename_head");
  const head = logs.createAssistantSession("rpc_ai_rename_head");

  const result = await handlers.renameProjectHead.handler(
    { headId: head.id, name: "  Renamed Session  " },
    requestCtx,
  );

  expect(result.data.name).toBe("Renamed Session");
  expect(result.invalidate).toEqual([
    rpcTags.aiProjectAssistantState("rpc_ai_rename_head"),
    rpcTags.aiProjectHeads("rpc_ai_rename_head"),
    rpcTags.aiHeadMessages(head.id),
  ]);
});
