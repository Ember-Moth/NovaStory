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
  let receivedMentions: unknown = null;
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
    getRunTrace: () => ({
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
      steps: [],
      events: [],
      artifacts: [],
      childRuns: [],
    }),
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
      receivedMentions = (input as { mentions?: unknown }).mentions ?? null;
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
      mentions: [
        {
          kind: "global-prompt",
          mode: "snapshot-ref",
          targetId: "prompt_rpc",
          label: "RPC Prompt",
        },
      ],
      activeTools: ["read_file", "write_file"],
    },
    requestCtx,
  );

  expect(receivedActiveTools).toEqual(["read_file", "write_file"]);
  expect(receivedMentions).toEqual([
    {
      kind: "global-prompt",
      mode: "snapshot-ref",
      targetId: "prompt_rpc",
      label: "RPC Prompt",
    },
  ]);
  expect(result.invalidate).toEqual([
    rpcTags.aiProjectAssistantOverview("rpc_assistant_send"),
    rpcTags.aiProjectThreads("rpc_assistant_send"),
    rpcTags.aiThreadView("thread_send"),
    rpcTags.aiNodeCandidates("node_user"),
    rpcTags.aiRunTrace("run_send"),
    rpcTags.aiChildRuns("run_send"),
  ]);
});

test("sendProjectAssistantMessage additionally invalidates aux workspace when the run includes a successful write tool", async () => {
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
    getRunTrace: () => ({
      run: {
        id: "run_send_aux",
        threadId: "thread_send_aux",
        parentRunId: null,
        parentEventId: null,
        triggerNodeId: "node_user_aux",
        baseTipNodeId: "node_user_aux",
        runMode: "send" as const,
        status: "succeeded" as const,
        agentProfile: "project-assistant",
        selectionSnapshot: {},
        contextSnapshot: {
          workspaceId: "workspace_aux",
          activeContentNodeId: null,
          activeContentTitle: null,
          activeAuxPath: null,
          activeTimelinePointId: "origin",
          activeTimelineLabel: "原点",
        },
        errorArtifactId: null,
        startedAt: 1,
        completedAt: 2,
        createdAt: 1,
        updatedAt: 2,
      },
      steps: [],
      events: [],
      artifacts: [
        {
          id: "artifact_tool_output",
          runId: "run_send_aux",
          stepId: "step_1",
          artifactKind: "tool-output" as const,
          visibility: "internal" as const,
          mimeType: null,
          content: {
            toolName: "write_file",
            output: {
              ok: true,
              data: {
                action: "created",
                path: "/设定/角色.md",
              },
            },
          },
          summaryText: null,
          createdAt: 1,
        },
      ],
      childRuns: [],
    }),
    getNodeCandidates: () => {
      throw new Error("unused");
    },
    getChildRuns: () => {
      throw new Error("unused");
    },
    selectThreadTip: () => {
      throw new Error("unused");
    },
    sendProjectAssistantMessage: async () => ({
      thread: {
        id: "thread_send_aux",
        projectId: "rpc_assistant_send_aux",
        agentProfile: "project-assistant",
        title: "主会话",
        activeTipNodeId: "node_assistant_aux",
        archivedAt: null,
        createdAt: 1,
        updatedAt: 2,
      },
      userNode: {
        id: "node_user_aux",
        threadId: "thread_send_aux",
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
      assistantNode: null,
      run: {
        id: "run_send_aux",
        threadId: "thread_send_aux",
        parentRunId: null,
        parentEventId: null,
        triggerNodeId: "node_user_aux",
        baseTipNodeId: "node_user_aux",
        runMode: "send" as const,
        status: "succeeded" as const,
        agentProfile: "project-assistant",
        selectionSnapshot: {},
        contextSnapshot: {
          workspaceId: "workspace_aux",
          activeContentNodeId: null,
          activeContentTitle: null,
          activeAuxPath: null,
          activeTimelinePointId: "origin",
          activeTimelineLabel: "原点",
        },
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
    }),
    retryProjectAssistantMessage: async () => {
      throw new Error("unused");
    },
    editProjectAssistantMessage: async () => {
      throw new Error("unused");
    },
  } as unknown as ProjectAssistantService);

  const result = await handlers.sendProjectAssistantMessage.handler(
    {
      projectId: "rpc_assistant_send_aux",
      threadId: "thread_send_aux",
      text: "Hello",
    },
    requestCtx,
  );

  expect(result.invalidate).toEqual([
    rpcTags.aiProjectAssistantOverview("rpc_assistant_send_aux"),
    rpcTags.aiProjectThreads("rpc_assistant_send_aux"),
    rpcTags.aiThreadView("thread_send_aux"),
    rpcTags.aiNodeCandidates("node_user_aux"),
    rpcTags.aiRunTrace("run_send_aux"),
    rpcTags.aiChildRuns("run_send_aux"),
    rpcTags.auxWorkspace("workspace_aux"),
  ]);
});

