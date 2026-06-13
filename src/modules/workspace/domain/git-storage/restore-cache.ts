import fs from "node:fs";
import path from "node:path";

import git from "isomorphic-git";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type {
  AgentProjectStateRow,
  AgentRunRow,
  AgentThreadNodeRow,
  AgentThreadRow,
  AiRunsMetaPayload,
} from "@/modules/ai/domain/types";
import { invariant } from "@/shared/lib/domain";

import { aiRunsRef, metaRef, readFilesAtRef, resolveRef } from "./git-store";
import { parseJsonl } from "./jsonl";
import { ensureStorageRoot, getProjectRepoGitDir, getProjectWorktreeDir } from "./paths";
import type { BranchIndexRow, ProjectIndexRow, WorkspaceIndexRow } from "./types";
import { withProjectLock } from "./lock";

export interface ProjectRestoreResult {
  projectId: string;
  restored: boolean;
  projects: number;
  branches: number;
  workspaces: number;
  errors: string[];
}

export interface AiRestoreResult {
  projectId: string;
  restored: boolean;
  threads: number;
  projectState: number;
  nodes: number;
  runs: number;
  errors: string[];
}

export interface RestoreReport {
  projects: ProjectRestoreResult[];
  ai: AiRestoreResult[];
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
  if (!branch.ref) return branch.headCommitId;
  return (await resolveRef(projectId, branch.ref)) ?? branch.headCommitId;
}

export async function restoreProjectCache(projectId: string): Promise<ProjectRestoreResult> {
  return await withProjectLock(projectId, async () => {
    const errors: string[] = [];
    try {
      if (!(await resolveRef(projectId, metaRef(projectId)))) {
        return { projectId, restored: false, projects: 0, branches: 0, workspaces: 0, errors };
      }

      const files = await readFilesAtRef({ projectId, ref: metaRef(projectId) });
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
        tx.insert(schema.projects)
          .values({ ...project, defaultBranchId: null })
          .onConflictDoUpdate({
            target: schema.projects.id,
            set: {
              name: project.name,
              description: project.description,
              defaultBranchId: null,
              createdAt: project.createdAt,
              updatedAt: project.updatedAt,
            },
          })
          .run();
        for (const branch of branches) {
          tx.insert(schema.branches)
            .values(branch)
            .onConflictDoUpdate({
              target: schema.branches.id,
              set: {
                projectId: branch.projectId,
                name: branch.name,
                ref: branch.ref,
                headCommitId: branch.headCommitId,
                forkedFromCommitId: branch.forkedFromCommitId,
                createdAt: branch.createdAt,
                updatedAt: branch.updatedAt,
              },
            })
            .run();
        }
        tx.update(schema.projects)
          .set({ defaultBranchId: project.defaultBranchId, updatedAt: project.updatedAt })
          .where(eq(schema.projects.id, project.id))
          .run();
        for (const workspace of workspaces) {
          tx.insert(schema.workspaces)
            .values(workspace)
            .onConflictDoUpdate({
              target: schema.workspaces.id,
              set: {
                projectId: workspace.projectId,
                branchId: workspace.branchId,
                name: workspace.name,
                worktreePath: workspace.worktreePath,
                contentRootId: workspace.contentRootId,
                auxRootId: workspace.auxRootId,
                createdAt: workspace.createdAt,
                updatedAt: workspace.updatedAt,
              },
            })
            .run();
        }
      });

      return {
        projectId,
        restored: true,
        projects: 1,
        branches: branches.length,
        workspaces: workspaces.length,
        errors,
      };
    } catch (error) {
      errors.push(stringifyError(error));
      return { projectId, restored: false, projects: 0, branches: 0, workspaces: 0, errors };
    }
  });
}

function parseRunRow(files: Record<string, string>, runId: string): AgentRunRow | null {
  const run = files[`runs/${runId}/run.json`];
  if (!run) return null;
  const view = JSON.parse(run) as Record<string, unknown>;
  return {
    id: String(view.id),
    threadId: String(view.threadId),
    parentRunId: typeof view.parentRunId === "string" ? view.parentRunId : null,
    parentEventId: typeof view.parentEventId === "string" ? view.parentEventId : null,
    triggerNodeId: typeof view.triggerNodeId === "string" ? view.triggerNodeId : null,
    baseTipNodeId: typeof view.baseTipNodeId === "string" ? view.baseTipNodeId : null,
    runMode: String(view.runMode),
    status: String(view.status),
    agentProfile: String(view.agentProfile),
    errorArtifactId: typeof view.errorArtifactId === "string" ? view.errorArtifactId : null,
    startedAt: Number(view.startedAt),
    completedAt: typeof view.completedAt === "number" ? view.completedAt : null,
    createdAt: Number(view.createdAt),
    updatedAt: Number(view.updatedAt),
  };
}

