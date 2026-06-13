import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { db, schema } from "@/db";
import { appendRunEvent, createRun, createThread, getRunTrace } from "@/modules/ai/domain/logs";
import { setupMockDatabase } from "@/test/mock-db";

import { aiRunsRef, metaRef, readFileAtRef, resolveRef } from "./git-store";
import { getProjectWorktreeDir } from "./paths";
import {
  rebuildAiCache,
  rebuildProjectCache,
  rebuildVolatileCachesFromStorage,
} from "./restore-cache";
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
  db.insert(schema.projects)
    .values({ id: projectId, name: `Project ${projectId}`, description: null })
    .run();
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

async function waitForAiIndex(projectId: string) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const oid = await resolveRef(projectId, aiRunsRef(projectId));
    if (oid) {
      const threads = await readFileAtRef({
        projectId,
        ref: aiRunsRef(projectId),
        filepath: "threads.jsonl",
      }).catch(() => null);
      if (threads?.includes("agent_thread")) return threads;
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
    parentId: main.contentRootId,
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

test("project cache can be restored from the metadata custom ref", async () => {
  const workspace = seedProject("git_restore_project");
  await waitForProjectMeta("git_restore_project");
  db.update(schema.workspaces)
    .set({ worktreePath: "/old/machine/path" })
    .where(eq(schema.workspaces.id, workspace.id))
    .run();
  db.delete(schema.workspaces).run();
  db.delete(schema.branches).run();
  db.delete(schema.projects).run();

  const result = await rebuildProjectCache("git_restore_project");

  expect(result.errors).toEqual([]);
  expect(result.rebuilt).toBe(true);
  expect(db.select().from(schema.projects).all()).toHaveLength(1);
  expect(db.select().from(schema.branches).all()).toHaveLength(1);
  const restoredWorkspace = db.select().from(schema.workspaces).get();
  expect(restoredWorkspace?.id).toBe(workspace.id);
  expect(restoredWorkspace?.worktreePath).toBe(
    getProjectWorktreeDir("git_restore_project", workspace.id),
  );
});

test("AI sidebar and run cache can be restored from the AI custom ref", async () => {
  seedProject("git_restore_ai");
  const thread = createThread({ projectId: "git_restore_ai", title: "Trace" });
  const run = createRun({
    threadId: thread.id,
    runMode: "send",
    agentProfile: "project-assistant",
  });
  appendRunEvent({ runId: run.id, eventKind: "run-started" });
  expect(await waitForAiIndex("git_restore_ai")).toContain(thread.id);

  db.delete(schema.agentThreadNodes).run();
  db.delete(schema.agentRuns).run();
  db.delete(schema.agentProjectState).run();
  db.delete(schema.agentThreads).run();

  const result = await rebuildAiCache("git_restore_ai");

  expect(result.errors).toEqual([]);
  expect(result.rebuilt).toBe(true);
  expect(db.select().from(schema.agentThreads).all()).toHaveLength(1);
  expect(db.select().from(schema.agentProjectState).all()).toHaveLength(1);
  expect(db.select().from(schema.agentRuns).all()).toHaveLength(1);
  const restoredRun = db.select().from(schema.agentRuns).get();
  expect(restoredRun?.id).toBe(run.id);
  expect(restoredRun?.stepCount).toBe(0);
  expect(getRunTrace(run.id).events.map((event) => event.eventKind)).toEqual(["run-started"]);
});

test("volatile cache rebuild prunes stale rows and preserves AI catalog", async () => {
  const workspace = seedProject("git_rebuild_all");
  await waitForProjectMeta("git_rebuild_all");

  db.insert(schema.aiCatalogProviders)
    .values({
      id: "provider_keep",
      name: "Keep",
      sdkPackage: "@ai-sdk/openai",
      apiUrl: null,
      docsUrl: null,
      envKeysJson: "[]",
      rawJson: "{}",
      isActive: true,
      lastSeenAt: 1,
    })
    .run();
  db.insert(schema.projects)
    .values({ id: "stale_project", name: "Stale", description: null, defaultBranchId: null })
    .run();

  const result = await rebuildVolatileCachesFromStorage();

  expect(result.errors).toEqual([]);
  expect(
    db
      .select()
      .from(schema.projects)
      .all()
      .map((project) => project.id),
  ).toEqual(["git_rebuild_all"]);
  expect(db.select().from(schema.workspaces).get()?.id).toBe(workspace.id);
  expect(db.select().from(schema.aiCatalogProviders).get()?.id).toBe("provider_keep");
  expect(db.select().from(schema.cacheState).all().length).toBeGreaterThan(0);
});