test("sendProjectAssistantMessage additionally invalidates aux workspace for move_path", async () => {
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
    getRunTrace: () => ({
      run: {
        id: "run_send_move",
        threadId: "thread_send_move",
        parentRunId: null,
        parentEventId: null,
        triggerNodeId: "node_user_move",
        baseTipNodeId: "node_user_move",
        runMode: "send" as const,
        status: "succeeded" as const,
        agentProfile: "project-assistant",
        selectionSnapshot: {},
        contextSnapshot: {
          workspaceId: "workspace_move",
          activeContentNodeId: null,
          activeContentTitle: null,
          activeAuxPath: null,
          activeTimelinePointId: "origin",
          activeTimelineLabel: "原点",
        },
        errorArtifactId: null,
        startedAt: 1,
        completedAt: 2,
        createdAt: 1,
        updatedAt: 2,
      },
      steps: [],
      events: [],
      artifacts: [
        {
          id: "artifact_tool_output_move",
          runId: "run_send_move",
          stepId: "step_1",
          artifactKind: "tool-output" as const,
          visibility: "internal" as const,
          mimeType: null,
          content: {
            toolName: "move_path",
            output: {
              ok: true,
              data: {
                action: "moved",
                path: "/资料库/主角.md",
                previousPath: "/设定/角色.md",
              },
            },
          },
          summaryText: null,
          createdAt: 1,
        },
      ],
      childRuns: [],
    }),
    getNodeCandidates: () => {
      throw new Error("unused");
    },
    getChildRuns: () => {
      throw new Error("unused");
    },
    selectThreadTip: () => {
      throw new Error("unused");
    },
    sendProjectAssistantMessage: async () => ({
      thread: {
        id: "thread_send_move",
        projectId: "rpc_assistant_send_move",
        agentProfile: "project-assistant",
        title: "主会话",
        activeTipNodeId: "node_assistant_move",
        archivedAt: null,
        createdAt: 1,
        updatedAt: 2,
      },
      userNode: {
        id: "node_user_move",
        threadId: "thread_send_move",
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
      assistantNode: null,
      run: {
        id: "run_send_move",
        threadId: "thread_send_move",
        parentRunId: null,
        parentEventId: null,
        triggerNodeId: "node_user_move",
        baseTipNodeId: "node_user_move",
        runMode: "send" as const,
        status: "succeeded" as const,
        agentProfile: "project-assistant",
        selectionSnapshot: {},
        contextSnapshot: {
          workspaceId: "workspace_move",
          activeContentNodeId: null,
          activeContentTitle: null,
          activeAuxPath: null,
          activeTimelinePointId: "origin",
          activeTimelineLabel: "原点",
        },
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
    }),
    retryProjectAssistantMessage: async () => {
      throw new Error("unused");
    },
    editProjectAssistantMessage: async () => {
      throw new Error("unused");
    },
  } as unknown as ProjectAssistantService);

  const result = await handlers.sendProjectAssistantMessage.handler(
    {
      projectId: "rpc_assistant_send_move",
      threadId: "thread_send_move",
      text: "Hello",
    },
    requestCtx,
  );

  expect(result.invalidate).toContainEqual(rpcTags.auxWorkspace("workspace_move"));
});

