import { expect, test } from "bun:test";

import { createThread } from "@/modules/ai/domain/logs/threads";
import { appendRunEvent, createRun } from "@/modules/ai/domain/logs/runs";
import { setupMockDatabase } from "@/test/mock-db";
import { seedProjectRecord } from "@/test/project";

import { aiRunsRef, metaRef, readFileAtRef, resolveRef } from "./git-store";
import {
  createBranchWorkspace,
  createCommit,
  createContentNode,
  createDefaultWorkspace,
  exportContentSubtree,
  updateContentNode,
} from "..";

setupMockDatabase();

function seedProject(projectId: string) {
  seedProjectRecord(projectId);
  return createDefaultWorkspace(projectId);
}

async function waitForRef(projectId: string, ref: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const oid = await resolveRef(projectId, ref);
    if (oid) return oid;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return null;
}

async function waitForProjectMeta(projectId: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const oid = await resolveRef(projectId, metaRef(projectId));
    if (oid) {
      const projectJson = await readFileAtRef({
        projectId,
        ref: metaRef(projectId),
        filepath: "project.json",
      });
      const parsed = JSON.parse(projectJson) as { defaultBranchId: string | null };
      if (parsed.defaultBranchId) return parsed;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return null;
}

test("project initialization writes a real repo and metadata custom ref", async () => {
  const workspace = seedProject("git_init");

  expect(await waitForRef("git_init", metaRef("git_init"))).toMatch(/^[0-9a-f]{40}$/);
  expect((await waitForProjectMeta("git_init"))?.defaultBranchId).toBe(workspace.branchId);
});

test("branch worktrees preserve independent uncommitted edits", async () => {
  const main = seedProject("git_branch_independent");
  const chapter = createContentNode({
    workspaceId: main.id,
    parentId: null,
    title: "Base",
    body: "base",
  });
  const base = await createCommit({ branchId: main.branchId, message: "base" });
  const feature = await createBranchWorkspace({
    projectId: "git_branch_independent",
    name: "feature",
    fromCommitId: base.id,
  });

  updateContentNode({
    workspaceId: feature.id,
    nodeId: chapter.id,
    body: "feature draft",
  });

  expect(exportContentSubtree(main.id).nodes[0]?.body).toBe("base");
  expect(exportContentSubtree(feature.id).nodes[0]?.body).toBe("feature draft");
});

test("AI run events are mirrored into an AI custom ref", async () => {
  seedProject("git_ai_logs");
  const thread = createThread({ projectId: "git_ai_logs", title: "Trace" });
  const run = createRun({
    threadId: thread.id,
    runMode: "send",
    agentProfile: "project-assistant",
  });

  appendRunEvent({ runId: run.id, eventKind: "run-started" });

  await new Promise((resolve) => setTimeout(resolve, 25));
  expect(await resolveRef("git_ai_logs", aiRunsRef("git_ai_logs"))).toMatch(/^[0-9a-f]{40}$/);
  const events = await readFileAtRef({
    projectId: "git_ai_logs",
    ref: aiRunsRef("git_ai_logs"),
    filepath: `runs/${run.id}/events.jsonl`,
  });
  expect(events).toContain("run-started");
});
