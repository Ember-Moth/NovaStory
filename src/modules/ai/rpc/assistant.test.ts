import { afterEach, expect, test } from "bun:test";

import type { ProjectAssistantService } from "@/modules/ai/server/project-assistant";
import { rpcTags } from "@/rpc/tags";

const handlers = await import("./index");
const { getProjectAssistantService, setProjectAssistantServiceForTests } =
  await import("@/modules/ai/server/project-assistant");

const requestCtx = { req: new Request("http://localhost/api/rpc") } as unknown as Parameters<
  typeof handlers.getProjectAssistantState.handler
>[1];
const streamRequestCtx = { req: new Request("http://localhost/api/rpc") } as unknown as Parameters<
  typeof handlers.sendProjectAssistantMessageStream.handler
>[1];

const originalService = getProjectAssistantService();

afterEach(() => {
  setProjectAssistantServiceForTests(originalService);
});

function useService(service: ProjectAssistantService) {
  setProjectAssistantServiceForTests(service);
}

test("getProjectAssistantState watches overview, threads, and the active thread view", async () => {
  useService({
    getProjectAssistantState: () => ({
      activeThreadId: "thread_state",
      threads: [],
      state: {
        thread: {
          id: "thread_state",
          projectId: "rpc_assistant_state",
          agentProfile: "project-assistant",
          title: "主会话",
          activeTipNodeId: null,
          archivedAt: null,
          createdAt: 1,
          updatedAt: 1,
        },
        activePath: [],
        candidateGroups: [],
        latestRuns: [],
        runSummaries: [],
      },
    }),
    createProjectAssistantThread: () => {
      throw new Error("unused");
    },
    setProjectAssistantActiveThread: () => {
      throw new Error("unused");
    },
    renameProjectAssistantThread: () => {
      throw new Error("unused");
    },
    archiveProjectAssistantThread: () => {
      throw new Error("unused");
    },
    getThreadView: () => {
      throw new Error("unused");
    },
    getRunTrace: () => {
      throw new Error("unused");
    },
    getNodeCandidates: () => {
      throw new Error("unused");
    },
    getChildRuns: () => {
      throw new Error("unused");
    },
    selectThreadTip: () => {
      throw new Error("unused");
    },
    sendProjectAssistantMessage: async () => {
      throw new Error("unused");
    },
    retryProjectAssistantMessage: async () => {
      throw new Error("unused");
    },
    editProjectAssistantMessage: async () => {
      throw new Error("unused");
    },
  } as unknown as ProjectAssistantService);

  const result = await handlers.getProjectAssistantState.handler(
    { projectId: "rpc_assistant_state" },
    requestCtx,
  );

  expect(result.watch).toEqual([
    rpcTags.aiProjectAssistantOverview("rpc_assistant_state"),
    rpcTags.aiProjectThreads("rpc_assistant_state"),
    rpcTags.aiThreadView("thread_state"),
  ]);
});

