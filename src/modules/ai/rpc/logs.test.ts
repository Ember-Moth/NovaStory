import { expect, test } from "bun:test";

import { setupMockDatabase } from "@/test/mock-db";

setupMockDatabase();

const { db, schema } = await import("@/db");
const logs = await import("@/modules/ai/domain/logs");
const handlers = await import("./index");
const { rpcTags } = await import("@/rpc/tags");

const requestCtx = { req: new Request("http://localhost/api/rpc") } as unknown as Parameters<
  typeof handlers.getThreadView.handler
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

test("listProjectThreads watches the project thread tag", async () => {
  seedProject("rpc_threads");
  logs.createThread({
    projectId: "rpc_threads",
  });

  const result = await handlers.listProjectThreads.handler(
    { projectId: "rpc_threads" },
    requestCtx,
  );
  expect(result.watch).toEqual([rpcTags.aiProjectThreads("rpc_threads")]);
  expect(result.data).toHaveLength(1);
});

test("getThreadView watches the thread tag", async () => {
  seedProject("rpc_thread_view");
  const thread = logs.createThread({
    projectId: "rpc_thread_view",
  });

  const result = await handlers.getThreadView.handler({ threadId: thread.id }, requestCtx);
  expect(result.watch).toEqual([rpcTags.aiThreadView(thread.id)]);
});

test("createProjectAssistantThread invalidates overview and thread view", async () => {
  seedProject("rpc_create_thread");

  const result = await handlers.createProjectAssistantThread.handler(
    { projectId: "rpc_create_thread" },
    requestCtx,
  );

  expect(result.invalidate).toEqual([
    rpcTags.aiProjectAssistantOverview("rpc_create_thread"),
    rpcTags.aiProjectThreads("rpc_create_thread"),
    rpcTags.aiThreadView(result.data.id),
  ]);
});
