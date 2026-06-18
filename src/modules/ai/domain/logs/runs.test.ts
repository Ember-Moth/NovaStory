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

test("thread view builds run summaries for completed multi-step assistant runs", () => {
  const projectId = "project_run_summary_success";
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
      content: [{ type: "text", text: "继续" }],
    },
  });
  const run = logs.createRun(projectId, {
    threadId: thread.id,
    triggerNodeId: userNode.id,
    baseTipNodeId: userNode.id,
    runMode: "send",
    agentProfile: "project-assistant",
  });
  const stepA = logs.createRunStep(projectId, {
    runId: run.id,
    stepIndex: 0,
    provider: "openai",
    modelId: "gpt-test",
    usage: { totalTokens: 10 },
  });
  const branchA = logs.materializeResponseMessages({
    projectId,
    threadId: thread.id,
    parentNodeId: userNode.id,
    runId: run.id,
    stepId: stepA.id,
    messages: [{ role: "assistant", content: [{ type: "text", text: "先读取上下文。" }] }],
  });
  const stepB = logs.createRunStep(projectId, {
    runId: run.id,
    stepIndex: 1,
    provider: "openai",
    modelId: "gpt-test",
    usage: { inputTokens: 3, outputTokens: 8 },
  });
  const branchB = logs.materializeResponseMessages({
    projectId,
    threadId: thread.id,
    parentNodeId: branchA.tipNodeId!,
    runId: run.id,
    stepId: stepB.id,
    messages: [{ role: "assistant", content: [{ type: "text", text: "这是最终答复。" }] }],
  });
  logs.selectActiveTip(projectId, thread.id, branchB.tipNodeId!);
  logs.markRunSucceeded(projectId, run.id);

  const summary = logs.getThreadView(projectId, thread.id).runSummaries[0]!;
  expect(summary).toMatchObject({
    runId: run.id,
    displayNodeId: branchB.tipNodeId,
    status: "succeeded",
    stepCount: 2,
    totalTokens: 21,
    errorMessage: null,
  });
  expect(summary.durationMs).not.toBeNull();
});

test("thread view falls back to trigger user node for failed runs without assistant output", () => {
  const projectId = "project_run_summary_failed_user";
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
      content: [{ type: "text", text: "失败一下" }],
    },
  });
  const run = logs.createRun(projectId, {
    threadId: thread.id,
    triggerNodeId: userNode.id,
    baseTipNodeId: userNode.id,
    runMode: "send",
    agentProfile: "project-assistant",
  });
  const errorArtifact = logs.createArtifact(projectId, {
    runId: run.id,
    artifactKind: "error",
    visibility: "internal",
    content: { message: "provider timeout" },
    summaryText: "provider timeout",
  });
  logs.markRunFailed(projectId, run.id, errorArtifact.id);

  expect(logs.getThreadView(projectId, thread.id).runSummaries).toEqual([
    expect.objectContaining({
      runId: run.id,
      displayNodeId: userNode.id,
      triggerNodeId: userNode.id,
      status: "failed",
      stepCount: 0,
      totalTokens: null,
      errorMessage: "provider timeout",
    }),
  ]);
});

test("thread view keeps failed summaries on the last assistant node when partial output exists", () => {
  const projectId = "project_run_summary_failed_assistant";
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
      content: [{ type: "text", text: "说到一半失败" }],
    },
  });
  const run = logs.createRun(projectId, {
    threadId: thread.id,
    triggerNodeId: userNode.id,
    baseTipNodeId: userNode.id,
    runMode: "send",
    agentProfile: "project-assistant",
  });
  const step = logs.createRunStep(projectId, {
    runId: run.id,
    stepIndex: 0,
    provider: "openai",
    modelId: "gpt-test",
    usage: { totalTokens: 9 },
  });
  const branch = logs.materializeResponseMessages({
    projectId,
    threadId: thread.id,
    parentNodeId: userNode.id,
    runId: run.id,
    stepId: step.id,
    messages: [{ role: "assistant", content: [{ type: "text", text: "先回答一半。" }] }],
  });
  logs.selectActiveTip(projectId, thread.id, branch.tipNodeId!);
  const errorArtifact = logs.createArtifact(projectId, {
    runId: run.id,
    artifactKind: "error",
    visibility: "internal",
    content: { message: "model error" },
    summaryText: "model error",
  });
  logs.markRunFailed(projectId, run.id, errorArtifact.id);

  expect(logs.getThreadView(projectId, thread.id).runSummaries).toEqual([
    expect.objectContaining({
      runId: run.id,
      displayNodeId: branch.tipNodeId,
      status: "failed",
      stepCount: 1,
      totalTokens: 9,
      errorMessage: "model error",
    }),
  ]);
});