test("sendProjectAssistantMessage does not invalidate aux workspace for failed move_path output", async () => {
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
    getRunTrace: () => ({
      run: {
        id: "run_send_failed_move",
        threadId: "thread_send_failed_move",
        parentRunId: null,
        parentEventId: null,
        triggerNodeId: "node_user_failed_move",
        baseTipNodeId: "node_user_failed_move",
        runMode: "send" as const,
        status: "succeeded" as const,
        agentProfile: "project-assistant",
        selectionSnapshot: {},
        contextSnapshot: {
          workspaceId: "workspace_failed_move",
          activeContentNodeId: null,
          activeContentTitle: null,
          activeAuxPath: null,
          activeTimelinePointId: "origin",
          activeTimelineLabel: "原点",
        },
        errorArtifactId: null,
        startedAt: 1,
        completedAt: 2,
        createdAt: 1,
        updatedAt: 2,
      },
      steps: [],
      events: [],
      artifacts: [
        {
          id: "artifact_tool_output_failed_move",
          runId: "run_send_failed_move",
          stepId: "step_1",
          artifactKind: "tool-output" as const,
          visibility: "internal" as const,
          mimeType: null,
          content: {
            toolName: "move_path",
            output: {
              ok: false,
              error: "移动失败",
            },
          },
          summaryText: null,
          createdAt: 1,
        },
      ],
      childRuns: [],
    }),
    getNodeCandidates: () => {
      throw new Error("unused");
    },
    getChildRuns: () => {
      throw new Error("unused");
    },
    selectThreadTip: () => {
      throw new Error("unused");
    },
    sendProjectAssistantMessage: async () => ({
      thread: {
        id: "thread_send_failed_move",
        projectId: "rpc_assistant_send_failed_move",
        agentProfile: "project-assistant",
        title: "主会话",
        activeTipNodeId: "node_assistant_failed_move",
        archivedAt: null,
        createdAt: 1,
        updatedAt: 2,
      },
      userNode: {
        id: "node_user_failed_move",
        threadId: "thread_send_failed_move",
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
      assistantNode: null,
      run: {
        id: "run_send_failed_move",
        threadId: "thread_send_failed_move",
        parentRunId: null,
        parentEventId: null,
        triggerNodeId: "node_user_failed_move",
        baseTipNodeId: "node_user_failed_move",
        runMode: "send" as const,
        status: "succeeded" as const,
        agentProfile: "project-assistant",
        selectionSnapshot: {},
        contextSnapshot: {
          workspaceId: "workspace_failed_move",
          activeContentNodeId: null,
          activeContentTitle: null,
          activeAuxPath: null,
          activeTimelinePointId: "origin",
          activeTimelineLabel: "原点",
        },
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
    }),
    retryProjectAssistantMessage: async () => {
      throw new Error("unused");
    },
    editProjectAssistantMessage: async () => {
      throw new Error("unused");
    },
  } as unknown as ProjectAssistantService);

  const result = await handlers.sendProjectAssistantMessage.handler(
    {
      projectId: "rpc_assistant_send_failed_move",
      threadId: "thread_send_failed_move",
      text: "Hello",
    },
    requestCtx,
  );

  expect(result.invalidate).not.toContain(rpcTags.auxWorkspace("workspace_failed_move"));
});

test("sendProjectAssistantMessageStream emits events and returns invalidate tags on complete", async () => {
  let receivedActiveTools: unknown = null;
  let receivedMentions: unknown = null;
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
    contextSnapshot: { workspaceId: "workspace_stream" },
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
    getRunTrace: () => ({
      run: finalResult.run,
      steps: [],
      artifacts: [
        {
          id: "artifact_stream_aux_write",
          runId: "run_stream",
          stepId: null,
          artifactKind: "tool-output" as const,
          content: {
            toolName: "write_file",
            output: {
              ok: true,
              data: {
                action: "updated",
                timelinePointId: "point_stream",
              },
            },
          },
          createdAt: 2,
        },
      ],
      events: [],
      childRuns: [],
    }),
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
      receivedMentions = (input as { mentions?: unknown }).mentions ?? null;
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
      mentions: [
        {
          kind: "global-prompt",
          mode: "snapshot-ref",
          targetId: "prompt_stream",
          label: "Stream Prompt",
        },
      ],
      activeTools: ["read_file"],
    },
    streamRequestCtx,
    {
      emit(event) {
        emitted.push(event);
      },
    },
  );

  expect(receivedActiveTools).toEqual(["read_file"]);
  expect(receivedMentions).toEqual([
    {
      kind: "global-prompt",
      mode: "snapshot-ref",
      targetId: "prompt_stream",
      label: "Stream Prompt",
    },
  ]);
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
    rpcTags.auxWorkspace("workspace_stream"),
  ]);
});