test("sendProjectAssistantMessage invalidates overview, thread view, candidates, and run trace", async () => {
  let receivedActiveTools: unknown = null;
  useService({
    getProjectAssistantState: () => ({
      activeThreadId: null,
      threads: [],
      state: {
        thread: null,
        activePath: [],
        candidateGroups: [],
        latestRuns: [],
        runSummaries: [],
      },
    }),
    createProjectAssistantThread: () => {
      throw new Error("unused");
    },
    setProjectAssistantActiveThread: () => {
      throw new Error("unused");
    },
    renameProjectAssistantThread: () => {
      throw new Error("unused");
    },
    archiveProjectAssistantThread: () => {
      throw new Error("unused");
    },
    getThreadView: () => {
      throw new Error("unused");
    },
    getRunTrace: () => {
      throw new Error("unused");
    },
    getNodeCandidates: () => {
      throw new Error("unused");
    },
    getChildRuns: () => {
      throw new Error("unused");
    },
    selectThreadTip: () => {
      throw new Error("unused");
    },
    sendProjectAssistantMessage: async (input: unknown) => {
      receivedActiveTools = (input as { activeTools?: unknown }).activeTools ?? null;
      return {
        thread: {
          id: "thread_send",
          projectId: "rpc_assistant_send",
          agentProfile: "project-assistant",
          title: "主会话",
          activeTipNodeId: "node_assistant",
          archivedAt: null,
          createdAt: 1,
          updatedAt: 2,
        },
        userNode: {
          id: "node_user",
          threadId: "thread_send",
          parentNodeId: null,
          role: "user",
          createdByRunId: null,
          sourceStepId: null,
          sourceKind: "user_input",
          summaryText: "Hello",
          message: { role: "user", content: [{ type: "text", text: "Hello" }] },
          parts: [],
          createdAt: 1,
        },
        assistantNode: null,
        run: {
          id: "run_send",
          threadId: "thread_send",
          parentRunId: null,
          parentEventId: null,
          triggerNodeId: "node_user",
          baseTipNodeId: "node_user",
          runMode: "send",
          status: "succeeded",
          agentProfile: "project-assistant",
          selectionSnapshot: {},
          contextSnapshot: null,
          errorArtifactId: null,
          startedAt: 1,
          completedAt: 2,
          createdAt: 1,
          updatedAt: 2,
        },
        state: {
          thread: null,
          activePath: [],
          candidateGroups: [],
          latestRuns: [],
          runSummaries: [],
        },
      };
    },
    retryProjectAssistantMessage: async () => {
      throw new Error("unused");
    },
    editProjectAssistantMessage: async () => {
      throw new Error("unused");
    },
  } as unknown as ProjectAssistantService);

  const result = await handlers.sendProjectAssistantMessage.handler(
    {
      projectId: "rpc_assistant_send",
      threadId: "thread_send",
      text: "Hello",
      activeTools: ["read_aux_path", "write_aux_file"],
    },
    requestCtx,
  );

  expect(receivedActiveTools).toEqual(["read_aux_path", "write_aux_file"]);
  expect(result.invalidate).toEqual([
    rpcTags.aiProjectAssistantOverview("rpc_assistant_send"),
    rpcTags.aiProjectThreads("rpc_assistant_send"),
    rpcTags.aiThreadView("thread_send"),
    rpcTags.aiNodeCandidates("node_user"),
    rpcTags.aiRunTrace("run_send"),
    rpcTags.aiChildRuns("run_send"),
  ]);
});

