import { invariant, now } from "@/shared/lib/domain";

import { branchRef } from "./git-storage/git-store";
import { getBranch, getBranchHeadCommitId } from "./branches";
import { addAllAndCommit, checkoutCommitToWorktree, listLog } from "./git-storage/git-store";
import { readProjectMeta, updateProjectMeta } from "./git-storage/project-meta-store";
import { getWorkspace, getWorkspaceForBranchId } from "./lifecycle";

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
  projectId: string;
  branchId: string;
  message: string;
  author?: string | null;
  extraParents?: Array<{ parentId: string; mergeRole?: "normal" | "mainline" | "merged" }>;
}) {
  const branch = await getBranch(input.projectId, input.branchId);
  const workspace = await getWorkspaceForBranchId(input.projectId, branch.id);
  invariant(workspace, "无法提交：该分支没有关联的工作区。");
  const message = input.message.trim();
  invariant(message, "无法提交：提交信息不能为空。");
  const headCommitId = await getBranchHeadCommitId(input.projectId, branch.id);
  const parents = [
    ...(headCommitId ? [headCommitId] : []),
    ...(input.extraParents?.map((parent) => parent.parentId) ?? []),
  ];
  const oid = await addAllAndCommit({
    projectId: branch.projectId,
    workspaceId: workspace.id,
    branchRef: branchRef(branch.id),
    message,
    author: input.author,
    parents: parents.length ? parents : undefined,
  });
  const timestamp = now();
  await updateProjectMeta(
    branch.projectId,
    (payload) => ({
      ...payload,
      project: {
        ...payload.project,
        updatedAt: timestamp,
      },
      branches: payload.branches.map((item) =>
        item.id === branch.id ? { ...item, updatedAt: timestamp } : item,
      ),
    }),
    "Update branch head",
  );
  return await getCommit(oid, branch.projectId);
}

export async function checkoutCommit(input: {
  projectId: string;
  workspaceId: string;
  commitId: string;
}) {
  const workspace = await getWorkspace(input.projectId, input.workspaceId);
  await checkoutCommitToWorktree({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    commitId: input.commitId,
  });
  return await getCommit(input.commitId, workspace.projectId);
}

export async function getCommit(commitId: string, projectId: string): Promise<CommitRow> {
  const meta = await readProjectMeta(projectId);
  const branches = meta.branches.map((branch) => branch.id);
  for (const branchId of branches) {
    const commits = await listLog({ projectId, ref: branchRef(branchId) });
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

export async function listCommits(projectId: string, branchId: string) {
  const branch = await getBranch(projectId, branchId);
  const commits = await listLog({ projectId: branch.projectId, ref: branchRef(branch.id) });
  return commits.map((entry) => mapLogEntry(branch.projectId, entry));
}