test("continueProjectAssistantRunStream emits events and invalidates parent and child runs", async () => {
  const parentRun = {
    id: "run_parent_continue",
    threadId: "thread_continue_stream",
    parentRunId: null,
    parentEventId: null,
    triggerNodeId: "node_assistant_parent",
    baseTipNodeId: "node_assistant_parent",
    runMode: "send" as const,
    status: "succeeded" as const,
    agentProfile: "project-assistant",
    selectionSnapshot: {},
    contextSnapshot: null,
    activeTools: ["read_file"],
    errorArtifactId: null,
    startedAt: 1,
    completedAt: 2,
    createdAt: 1,
    updatedAt: 2,
  };
  const run = {
    id: "run_continue_stream",
    threadId: "thread_continue_stream",
    parentRunId: parentRun.id,
    parentEventId: null,
    triggerNodeId: "node_assistant_parent",
    baseTipNodeId: "node_assistant_parent",
    runMode: "continue" as const,
    status: "running" as const,
    agentProfile: "project-assistant",
    selectionSnapshot: {},
    contextSnapshot: null,
    activeTools: ["read_file"],
    errorArtifactId: null,
    startedAt: 3,
    completedAt: null,
    createdAt: 3,
    updatedAt: 3,
  };
  const finalResult = {
    thread: {
      id: "thread_continue_stream",
      projectId: "rpc_assistant_continue_stream",
      agentProfile: "project-assistant",
      title: "主会话",
      activeTipNodeId: "node_assistant_continue",
      archivedAt: null,
      createdAt: 1,
      updatedAt: 4,
    },
    assistantNode: {
      id: "node_assistant_continue",
      threadId: "thread_continue_stream",
      parentNodeId: "node_assistant_parent",
      role: "assistant" as const,
      createdByRunId: "run_continue_stream",
      sourceStepId: null,
      sourceKind: "model_response" as const,
      summaryText: "continued",
      message: {
        role: "assistant" as const,
        content: [{ type: "text" as const, text: "continued" }],
      },
      parts: [],
      createdAt: 4,
    },
    run: {
      ...run,
      status: "succeeded" as const,
      completedAt: 4,
      updatedAt: 4,
    },
    parentRun,
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
    getRunTrace: () => ({
      run: finalResult.run,
      steps: [],
      artifacts: [],
      events: [],
      childRuns: [],
    }),
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
    sendProjectAssistantMessageStream: () => {
      throw new Error("unused");
    },
    retryProjectAssistantMessage: async () => {
      throw new Error("unused");
    },
    retryProjectAssistantMessageStream: () => {
      throw new Error("unused");
    },
    editProjectAssistantMessage: async () => {
      throw new Error("unused");
    },
    editProjectAssistantMessageStream: () => {
      throw new Error("unused");
    },
    continueProjectAssistantRun: async () => {
      throw new Error("unused");
    },
    continueProjectAssistantRunStream: () => ({
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
          threadId: "thread_continue_stream",
          triggerNodeId: "node_assistant_parent",
        });
        listener({
          type: "assistant-text-delta",
          nodeId: "node_assistant_continue",
          delta: "continued",
          accumulatedText: "continued",
        });
        return () => {
          return;
        };
      },
    }),
  } as unknown as ProjectAssistantService);

  const emitted: unknown[] = [];
  const execution = await handlers.continueProjectAssistantRunStream.handler(
    {
      projectId: "rpc_assistant_continue_stream",
      threadId: "thread_continue_stream",
      runId: parentRun.id,
    },
    streamRequestCtx,
    {
      emit(event) {
        emitted.push(event);
      },
    },
  );

  expect(execution.result.run.runMode).toBe("continue");
  expect(execution.result.run.parentRunId).toBe(parentRun.id);
  expect(emitted).toEqual([
    {
      type: "run-started",
      run,
      threadId: "thread_continue_stream",
      triggerNodeId: "node_assistant_parent",
    },
    {
      type: "assistant-text-delta",
      nodeId: "node_assistant_continue",
      delta: "continued",
      accumulatedText: "continued",
    },
  ]);
  expect(execution.invalidate).toEqual(
    expect.arrayContaining([
      rpcTags.aiThreadView("thread_continue_stream"),
      rpcTags.aiRunTrace("run_continue_stream"),
      rpcTags.aiRunTrace(parentRun.id),
      rpcTags.aiChildRuns(parentRun.id),
    ]),
  );
});

