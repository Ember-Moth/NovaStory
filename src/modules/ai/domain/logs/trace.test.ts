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

test("run trace keeps steps, artifacts, and events", () => {
  const projectId = "project_trace";
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
      content: [{ type: "text", text: "Hello trace" }],
    },
  });
  const run = logs.createRun(projectId, {
    threadId: thread.id,
    triggerNodeId: userNode.id,
    baseTipNodeId: userNode.id,
    runMode: "send",
    agentProfile: "project-assistant",
  });
  const requestArtifact = logs.createArtifact(projectId, {
    runId: run.id,
    artifactKind: "request-body",
    visibility: "internal",
    content: { prompt: "Hello trace" },
  });
  const step = logs.createRunStep(projectId, {
    runId: run.id,
    stepIndex: 0,
    provider: "openai",
    modelId: "gpt-test",
    requestBodyArtifactId: requestArtifact.id,
  });
  logs.appendRunEvent(projectId, {
    runId: run.id,
    stepId: step.id,
    eventKind: "provider-requested",
    summaryText: "provider request",
    payloadArtifactId: requestArtifact.id,
  });

  const trace = logs.getRunTrace(projectId, run.id);
  expect(trace.run.id).toBe(run.id);
  expect(trace.steps).toHaveLength(1);
  expect(trace.events).toHaveLength(1);
  expect(trace.artifacts).toHaveLength(1);
});

test("run trace reads Git projection instead of local run index fields", () => {
  const projectId = "project_trace_git_authoritative";
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
      content: [{ type: "text", text: "Hello Git trace" }],
    },
  });
  const run = logs.createRun(projectId, {
    threadId: thread.id,
    triggerNodeId: userNode.id,
    baseTipNodeId: userNode.id,
    runMode: "send",
    agentProfile: "project-assistant",
  });
  const artifact = logs.createArtifact(projectId, {
    runId: run.id,
    artifactKind: "request-body",
    visibility: "internal",
    content: { prompt: "Hello Git trace" },
  });
  const step = logs.createRunStep(projectId, {
    runId: run.id,
    stepIndex: 0,
    provider: "openai",
    modelId: "gpt-test",
    requestBodyArtifactId: artifact.id,
  });
  logs.appendRunEvent(projectId, {
    runId: run.id,
    stepId: step.id,
    eventKind: "provider-requested",
    payloadArtifactId: artifact.id,
  });

  const trace = logs.getRunTrace(projectId, run.id);
  expect(trace.run.status).toBe("running");
  expect(trace.steps.map((entry) => entry.id)).toEqual([step.id]);
  expect(trace.events.map((entry) => entry.eventKind)).toEqual(["provider-requested"]);
  expect(trace.artifacts.map((entry) => entry.id)).toEqual([artifact.id]);
});
