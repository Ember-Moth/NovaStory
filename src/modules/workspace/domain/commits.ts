import type { GitAuthor, SHA1 } from "nano-git";
import { invariant } from "@/shared/lib/domain";
import { getBranch, getBranchHeadCommitId } from "./branches";
import {
  branchRef,
  getBranchMapping,
  getOrInitRepo,
  getWorkdirForBranch,
  listLog,
  setWorkdirForBranch,
  touchProjectRepo,
} from "./git-storage/git-store";
import { getWorkspaceForBranchId } from "./lifecycle";

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
  const branch = getBranch(input.projectId, input.branchId);
  const workspace = getWorkspaceForBranchId(input.projectId, branch.name);
  invariant(workspace, "无法提交：该分支没有关联的工作区。");
  const message = input.message.trim();
  invariant(message, "无法提交：提交信息不能为空。");
  const headCommitId = getBranchHeadCommitId(input.projectId, branch.name);
  const parents = [
    ...(headCommitId ? [headCommitId] : []),
    ...(input.extraParents?.map((parent) => parent.parentId) ?? []),
  ];

  // 通过 branch-map.json 解析 workdir key
  const workdirKey = getBranchMapping(input.projectId, branch.name);
  invariant(workdirKey, "无法提交：该分支没有关联的 workdir。");
  const wd = getWorkdirForBranch(input.projectId, workdirKey);
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
  repo.updateRef(branchRef(branch.name), commitHash);
  wd.reset(treeHash);
  touchProjectRepo(branch.projectId);
  return await getCommit(commitHash as string, branch.projectId);
}

export async function checkoutCommit(input: {
  projectId: string;
  workspaceId: string;
  commitId: SHA1;
}) {
  const workspace = getWorkspaceForBranchId(input.projectId, input.workspaceId);
  invariant(workspace, "未找到工作区。");
  const repo = getOrInitRepo(input.projectId);
  const commit = repo.catFile(input.commitId);
  if (commit.type !== "commit") {
    throw new Error(`Expected commit at ${input.commitId}, got ${commit.type}`);
  }
  // 通过 branch-map.json 解析 workdir key
  const workdirKey = getBranchMapping(input.projectId, workspace.branchName);
  invariant(workdirKey, "无法 checkout：该分支没有关联的 workdir。");
  setWorkdirForBranch(input.projectId, workdirKey, commit.tree);
  return await getCommit(input.commitId, workspace.projectId);
}

export async function getCommit(commitId: string, projectId: string): Promise<CommitRow> {
  const { listBranches } = await import("./branches");
  const branches = listBranches(projectId);
  for (const branch of branches) {
    const commits = listLog({ projectId, ref: branchRef(branch.name) });
    const found = commits.find((entry) => entry.oid === commitId);
    if (found) {
      return mapLogEntry(projectId, found);
    }
  }
  throw new Error("未找到提交。");
}

function mapLogEntry(projectId: string, entry: ReturnType<typeof listLog>[number]): CommitRow {
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

export function listCommits(projectId: string, branchId: string) {
  const branch = getBranch(projectId, branchId);
  const commits = listLog({ projectId: branch.projectId, ref: branchRef(branch.name) });
  return commits.map((entry) => mapLogEntry(branch.projectId, entry));
}