test("submitProjectAssistantToolInput invalidates thread and waiting run trace", async () => {
  let receivedAnswers: unknown = null;
  const run = {
    id: "run_submit_tool_input",
    threadId: "thread_submit_tool_input",
    parentRunId: null,
    parentEventId: null,
    triggerNodeId: "node_user_submit_tool_input",
    baseTipNodeId: "node_user_submit_tool_input",
    runMode: "send" as const,
    status: "succeeded" as const,
    agentProfile: "project-assistant",
    selectionSnapshot: {},
    contextSnapshot: null,
    activeTools: ["ask_user"],
    errorArtifactId: null,
    startedAt: 1,
    completedAt: 2,
    createdAt: 1,
    updatedAt: 2,
  };
  const result = {
    thread: {
      id: "thread_submit_tool_input",
      projectId: "rpc_submit_tool_input",
      agentProfile: "project-assistant",
      title: "主会话",
      activeTipNodeId: "node_assistant_submit_tool_input",
      archivedAt: null,
      createdAt: 1,
      updatedAt: 2,
    },
    toolNode: {
      id: "node_tool_submit_tool_input",
      threadId: "thread_submit_tool_input",
      parentNodeId: "node_assistant_waiting",
      role: "tool" as const,
      createdByRunId: run.id,
      sourceStepId: null,
      sourceKind: "tool_result" as const,
      summaryText: "用户已回答提问",
      message: { role: "tool" as const, content: [] },
      parts: [],
      createdAt: 2,
    },
    assistantNode: null,
    run,
    state: {
      thread: null,
      activePath: [],
      candidateGroups: [],
      latestRuns: [],
      runSummaries: [],
    },
  };

  useService({
    getProjectAssistantState: () => {
      throw new Error("unused");
    },
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
    getRunTrace: () => ({
      run,
      steps: [],
      events: [],
      artifacts: [],
      childRuns: [],
    }),
    getNodeCandidates: () => {
      throw new Error("unused");
    },
    getChildRuns: () => {
      throw new Error("unused");
    },
    selectThreadTip: () => {
      throw new Error("unused");
    },
    submitProjectAssistantToolInput: async (input: unknown) => {
      receivedAnswers = (input as { answers?: unknown }).answers;
      return result;
    },
  } as unknown as ProjectAssistantService);

  const response = await handlers.submitProjectAssistantToolInput.handler(
    {
      projectId: "rpc_submit_tool_input",
      threadId: "thread_submit_tool_input",
      runId: run.id,
      toolCallId: "tool_ask",
      answers: [{ questionId: "tone", type: "single_choice", optionId: "quiet" }],
    },
    requestCtx,
  );

  expect(receivedAnswers).toEqual([
    { questionId: "tone", type: "single_choice", optionId: "quiet" },
  ]);
  expect(response.invalidate).toEqual([
    rpcTags.aiProjectAssistantOverview("rpc_submit_tool_input"),
    rpcTags.aiProjectThreads("rpc_submit_tool_input"),
    rpcTags.aiThreadView("thread_submit_tool_input"),
    rpcTags.aiNodeCandidates("node_assistant_waiting"),
    rpcTags.aiRunTrace(run.id),
    rpcTags.aiChildRuns(run.id),
  ]);
});

