import { eq } from "drizzle-orm";

import { db, schema } from "@/db";
import { invariant, now } from "@/shared/lib/domain";

import { getBranch } from "./branches";
import { addAllAndCommit, checkoutCommitToWorktree, listLog } from "./git-storage/git-store";
import { getWorkspace, getWorkspaceForBranchId, writeProjectMeta } from "./lifecycle";

export interface CommitParentRow {
  commitId: string;
  parentId: string;
  parentIndex: number;
  mergeRole: "normal" | "mainline" | "merged";
  createdAt: number;
}

export interface CommitRow {
  id: string;
  projectId: string;
  treeId: string;
  message: string;
  author: string | null;
  committedAt: number;
  createdAt: number;
  parents: CommitParentRow[];
}

export async function createCommit(input: {
  branchId: string;
  message: string;
  author?: string | null;
  extraParents?: Array<{ parentId: string; mergeRole?: "normal" | "mainline" | "merged" }>;
}) {
  const branch = getBranch(input.branchId);
  const workspace = getWorkspaceForBranchId(branch.id);
  invariant(workspace, "无法提交：该分支没有关联的工作区。");
  const message = input.message.trim();
  invariant(message, "无法提交：提交信息不能为空。");
  const parents = [
    ...(branch.headCommitId ? [branch.headCommitId] : []),
    ...(input.extraParents?.map((parent) => parent.parentId) ?? []),
  ];
  const oid = await addAllAndCommit({
    projectId: branch.projectId,
    workspaceId: workspace.id,
    branchRef: branch.ref,
    message,
    author: input.author,
    parents: parents.length ? parents : undefined,
  });
  const timestamp = now();
  db.update(schema.branches)
    .set({ headCommitId: oid, updatedAt: timestamp })
    .where(eq(schema.branches.id, branch.id))
    .run();
  db.update(schema.projects)
    .set({ updatedAt: timestamp })
    .where(eq(schema.projects.id, branch.projectId))
    .run();
  await writeProjectMeta(branch.projectId);
  return await getCommit(oid, branch.projectId);
}

export async function checkoutCommit(input: { workspaceId: string; commitId: string }) {
  const workspace = getWorkspace(input.workspaceId);
  await checkoutCommitToWorktree({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    commitId: input.commitId,
  });
  return await getCommit(input.commitId, workspace.projectId);
}

export async function getCommit(commitId: string, projectId: string): Promise<CommitRow> {
  const branches = db
    .select()
    .from(schema.branches)
    .where(eq(schema.branches.projectId, projectId))
    .all() as Array<{ ref: string }>;
  for (const branch of branches) {
    const commits = await listLog({ projectId, ref: branch.ref });
    const found = commits.find((entry) => entry.oid === commitId);
    if (found) {
      return mapLogEntry(projectId, found);
    }
  }
  throw new Error("未找到提交。");
}

function mapLogEntry(
  projectId: string,
  entry: Awaited<ReturnType<typeof listLog>>[number],
): CommitRow {
  const committedAt = entry.commit.committer.timestamp * 1000;
  return {
    id: entry.oid,
    projectId,
    treeId: entry.commit.tree,
    message: entry.commit.message.trim(),
    author: entry.commit.author.name ?? null,
    committedAt,
    createdAt: committedAt,
    parents: entry.commit.parent.map((parentId, parentIndex) => ({
      commitId: entry.oid,
      parentId,
      parentIndex,
      mergeRole: parentIndex === 0 ? "mainline" : "merged",
      createdAt: committedAt,
    })),
  };
}

export async function listCommits(branchId: string) {
  const branch = getBranch(branchId);
  const commits = await listLog({ projectId: branch.projectId, ref: branch.ref });
  return commits.map((entry) => mapLogEntry(branch.projectId, entry));
}
