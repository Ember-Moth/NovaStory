import { invariant } from "@/shared/lib/domain";

import { branchRef, touchProjectRepo } from "./git-storage/git-store";
import { getBranch, getBranchHeadCommitId } from "./branches";
import { listLog } from "./git-storage/git-store";
import { getWorkspace, getWorkspaceForBranchId } from "./lifecycle";
import {
  getWorkdirForBranch,
  setWorkdirForBranch,
  getOrInitRepo,
} from "./git-storage/nano-git-store";
import type { GitAuthor, SHA1 } from "nano-git";

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

  // VirtualWorkdir-based commit（SQLite 持久化 after Phase 0）
  const wd = getWorkdirForBranch(input.projectId, input.branchId);
  invariant(wd, "无法提交：该分支没有可用的工作目录。请确保工作区已初始化。");
  const repo = getOrInitRepo(input.projectId);
  const treeHash = wd.writeTree();
  const timestamp = Math.floor(Date.now() / 1000);
  const author: GitAuthor = {
    name: input.author || "NovelEvolver",
    email: "noreply@novel-evolver.local",
    timestamp,
    timezone: "+0000",
  };
  const parentHashes = parents.length > 0 ? (parents as SHA1[]) : [];
  const commitHash = repo.createCommit(treeHash, parentHashes, input.message, author);
  repo.updateRef(branchRef(branch.id), commitHash);
  wd.reset(treeHash);
  await touchProjectRepo(branch.projectId);
  return await getCommit(commitHash as string, branch.projectId);
}

export async function checkoutCommit(input: {
  projectId: string;
  workspaceId: string;
  commitId: string;
}) {
  const workspace = await getWorkspace(input.projectId, input.workspaceId);
  const repo = getOrInitRepo(input.projectId);
  const commit = repo.catFile(input.commitId as SHA1);
  if (commit.type !== "commit") {
    throw new Error(`Expected commit at ${input.commitId}, got ${commit.type}`);
  }
  // 重置 VirtualWorkdir 到指定 commit 的 tree（SQLite 持久化）
  setWorkdirForBranch(input.projectId, workspace.id, commit.tree);
  return await getCommit(input.commitId, workspace.projectId);
}

export async function getCommit(commitId: string, projectId: string): Promise<CommitRow> {
  const { listBranches } = await import("./branches");
  const branches = await listBranches(projectId);
  for (const branch of branches) {
    const commits = await listLog({ projectId, ref: branchRef(branch.id) });
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