test("submitProjectAssistantToolInput accepts custom single_choice text answers", async () => {
  let receivedAnswers: unknown = null;
  const run = {
    id: "run_submit_tool_input_custom",
    threadId: "thread_submit_tool_input_custom",
    parentRunId: null,
    parentEventId: null,
    triggerNodeId: "node_user_submit_tool_input_custom",
    baseTipNodeId: "node_user_submit_tool_input_custom",
    runMode: "send" as const,
    status: "succeeded" as const,
    agentProfile: "project-assistant",
    selectionSnapshot: {},
    contextSnapshot: null,
    activeTools: ["ask_user"],
    errorArtifactId: null,
    startedAt: 1,
    completedAt: 2,
    createdAt: 1,
    updatedAt: 2,
  };
  const result = {
    thread: {
      id: "thread_submit_tool_input_custom",
      projectId: "rpc_submit_tool_input_custom",
      agentProfile: "project-assistant",
      title: "主会话",
      activeTipNodeId: "node_assistant_submit_tool_input_custom",
      archivedAt: null,
      createdAt: 1,
      updatedAt: 2,
    },
    toolNode: {
      id: "node_tool_submit_tool_input_custom",
      threadId: "thread_submit_tool_input_custom",
      parentNodeId: "node_assistant_waiting_custom",
      role: "tool" as const,
      createdByRunId: run.id,
      sourceStepId: null,
      sourceKind: "tool_result" as const,
      summaryText: "用户已回答提问",
      message: { role: "tool" as const, content: [] },
      parts: [],
      createdAt: 2,
    },
    assistantNode: null,
    run,
    state: {
      thread: null,
      activePath: [],
      candidateGroups: [],
      latestRuns: [],
      runSummaries: [],
    },
  };

  useService({
    getProjectAssistantState: () => {
      throw new Error("unused");
    },
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
    getRunTrace: () => ({
      run,
      steps: [],
      events: [],
      artifacts: [],
      childRuns: [],
    }),
    getNodeCandidates: () => {
      throw new Error("unused");
    },
    getChildRuns: () => {
      throw new Error("unused");
    },
    selectThreadTip: () => {
      throw new Error("unused");
    },
    submitProjectAssistantToolInput: async (input: unknown) => {
      receivedAnswers = (input as { answers?: unknown }).answers;
      return result;
    },
  } as unknown as ProjectAssistantService);

  await handlers.submitProjectAssistantToolInput.handler(
    {
      projectId: "rpc_submit_tool_input_custom",
      threadId: "thread_submit_tool_input_custom",
      runId: run.id,
      toolCallId: "tool_ask_custom",
      answers: [{ questionId: "tone", type: "single_choice", text: "更梦幻一点" }],
    },
    requestCtx,
  );

  expect(receivedAnswers).toEqual([
    { questionId: "tone", type: "single_choice", text: "更梦幻一点" },
  ]);
});

