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
  seedProject("project_agent_thread");
  const thread = logs.createThread({
    projectId: "project_agent_thread",
  });
  const node = logs.appendUserNode({
    threadId: thread.id,
    parentNodeId: null,
    message: {
      role: "user",
      content: [{ type: "text", text: "Hello world" }],
    },
  });

  const activeThread = logs.resolveActiveThread("project_agent_thread");
  const threadView = logs.getThreadView(thread.id);

  expect(activeThread?.id).toBe(thread.id);
  expect(threadView.activePath.map((current) => current.id)).toEqual([node.id]);
  expect(logs.buildThreadModelMessages(thread.id)).toEqual([
    {
      role: "user",
      content: [{ type: "text", text: "Hello world" }],
    },
  ]);
});

test("retry candidates remain siblings and selectActiveTip switches the displayed branch", () => {
  seedProject("project_candidates");
  const thread = logs.createThread({
    projectId: "project_candidates",
  });
  const userNode = logs.appendUserNode({
    threadId: thread.id,
    parentNodeId: null,
    message: {
      role: "user",
      content: [{ type: "text", text: "Need help" }],
    },
  });
  const runA = logs.createRun({
    threadId: thread.id,
    triggerNodeId: userNode.id,
    baseTipNodeId: userNode.id,
    runMode: "retry",
    agentProfile: "project-assistant",
  });
  const stepA = logs.createRunStep({
    runId: runA.id,
    stepIndex: 0,
    provider: "openai",
    modelId: "gpt-test",
  });
  const branchA = logs.materializeResponseMessages({
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
  logs.selectActiveTip(thread.id, branchA.tipNodeId!);

  const runB = logs.createRun({
    threadId: thread.id,
    triggerNodeId: userNode.id,
    baseTipNodeId: userNode.id,
    runMode: "retry",
    agentProfile: "project-assistant",
  });
  const stepB = logs.createRunStep({
    runId: runB.id,
    stepIndex: 0,
    provider: "openai",
    modelId: "gpt-test",
  });
  const branchB = logs.materializeResponseMessages({
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

  const candidates = logs.getNodeCandidates(userNode.id);
  expect(candidates).toHaveLength(2);
  expect(candidates.map((candidate) => candidate.tipNodeId)).toEqual([
    branchA.tipNodeId!,
    branchB.tipNodeId!,
  ]);

  logs.selectActiveTip(thread.id, branchB.tipNodeId!);
  expect(logs.getThreadView(thread.id).activePath.at(-1)?.summaryText).toBe("Candidate B");
});
