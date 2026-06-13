import fs from "node:fs";
import path from "node:path";

import git from "isomorphic-git";
import { eq } from "drizzle-orm";

import { db, schema } from "@/db";
import { buildAgentRunCacheFieldsFromTrace, type RunTraceRows } from "@/modules/ai/domain/logs";
import type {
  AgentArtifactRow,
  AgentProjectStateRow,
  AgentRunEventRow,
  AgentRunInputRefRow,
  AgentRunStepRow,
  AgentRunView,
  AgentThreadNodeRow,
  AgentThreadRow,
  AiRunsMetaPayload,
} from "@/modules/ai/domain/types";
import { invariant, now } from "@/shared/lib/domain";

import { aiRunsRef, metaRef, readFilesAtRef, resolveRef } from "./git-store";
import { parseJsonl } from "./jsonl";
import { withProjectLock } from "./lock";
import { ensureStorageRoot, getProjectRepoGitDir, getProjectWorktreeDir } from "./paths";
import type { BranchIndexRow, ProjectIndexRow, WorkspaceIndexRow } from "./types";

export interface ProjectRebuildResult {
  projectId: string;
  rebuilt: boolean;
  projects: number;
  branches: number;
  workspaces: number;
  sourceOid: string | null;
  errors: string[];
}

export interface AiRebuildResult {
  projectId: string;
  rebuilt: boolean;
  threads: number;
  projectState: number;
  nodes: number;
  runs: number;
  sourceOid: string | null;
  errors: string[];
}

export interface RebuildReport {
  projects: ProjectRebuildResult[];
  ai: AiRebuildResult[];
  errors: string[];
}

function stringifyError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function repoProjectIdFromDirname(dirname: string) {
  return dirname.endsWith(".git") ? dirname.slice(0, -4) : null;
}

async function listRepoProjectIds() {
  const reposDir = path.join(ensureStorageRoot(), "repos");
  const entries = await fs.promises.readdir(reposDir, { withFileTypes: true }).catch(() => []);
  return entries
    .flatMap((entry) => {
      if (!entry.isDirectory()) return [];
      const projectId = repoProjectIdFromDirname(entry.name);
      return projectId ? [projectId] : [];
    })
    .sort((left, right) => left.localeCompare(right));
}

function parseRequiredJson<T>(content: string | undefined, label: string): T {
  invariant(content, `缺少 ${label}。`);
  return JSON.parse(content) as T;
}

async function resolveBranchHead(projectId: string, branch: BranchIndexRow) {
  return (await resolveRef(projectId, branch.ref)) ?? branch.headCommitId;
}

function rebuildStateId(domain: "projects" | "ai-runs", projectId: string) {
  return `${domain}:${projectId}`;
}