test("submitProjectAssistantToolInputStream emits resume deltas before completion", async () => {
  let receivedToolCallId: unknown = null;
  const run = {
    id: "run_submit_tool_input_stream",
    threadId: "thread_submit_tool_input_stream",
    parentRunId: null,
    parentEventId: null,
    triggerNodeId: "node_user_submit_tool_input_stream",
    baseTipNodeId: "node_user_submit_tool_input_stream",
    runMode: "send" as const,
    status: "running" as const,
    agentProfile: "project-assistant",
    selectionSnapshot: {},
    contextSnapshot: null,
    activeTools: ["ask_user"],
    errorArtifactId: null,
    startedAt: 1,
    completedAt: null,
    createdAt: 1,
    updatedAt: 1,
  };
  const finalResult = {
    thread: {
      id: "thread_submit_tool_input_stream",
      projectId: "rpc_submit_tool_input_stream",
      agentProfile: "project-assistant",
      title: "主会话",
      activeTipNodeId: "node_assistant_submit_tool_input_stream",
      archivedAt: null,
      createdAt: 1,
      updatedAt: 2,
    },
    toolNode: {
      id: "node_tool_submit_tool_input_stream",
      threadId: "thread_submit_tool_input_stream",
      parentNodeId: "node_assistant_waiting_stream",
      role: "tool" as const,
      createdByRunId: run.id,
      sourceStepId: null,
      sourceKind: "tool_result" as const,
      summaryText: "用户已回答提问",
      message: { role: "tool" as const, content: [] },
      parts: [],
      createdAt: 2,
    },
    assistantNode: {
      id: "node_assistant_submit_tool_input_stream",
      threadId: "thread_submit_tool_input_stream",
      parentNodeId: "node_tool_submit_tool_input_stream",
      role: "assistant" as const,
      createdByRunId: run.id,
      sourceStepId: null,
      sourceKind: "model_response" as const,
      summaryText: "继续写。",
      message: {
        role: "assistant" as const,
        content: [{ type: "text" as const, text: "继续写。" }],
      },
      parts: [],
      createdAt: 3,
    },
    run: {
      ...run,
      status: "succeeded" as const,
      completedAt: 3,
      updatedAt: 3,
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
    getProjectAssistantState: () => {
      throw new Error("unused");
    },
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
    getRunTrace: () => ({
      run: finalResult.run,
      steps: [],
      events: [],
      artifacts: [],
      childRuns: [],
    }),
    getNodeCandidates: () => {
      throw new Error("unused");
    },
    getChildRuns: () => {
      throw new Error("unused");
    },
    selectThreadTip: () => {
      throw new Error("unused");
    },
    submitProjectAssistantToolInputStream: (input: unknown) => {
      receivedToolCallId = (input as { toolCallId?: unknown }).toolCallId;
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
            threadId: "thread_submit_tool_input_stream",
            triggerNodeId: "node_user_submit_tool_input_stream",
          });
          listener({
            type: "assistant-message-started",
            nodeId: "node_assistant_submit_tool_input_stream",
            parentNodeId: "node_tool_submit_tool_input_stream",
            stepIndex: 1,
          });
          listener({
            type: "assistant-text-delta",
            nodeId: "node_assistant_submit_tool_input_stream",
            delta: "继续写。",
            accumulatedText: "继续写。",
          });
          return () => {
            return;
          };
        },
      };
    },
  } as unknown as ProjectAssistantService);

  const emitted: unknown[] = [];
  const execution = await handlers.submitProjectAssistantToolInputStream.handler(
    {
      projectId: "rpc_submit_tool_input_stream",
      threadId: "thread_submit_tool_input_stream",
      runId: run.id,
      toolCallId: "tool_ask_stream",
      answers: [{ questionId: "tone", type: "single_choice", optionId: "quiet" }],
    },
    streamRequestCtx,
    {
      emit(event) {
        emitted.push(event);
      },
    },
  );

  expect(receivedToolCallId).toBe("tool_ask_stream");
  expect(emitted).toEqual([
    {
      type: "run-started",
      run,
      threadId: "thread_submit_tool_input_stream",
      triggerNodeId: "node_user_submit_tool_input_stream",
    },
    {
      type: "assistant-message-started",
      nodeId: "node_assistant_submit_tool_input_stream",
      parentNodeId: "node_tool_submit_tool_input_stream",
      stepIndex: 1,
    },
    {
      type: "assistant-text-delta",
      nodeId: "node_assistant_submit_tool_input_stream",
      delta: "继续写。",
      accumulatedText: "继续写。",
    },
  ]);
  expect(execution.invalidate).toEqual([
    rpcTags.aiProjectAssistantOverview("rpc_submit_tool_input_stream"),
    rpcTags.aiProjectThreads("rpc_submit_tool_input_stream"),
    rpcTags.aiThreadView("thread_submit_tool_input_stream"),
    rpcTags.aiNodeCandidates("node_assistant_waiting_stream"),
    rpcTags.aiRunTrace(run.id),
    rpcTags.aiChildRuns(run.id),
  ]);
});

test("cancelProjectAssistantRun invalidates thread and run state", async () => {
  let received: unknown = null;
  useService({
    getProjectAssistantState: () => {
      throw new Error("unused");
    },
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
    sendProjectAssistantMessageStream: () => {
      throw new Error("unused");
    },
    retryProjectAssistantMessage: async () => {
      throw new Error("unused");
    },
    retryProjectAssistantMessageStream: () => {
      throw new Error("unused");
    },
    editProjectAssistantMessage: async () => {
      throw new Error("unused");
    },
    editProjectAssistantMessageStream: () => {
      throw new Error("unused");
    },
    continueProjectAssistantRun: async () => {
      throw new Error("unused");
    },
    continueProjectAssistantRunStream: () => {
      throw new Error("unused");
    },
    cancelProjectAssistantRun: (input: unknown) => {
      received = input;
      return { runId: "run_cancel_rpc" };
    },
  } as unknown as ProjectAssistantService);

  const result = await handlers.cancelProjectAssistantRun.handler(
    {
      projectId: "rpc_assistant_cancel",
      threadId: "thread_cancel_rpc",
      runId: "run_cancel_rpc",
    },
    requestCtx,
  );

  expect(received).toEqual({
    projectId: "rpc_assistant_cancel",
    threadId: "thread_cancel_rpc",
    runId: "run_cancel_rpc",
  });
  expect(result.invalidate).toEqual([
    rpcTags.aiProjectAssistantOverview("rpc_assistant_cancel"),
    rpcTags.aiProjectThreads("rpc_assistant_cancel"),
    rpcTags.aiThreadView("thread_cancel_rpc"),
    rpcTags.aiRunTrace("run_cancel_rpc"),
    rpcTags.aiChildRuns("run_cancel_rpc"),
  ]);
});