test("sendProjectAssistantMessageStream emits events and returns invalidate tags on complete", async () => {
  let receivedActiveTools: unknown = null;
  const run = {
    id: "run_stream",
    threadId: "thread_stream",
    parentRunId: null,
    parentEventId: null,
    triggerNodeId: "node_user_stream",
    baseTipNodeId: "node_user_stream",
    runMode: "send" as const,
    status: "running" as const,
    agentProfile: "project-assistant",
    selectionSnapshot: {},
    contextSnapshot: null,
    errorArtifactId: null,
    startedAt: 1,
    completedAt: null,
    createdAt: 1,
    updatedAt: 1,
  };
  const finalResult = {
    thread: {
      id: "thread_stream",
      projectId: "rpc_assistant_stream",
      agentProfile: "project-assistant",
      title: "主会话",
      activeTipNodeId: "node_assistant_stream",
      archivedAt: null,
      createdAt: 1,
      updatedAt: 2,
    },
    userNode: {
      id: "node_user_stream",
      threadId: "thread_stream",
      parentNodeId: null,
      role: "user" as const,
      createdByRunId: null,
      sourceStepId: null,
      sourceKind: "user_input" as const,
      summaryText: "Hello",
      message: { role: "user" as const, content: [{ type: "text" as const, text: "Hello" }] },
      parts: [],
      createdAt: 1,
    },
    assistantNode: {
      id: "node_assistant_stream",
      threadId: "thread_stream",
      parentNodeId: "node_user_stream",
      role: "assistant" as const,
      createdByRunId: "run_stream",
      sourceStepId: null,
      sourceKind: "model_response" as const,
      summaryText: "Hello from stream",
      message: {
        role: "assistant" as const,
        content: [{ type: "text" as const, text: "Hello from stream" }],
      },
      parts: [],
      createdAt: 2,
    },
    run: {
      ...run,
      status: "succeeded" as const,
      completedAt: 2,
      updatedAt: 2,
    },
    state: {
      thread: null,
      activePath: [],
      candidateGroups: [],
      latestRuns: [],
      runSummaries: [],
    },
  };

  useService({
    getProjectAssistantState: () => ({
      activeThreadId: null,
      threads: [],
      state: {
        thread: null,
        activePath: [],
        candidateGroups: [],
        latestRuns: [],
        runSummaries: [],
      },
    }),
    createProjectAssistantThread: () => {
      throw new Error("unused");
    },
    setProjectAssistantActiveThread: () => {
      throw new Error("unused");
    },
    renameProjectAssistantThread: () => {
      throw new Error("unused");
    },
    archiveProjectAssistantThread: () => {
      throw new Error("unused");
    },
    getThreadView: () => {
      throw new Error("unused");
    },
    getRunTrace: () => {
      throw new Error("unused");
    },
    getNodeCandidates: () => {
      throw new Error("unused");
    },
    getChildRuns: () => {
      throw new Error("unused");
    },
    selectThreadTip: () => {
      throw new Error("unused");
    },
    sendProjectAssistantMessage: async () => {
      throw new Error("unused");
    },
    sendProjectAssistantMessageStream: (input: unknown) => {
      receivedActiveTools = (input as { activeTools?: unknown }).activeTools ?? null;
      return {
        initialResult: {
          ...finalResult,
          run,
          assistantNode: null,
        },
        finalResult: Promise.resolve(finalResult),
        subscribe: (listener: (_event: unknown) => void) => {
          listener({
            type: "run-started",
            run,
            threadId: "thread_stream",
            triggerNodeId: "node_user_stream",
            userNode: finalResult.userNode,
          });
          listener({
            type: "assistant-text-delta",
            nodeId: "node_assistant_stream",
            delta: "Hello from stream",
            accumulatedText: "Hello from stream",
          });
          return () => {
            return;
          };
        },
      };
    },
    retryProjectAssistantMessageStream: () => {
      throw new Error("unused");
    },
    editProjectAssistantMessageStream: () => {
      throw new Error("unused");
    },
    retryProjectAssistantMessage: async () => {
      throw new Error("unused");
    },
    editProjectAssistantMessage: async () => {
      throw new Error("unused");
    },
  } as unknown as ProjectAssistantService);

  const emitted: unknown[] = [];
  const execution = await handlers.sendProjectAssistantMessageStream.handler(
    {
      projectId: "rpc_assistant_stream",
      threadId: "thread_stream",
      text: "Hello",
      activeTools: ["read_aux_path"],
    },
    streamRequestCtx,
    {
      emit(event) {
        emitted.push(event);
      },
    },
  );

  expect(receivedActiveTools).toEqual(["read_aux_path"]);
  expect(emitted).toEqual([
    {
      type: "run-started",
      run,
      threadId: "thread_stream",
      triggerNodeId: "node_user_stream",
      userNode: finalResult.userNode,
    },
    {
      type: "assistant-text-delta",
      nodeId: "node_assistant_stream",
      delta: "Hello from stream",
      accumulatedText: "Hello from stream",
    },
  ]);
  expect(execution.invalidate).toEqual([
    rpcTags.aiProjectAssistantOverview("rpc_assistant_stream"),
    rpcTags.aiProjectThreads("rpc_assistant_stream"),
    rpcTags.aiThreadView("thread_stream"),
    rpcTags.aiNodeCandidates("node_user_stream"),
    rpcTags.aiRunTrace("run_stream"),
    rpcTags.aiChildRuns("run_stream"),
  ]);
});