function recordRebuildState(input: {
  domain: "projects" | "ai-runs";
  projectId: string;
  sourceRef: string;
  sourceOid: string | null;
  rebuiltAt: number | null;
  lastError: string | null;
}) {
  const timestamp = now();
  db.insert(schema.cacheRebuildState)
    .values({
      id: rebuildStateId(input.domain, input.projectId),
      domain: input.domain,
      projectId: input.projectId,
      sourceRef: input.sourceRef,
      sourceOid: input.sourceOid,
      rebuiltAt: input.rebuiltAt,
      lastError: input.lastError,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .onConflictDoUpdate({
      target: schema.cacheRebuildState.id,
      set: {
        sourceRef: input.sourceRef,
        sourceOid: input.sourceOid,
        rebuiltAt: input.rebuiltAt,
        lastError: input.lastError,
        updatedAt: timestamp,
      },
    })
    .run();
}

function clearProjectRows(projectId: string) {
  db.delete(schema.workspaces).where(eq(schema.workspaces.projectId, projectId)).run();
  db.delete(schema.branches).where(eq(schema.branches.projectId, projectId)).run();
  db.delete(schema.projects).where(eq(schema.projects.id, projectId)).run();
}

function clearAiRows(projectId: string) {
  db.delete(schema.agentProjectState)
    .where(eq(schema.agentProjectState.projectId, projectId))
    .run();
  db.delete(schema.agentThreads).where(eq(schema.agentThreads.projectId, projectId)).run();
}

function clearVolatileCacheRows() {
  db.delete(schema.agentThreadNodes).run();
  db.delete(schema.agentRuns).run();
  db.delete(schema.agentProjectState).run();
  db.delete(schema.agentThreads).run();
  db.delete(schema.workspaces).run();
  db.delete(schema.branches).run();
  db.delete(schema.projects).run();
  db.delete(schema.cacheRebuildState).run();
}

export async function rebuildProjectCache(projectId: string): Promise<ProjectRebuildResult> {
  return await withProjectLock(projectId, async () => {
    const errors: string[] = [];
    const ref = metaRef(projectId);
    let sourceOid: string | null = null;
    try {
      sourceOid = await resolveRef(projectId, ref);
      if (!sourceOid) {
        clearProjectRows(projectId);
        recordRebuildState({
          domain: "projects",
          projectId,
          sourceRef: ref,
          sourceOid,
          rebuiltAt: null,
          lastError: null,
        });
        return {
          projectId,
          rebuilt: false,
          projects: 0,
          branches: 0,
          workspaces: 0,
          sourceOid,
          errors,
        };
      }

      const files = await readFilesAtRef({ projectId, ref });
      const project = parseRequiredJson<ProjectIndexRow>(files["project.json"], "project.json");
      const branches = await Promise.all(
        parseJsonl<BranchIndexRow>(files["branches.jsonl"]).map(async (branch) => ({
          ...branch,
          headCommitId: await resolveBranchHead(projectId, branch),
        })),
      );
      const workspaces = parseJsonl<WorkspaceIndexRow>(files["workspaces.jsonl"]).map(
        (workspace) => ({
          ...workspace,
          worktreePath: getProjectWorktreeDir(projectId, workspace.id),
        }),
      );

      db.transaction((tx) => {
        tx.delete(schema.workspaces).where(eq(schema.workspaces.projectId, projectId)).run();
        tx.delete(schema.branches).where(eq(schema.branches.projectId, projectId)).run();
        tx.delete(schema.projects).where(eq(schema.projects.id, projectId)).run();
        tx.insert(schema.projects)
          .values({ ...project, defaultBranchId: null })
          .run();
        for (const branch of branches) {
          tx.insert(schema.branches).values(branch).run();
        }
        tx.update(schema.projects)
          .set({ defaultBranchId: project.defaultBranchId, updatedAt: project.updatedAt })
          .where(eq(schema.projects.id, project.id))
          .run();
        for (const workspace of workspaces) {
          tx.insert(schema.workspaces).values(workspace).run();
        }
      });
      recordRebuildState({
        domain: "projects",
        projectId,
        sourceRef: ref,
        sourceOid,
        rebuiltAt: now(),
        lastError: null,
      });

      return {
        projectId,
        rebuilt: true,
        projects: 1,
        branches: branches.length,
        workspaces: workspaces.length,
        sourceOid,
        errors,
      };
    } catch (error) {
      const message = stringifyError(error);
      errors.push(message);
      recordRebuildState({
        domain: "projects",
        projectId,
        sourceRef: ref,
        sourceOid,
        rebuiltAt: null,
        lastError: message,
      });
      return {
        projectId,
        rebuilt: false,
        projects: 0,
        branches: 0,
        workspaces: 0,
        sourceOid,
        errors,
      };
    }
  });
}

function discoverRunIds(files: Record<string, string>) {
  const runIds = new Set<string>();
  for (const filepath of Object.keys(files)) {
    const match = /^runs\/([^/]+)\/run\.json$/.exec(filepath);
    if (match?.[1]) runIds.add(match[1]);
  }
  return [...runIds].sort((left, right) => left.localeCompare(right));
}

function parseRunTraceRows(files: Record<string, string>, runId: string): RunTraceRows | null {
  const runJson = files[`runs/${runId}/run.json`];
  if (!runJson) return null;
  const run = JSON.parse(runJson) as AgentRunView;
  const childRuns = discoverRunIds(files)
    .flatMap((childRunId) => {
      if (childRunId === run.id) return [];
      const childRunJson = files[`runs/${childRunId}/run.json`];
      if (!childRunJson) return [];
      const childRun = JSON.parse(childRunJson) as AgentRunView;
      return childRun.parentRunId === run.id ? [childRun] : [];
    })
    .sort((left, right) => left.createdAt - right.createdAt);
  return {
    run,
    inputRefs: parseJsonl<AgentRunInputRefRow>(files[`runs/${runId}/input-refs.jsonl`]),
    steps: parseJsonl<AgentRunStepRow>(files[`runs/${runId}/steps.jsonl`]).sort(
      (left, right) => left.stepIndex - right.stepIndex,
    ),
    events: parseJsonl<AgentRunEventRow>(files[`runs/${runId}/events.jsonl`]).sort(
      (left, right) => left.seq - right.seq,
    ),
    artifacts: parseJsonl<AgentArtifactRow>(files[`runs/${runId}/artifacts.jsonl`]).sort(
      (left, right) => left.createdAt - right.createdAt,
    ),
    childRuns,
  };
}

function buildRunRow(rows: RunTraceRows): typeof schema.agentRuns.$inferInsert {
  const run = rows.run;
  return {
    id: run.id,
    threadId: run.threadId,
    parentRunId: run.parentRunId,
    parentEventId: run.parentEventId,
    triggerNodeId: run.triggerNodeId,
    baseTipNodeId: run.baseTipNodeId,
    runMode: run.runMode,
    status: run.status,
    agentProfile: run.agentProfile,
    errorArtifactId: run.errorArtifactId,
    ...buildAgentRunCacheFieldsFromTrace(rows),
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}

export async function rebuildAiCache(projectId: string): Promise<AiRebuildResult> {
  return await withProjectLock(projectId, async () => {
    const errors: string[] = [];
    const ref = aiRunsRef(projectId);
    let sourceOid: string | null = null;
    try {
      sourceOid = await resolveRef(projectId, ref);
      if (!sourceOid) {
        clearAiRows(projectId);
        recordRebuildState({
          domain: "ai-runs",
          projectId,
          sourceRef: ref,
          sourceOid,
          rebuiltAt: null,
          lastError: null,
        });
        return {
          projectId,
          rebuilt: false,
          threads: 0,
          projectState: 0,
          nodes: 0,
          runs: 0,
          sourceOid,
          errors,
        };
      }

      const files = await readFilesAtRef({ projectId, ref });
      const payload: AiRunsMetaPayload = {
        threads: parseJsonl<AgentThreadRow>(files["threads.jsonl"]),
        projectState: parseJsonl<AgentProjectStateRow>(files["project-state.jsonl"]),
        nodes: parseJsonl<AgentThreadNodeRow>(files["nodes.jsonl"]),
      };
      const runs = discoverRunIds(files).flatMap((runId) => {
        const rows = parseRunTraceRows(files, runId);
        return rows ? [buildRunRow(rows)] : [];
      });

      db.transaction((tx) => {
        tx.delete(schema.agentProjectState)
          .where(eq(schema.agentProjectState.projectId, projectId))
          .run();
        tx.delete(schema.agentThreads).where(eq(schema.agentThreads.projectId, projectId)).run();
        for (const thread of payload.threads) {
          tx.insert(schema.agentThreads).values(thread).run();
        }
        for (const state of payload.projectState) {
          tx.insert(schema.agentProjectState).values(state).run();
        }
        for (const run of runs) {
          tx.insert(schema.agentRuns).values(run).run();
        }
        for (const node of payload.nodes) {
          tx.insert(schema.agentThreadNodes).values(node).run();
        }
      });
      recordRebuildState({
        domain: "ai-runs",
        projectId,
        sourceRef: ref,
        sourceOid,
        rebuiltAt: now(),
        lastError: null,
      });

      return {
        projectId,
        rebuilt: true,
        threads: payload.threads.length,
        projectState: payload.projectState.length,
        nodes: payload.nodes.length,
        runs: runs.length,
        sourceOid,
        errors,
      };
    } catch (error) {
      const message = stringifyError(error);
      errors.push(message);
      recordRebuildState({
        domain: "ai-runs",
        projectId,
        sourceRef: ref,
        sourceOid,
        rebuiltAt: null,
        lastError: message,
      });
      return {
        projectId,
        rebuilt: false,
        threads: 0,
        projectState: 0,
        nodes: 0,
        runs: 0,
        sourceOid,
        errors,
      };
    }
  });
}

async function validateProjectRepo(projectId: string) {
  const gitdir = getProjectRepoGitDir(projectId);
  const headExists = await fs.promises
    .access(path.join(gitdir, "HEAD"))
    .then(() => true)
    .catch(() => false);
  if (!headExists) {
    return `${projectId}: missing repo HEAD`;
  }

  try {
    await git.listRefs({ fs, gitdir, filepath: "refs" });
    return null;
  } catch (error) {
    return `${projectId}: ${stringifyError(error)}`;
  }
}

export async function rebuildVolatileCachesFromStorage(): Promise<RebuildReport> {
  const errors: string[] = [];
  const projectIds = await listRepoProjectIds();
  const projects: ProjectRebuildResult[] = [];
  const ai: AiRebuildResult[] = [];

  clearVolatileCacheRows();

  for (const projectId of projectIds) {
    const validationError = await validateProjectRepo(projectId);
    if (validationError) {
      errors.push(validationError);
      continue;
    }

    projects.push(await rebuildProjectCache(projectId));
    ai.push(await rebuildAiCache(projectId));
  }

  return { projects, ai, errors };
}
