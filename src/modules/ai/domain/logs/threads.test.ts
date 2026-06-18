import { expect, test } from "bun:test";

import { setupMockDatabase } from "@/test/mock-db";
import { seedProjectRecord } from "@/test/project";

setupMockDatabase();

const threadLogs = await import("./threads");
const runLogs = await import("./runs");
const logs = { ...threadLogs, ...runLogs };

function seedProject(projectId: string) {
  seedProjectRecord(projectId);
}

test("createThread activates the new thread and appendUserNode extends the active path", () => {
  const projectId = "project_agent_thread";
  seedProject(projectId);
  const thread = logs.createThread({
    projectId,
  });
  const node = logs.appendUserNode({
    projectId,
    threadId: thread.id,
    parentNodeId: null,
    message: {
      role: "user",
      content: [{ type: "text", text: "Hello world" }],
    },
  });

  const activeThread = logs.resolveActiveThread(projectId);
  const threadView = logs.getThreadView(projectId, thread.id);

  expect(activeThread?.id).toBe(thread.id);
  expect(threadView.activePath.map((current) => current.id)).toEqual([node.id]);
  expect(logs.buildThreadModelMessages(projectId, thread.id)).toEqual([
    {
      role: "user",
      content: [{ type: "text", text: "Hello world" }],
    },
  ]);
});

test("retry candidates remain siblings and selectActiveTip switches the displayed branch", () => {
  const projectId = "project_candidates";
  seedProject(projectId);
  const thread = logs.createThread({
    projectId,
  });
  const userNode = logs.appendUserNode({
    projectId,
    threadId: thread.id,
    parentNodeId: null,
    message: {
      role: "user",
      content: [{ type: "text", text: "Need help" }],
    },
  });
  const runA = logs.createRun(projectId, {
    threadId: thread.id,
    triggerNodeId: userNode.id,
    baseTipNodeId: userNode.id,
    runMode: "retry",
    agentProfile: "project-assistant",
  });
  const stepA = logs.createRunStep(projectId, {
    runId: runA.id,
    stepIndex: 0,
    provider: "openai",
    modelId: "gpt-test",
  });
  const branchA = logs.materializeResponseMessages({
    projectId,
    threadId: thread.id,
    parentNodeId: userNode.id,
    runId: runA.id,
    stepId: stepA.id,
    messages: [
      {
        role: "assistant",
        content: [{ type: "text", text: "Candidate A" }],
      },
    ],
  });
  logs.selectActiveTip(projectId, thread.id, branchA.tipNodeId!);

  const runB = logs.createRun(projectId, {
    threadId: thread.id,
    triggerNodeId: userNode.id,
    baseTipNodeId: userNode.id,
    runMode: "retry",
    agentProfile: "project-assistant",
  });
  const stepB = logs.createRunStep(projectId, {
    runId: runB.id,
    stepIndex: 0,
    provider: "openai",
    modelId: "gpt-test",
  });
  const branchB = logs.materializeResponseMessages({
    projectId,
    threadId: thread.id,
    parentNodeId: userNode.id,
    runId: runB.id,
    stepId: stepB.id,
    messages: [
      {
        role: "assistant",
        content: [{ type: "text", text: "Candidate B" }],
      },
    ],
  });

  const candidates = logs.getNodeCandidates(projectId, userNode.id);
  expect(candidates).toHaveLength(2);
  expect(candidates.map((candidate) => candidate.tipNodeId)).toEqual([
    branchA.tipNodeId!,
    branchB.tipNodeId!,
  ]);

  logs.selectActiveTip(projectId, thread.id, branchB.tipNodeId!);
  expect(logs.getThreadView(projectId, thread.id).activePath.at(-1)?.summaryText).toBe(
    "Candidate B",
  );
});
