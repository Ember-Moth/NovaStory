import { expect, test } from "bun:test";

import { setupMockDatabase } from "@/test/mock-db";
import { seedProjectRecord } from "@/test/project";

setupMockDatabase();

const threadLogs = await import("./logs/threads");
const runLogs = await import("./logs/runs");
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

test("run trace keeps steps, artifacts, and events", () => {
  seedProject("project_trace");
  const thread = logs.createThread({
    projectId: "project_trace",
  });
  const userNode = logs.appendUserNode({
    threadId: thread.id,
    parentNodeId: null,
    message: {
      role: "user",
      content: [{ type: "text", text: "Hello trace" }],
    },
  });
  const run = logs.createRun({
    threadId: thread.id,
    triggerNodeId: userNode.id,
    baseTipNodeId: userNode.id,
    runMode: "send",
    agentProfile: "project-assistant",
  });
  const requestArtifact = logs.createArtifact({
    runId: run.id,
    artifactKind: "request-body",
    visibility: "internal",
    content: { prompt: "Hello trace" },
  });
  const step = logs.createRunStep({
    runId: run.id,
    stepIndex: 0,
    provider: "openai",
    modelId: "gpt-test",
    requestBodyArtifactId: requestArtifact.id,
  });
  logs.appendRunEvent({
    runId: run.id,
    stepId: step.id,
    eventKind: "provider-requested",
    summaryText: "provider request",
    payloadArtifactId: requestArtifact.id,
  });

  const trace = logs.getRunTrace(run.id);
  expect(trace.run.id).toBe(run.id);
  expect(trace.steps).toHaveLength(1);
  expect(trace.events).toHaveLength(1);
  expect(trace.artifacts).toHaveLength(1);
});

test("run trace reads Git projection instead of local run index fields", () => {
  seedProject("project_trace_git_authoritative");
  const thread = logs.createThread({
    projectId: "project_trace_git_authoritative",
  });
  const userNode = logs.appendUserNode({
    threadId: thread.id,
    parentNodeId: null,
    message: {
      role: "user",
      content: [{ type: "text", text: "Hello Git trace" }],
    },
  });
  const run = logs.createRun({
    threadId: thread.id,
    triggerNodeId: userNode.id,
    baseTipNodeId: userNode.id,
    runMode: "send",
    agentProfile: "project-assistant",
  });
  const artifact = logs.createArtifact({
    runId: run.id,
    artifactKind: "request-body",
    visibility: "internal",
    content: { prompt: "Hello Git trace" },
  });
  const step = logs.createRunStep({
    runId: run.id,
    stepIndex: 0,
    provider: "openai",
    modelId: "gpt-test",
    requestBodyArtifactId: artifact.id,
  });
  logs.appendRunEvent({
    runId: run.id,
    stepId: step.id,
    eventKind: "provider-requested",
    payloadArtifactId: artifact.id,
  });

  const trace = logs.getRunTrace(run.id);
  expect(trace.run.status).toBe("running");
  expect(trace.steps.map((entry) => entry.id)).toEqual([step.id]);
  expect(trace.events.map((entry) => entry.eventKind)).toEqual(["provider-requested"]);
  expect(trace.artifacts.map((entry) => entry.id)).toEqual([artifact.id]);
});

test("thread view builds run summaries for completed multi-step assistant runs", () => {
  seedProject("project_run_summary_success");
  const thread = logs.createThread({
    projectId: "project_run_summary_success",
  });
  const userNode = logs.appendUserNode({
    threadId: thread.id,
    parentNodeId: null,
    message: {
      role: "user",
      content: [{ type: "text", text: "继续" }],
    },
  });
  const run = logs.createRun({
    threadId: thread.id,
    triggerNodeId: userNode.id,
    baseTipNodeId: userNode.id,
    runMode: "send",
    agentProfile: "project-assistant",
  });
  const stepA = logs.createRunStep({
    runId: run.id,
    stepIndex: 0,
    provider: "openai",
    modelId: "gpt-test",
    usage: { totalTokens: 10 },
  });
  const branchA = logs.materializeResponseMessages({
    threadId: thread.id,
    parentNodeId: userNode.id,
    runId: run.id,
    stepId: stepA.id,
    messages: [{ role: "assistant", content: [{ type: "text", text: "先读取上下文。" }] }],
  });
  const stepB = logs.createRunStep({
    runId: run.id,
    stepIndex: 1,
    provider: "openai",
    modelId: "gpt-test",
    usage: { inputTokens: 3, outputTokens: 8 },
  });
  const branchB = logs.materializeResponseMessages({
    threadId: thread.id,
    parentNodeId: branchA.tipNodeId!,
    runId: run.id,
    stepId: stepB.id,
    messages: [{ role: "assistant", content: [{ type: "text", text: "这是最终答复。" }] }],
  });
  logs.selectActiveTip(thread.id, branchB.tipNodeId!);
  logs.markRunSucceeded(run.id);

  const summary = logs.getThreadView(thread.id).runSummaries[0]!;
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
  seedProject("project_run_summary_failed_user");
  const thread = logs.createThread({
    projectId: "project_run_summary_failed_user",
  });
  const userNode = logs.appendUserNode({
    threadId: thread.id,
    parentNodeId: null,
    message: {
      role: "user",
      content: [{ type: "text", text: "失败一下" }],
    },
  });
  const run = logs.createRun({
    threadId: thread.id,
    triggerNodeId: userNode.id,
    baseTipNodeId: userNode.id,
    runMode: "send",
    agentProfile: "project-assistant",
  });
  const errorArtifact = logs.createArtifact({
    runId: run.id,
    artifactKind: "error",
    visibility: "internal",
    content: { message: "provider timeout" },
    summaryText: "provider timeout",
  });
  logs.markRunFailed(run.id, errorArtifact.id);

  expect(logs.getThreadView(thread.id).runSummaries).toEqual([
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
  seedProject("project_run_summary_failed_assistant");
  const thread = logs.createThread({
    projectId: "project_run_summary_failed_assistant",
  });
  const userNode = logs.appendUserNode({
    threadId: thread.id,
    parentNodeId: null,
    message: {
      role: "user",
      content: [{ type: "text", text: "说到一半失败" }],
    },
  });
  const run = logs.createRun({
    threadId: thread.id,
    triggerNodeId: userNode.id,
    baseTipNodeId: userNode.id,
    runMode: "send",
    agentProfile: "project-assistant",
  });
  const step = logs.createRunStep({
    runId: run.id,
    stepIndex: 0,
    provider: "openai",
    modelId: "gpt-test",
    usage: { totalTokens: 9 },
  });
  const branch = logs.materializeResponseMessages({
    threadId: thread.id,
    parentNodeId: userNode.id,
    runId: run.id,
    stepId: step.id,
    messages: [{ role: "assistant", content: [{ type: "text", text: "先回答一半。" }] }],
  });
  logs.selectActiveTip(thread.id, branch.tipNodeId!);
  const errorArtifact = logs.createArtifact({
    runId: run.id,
    artifactKind: "error",
    visibility: "internal",
    content: { message: "model error" },
    summaryText: "model error",
  });
  logs.markRunFailed(run.id, errorArtifact.id);

  expect(logs.getThreadView(thread.id).runSummaries).toEqual([
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
