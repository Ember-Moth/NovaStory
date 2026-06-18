import { expect, test } from "bun:test";

import { setupMockDatabase } from "@/test/mock-db";
import { seedProjectRecord } from "@/test/project";

setupMockDatabase();

const threadLogs = await import("@/modules/ai/domain/logs/threads");
const handlers = await import("./index");
const { rpcTags } = await import("@/rpc/tags");

const requestCtx = { req: new Request("http://localhost/api/rpc") } as unknown as Parameters<
  typeof handlers.getThreadView.handler
>[1];

function seedProject(projectId: string) {
  seedProjectRecord(projectId);
}

test("listProjectThreads watches the project thread tag", async () => {
  seedProject("rpc_threads");
  threadLogs.createThread({
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
  const thread = threadLogs.createThread({
    projectId: "rpc_thread_view",
  });

  const result = await handlers.getThreadView.handler(
    { projectId: "rpc_thread_view", threadId: thread.id },
    requestCtx,
  );
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