function discoverRunIds(files: Record<string, string>) {
  const runIds = new Set<string>();
  for (const filepath of Object.keys(files)) {
    const match = /^runs\/([^/]+)\/run\.json$/.exec(filepath);
    if (match?.[1]) runIds.add(match[1]);
  }
  return [...runIds].sort((left, right) => left.localeCompare(right));
}

export async function restoreAiCache(projectId: string): Promise<AiRestoreResult> {
  return await withProjectLock(projectId, async () => {
    const errors: string[] = [];
    try {
      if (!(await resolveRef(projectId, aiRunsRef(projectId)))) {
        return {
          projectId,
          restored: false,
          threads: 0,
          projectState: 0,
          nodes: 0,
          runs: 0,
          errors,
        };
      }

      const files = await readFilesAtRef({ projectId, ref: aiRunsRef(projectId) });
      const payload: AiRunsMetaPayload = {
        threads: parseJsonl<AgentThreadRow>(files["threads.jsonl"]),
        projectState: parseJsonl<AgentProjectStateRow>(files["project-state.jsonl"]),
        nodes: parseJsonl<AgentThreadNodeRow>(files["nodes.jsonl"]),
      };
      const runs = discoverRunIds(files).flatMap((runId) => {
        const row = parseRunRow(files, runId);
        return row ? [row] : [];
      });

      db.transaction((tx) => {
        for (const thread of payload.threads) {
          tx.insert(schema.agentThreads)
            .values(thread)
            .onConflictDoUpdate({
              target: schema.agentThreads.id,
              set: {
                projectId: thread.projectId,
                agentProfile: thread.agentProfile,
                title: thread.title,
                activeTipNodeId: thread.activeTipNodeId,
                archivedAt: thread.archivedAt,
                createdAt: thread.createdAt,
                updatedAt: thread.updatedAt,
              },
            })
            .run();
        }
        for (const state of payload.projectState) {
          tx.insert(schema.agentProjectState)
            .values(state)
            .onConflictDoUpdate({
              target: schema.agentProjectState.id,
              set: {
                projectId: state.projectId,
                agentProfile: state.agentProfile,
                activeThreadId: state.activeThreadId,
                createdAt: state.createdAt,
                updatedAt: state.updatedAt,
              },
            })
            .run();
        }
        for (const run of runs) {
          tx.insert(schema.agentRuns)
            .values(run)
            .onConflictDoUpdate({
              target: schema.agentRuns.id,
              set: {
                threadId: run.threadId,
                parentRunId: run.parentRunId,
                parentEventId: run.parentEventId,
                triggerNodeId: run.triggerNodeId,
                baseTipNodeId: run.baseTipNodeId,
                runMode: run.runMode,
                status: run.status,
                agentProfile: run.agentProfile,
                errorArtifactId: run.errorArtifactId,
                startedAt: run.startedAt,
                completedAt: run.completedAt,
                createdAt: run.createdAt,
                updatedAt: run.updatedAt,
              },
            })
            .run();
        }
        for (const node of payload.nodes) {
          tx.insert(schema.agentThreadNodes)
            .values(node)
            .onConflictDoUpdate({
              target: schema.agentThreadNodes.id,
              set: {
                threadId: node.threadId,
                parentNodeId: node.parentNodeId,
                role: node.role,
                createdByRunId: node.createdByRunId,
                sourceStepId: node.sourceStepId,
                sourceKind: node.sourceKind,
                summaryText: node.summaryText,
                partsJson: node.partsJson,
                createdAt: node.createdAt,
              },
            })
            .run();
        }
      });

      return {
        projectId,
        restored: true,
        threads: payload.threads.length,
        projectState: payload.projectState.length,
        nodes: payload.nodes.length,
        runs: runs.length,
        errors,
      };
    } catch (error) {
      errors.push(stringifyError(error));
      return {
        projectId,
        restored: false,
        threads: 0,
        projectState: 0,
        nodes: 0,
        runs: 0,
        errors,
      };
    }
  });
}

export async function restoreCachesFromStorage(): Promise<RestoreReport> {
  const errors: string[] = [];
  const projectIds = await listRepoProjectIds();
  const projects: ProjectRestoreResult[] = [];
  const ai: AiRestoreResult[] = [];

  for (const projectId of projectIds) {
    const gitdir = getProjectRepoGitDir(projectId);
    const headExists = await fs.promises
      .access(path.join(gitdir, "HEAD"))
      .then(() => true)
      .catch(() => false);
    if (!headExists) {
      errors.push(`${projectId}: missing repo HEAD`);
      continue;
    }

    try {
      await git.listRefs({ fs, gitdir, filepath: "refs" });
    } catch (error) {
      errors.push(`${projectId}: ${stringifyError(error)}`);
      continue;
    }

    projects.push(await restoreProjectCache(projectId));
    ai.push(await restoreAiCache(projectId));
  }

  return { projects, ai, errors };
}
