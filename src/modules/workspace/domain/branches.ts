import type { SHA1 } from "nano-git";
import { invariant } from "@/shared/lib/domain";
import {
  branchRef,
  deleteBranchMapping,
  deleteRef,
  deleteWorkdirForBranch,
  generateWorkdirKey,
  getBranchMapping,
  getCurrentBranch,
  listBranchMappings,
  readCommit,
  resolveRef,
  setBranchMapping,
  setWorkdirForBranch,
  setWorkdirFromCommit,
  touchProjectRepo,
  writeRef,
} from "./git-storage/git-store";
import { writeWorktreeStateToWorkdir } from "./git-storage/worktree-state";

/** 分支 = 一个名字 + 所属项目。不再有独立 ID。 */
export interface BranchRow {
  name: string;
  projectId: string;
}

export interface BranchHeadRow {
  branchName: string;
  headCommitId: string | null;
  headCommitTime: number | null;
}

export async function createBranch(input: {
  projectId: string;
  name: string;
  fromCommitId?: string | null;
}) {
  const name = input.name.trim();
  invariant(name, "无法创建分支：分支名称不能为空。");

  // 检查同名分支（通过 branch-map.json）
  const existing = listBranchMappings(input.projectId);
  invariant(!existing.includes(name), `无法创建分支：已存在名为「${name}」的分支。`);

  // 写入 git ref: refs/heads/<name>
  const initialHeadCommitId = input.fromCommitId ?? null;
  if (initialHeadCommitId) {
    writeRef({
      projectId: input.projectId,
      ref: branchRef(name),
      value: initialHeadCommitId as SHA1,
    });
  }

  // 生成不透明的 workdir key，存入 branch-map.json
  const workdirKey = generateWorkdirKey();
  setBranchMapping(input.projectId, name, workdirKey);

  touchProjectRepo(input.projectId);

  // 创建持久化 VirtualWorktree
  if (initialHeadCommitId) {
    setWorkdirFromCommit(input.projectId, workdirKey, initialHeadCommitId as SHA1);
  } else {
    const wd = setWorkdirForBranch(input.projectId, workdirKey);
    writeWorktreeStateToWorkdir(wd, { content: [], timeline: [] });
  }

  return { name, projectId: input.projectId };
}

export function listBranches(projectId: string): BranchRow[] {
  return listBranchMappings(projectId).map((name) => ({ name, projectId }));
}

export function getBranch(projectId: string, branchName: string): BranchRow {
  const names = listBranchMappings(projectId);
  invariant(names.includes(branchName), `未找到分支「${branchName}」。`);
  return { name: branchName, projectId };
}

export function getBranchHeadCommitId(projectId: string, branchName: string) {
  return resolveRef(projectId, branchRef(branchName));
}

export function listBranchHeads(projectId: string): BranchHeadRow[] {
  const names = listBranchMappings(projectId);
  return names.map((name) => {
    const headCommitId = resolveRef(projectId, branchRef(name));
    let headCommitTime: number | null = null;
    if (headCommitId) {
      try {
        const commit = readCommit(projectId, headCommitId);
        headCommitTime = commit.committer.timestamp * 1000;
      } catch {
        // ignore broken commits
      }
    }
    return { branchName: name, headCommitId, headCommitTime };
  });
}

export async function deleteBranch(projectId: string, branchName: string) {
  const names = listBranchMappings(projectId);
  invariant(names.includes(branchName), `未找到分支「${branchName}」。`);
  const currentBranch = getCurrentBranch(projectId);
  invariant(
    currentBranch !== branchName,
    "无法删除：这是当前 HEAD 指向的分支。请先切换到其他分支。",
  );
  deleteRef({ projectId, ref: branchRef(branchName) });
  const workdirKey = getBranchMapping(projectId, branchName);
  if (workdirKey) {
    deleteWorkdirForBranch(projectId, workdirKey);
  }
  deleteBranchMapping(projectId, branchName);
  touchProjectRepo(projectId);
}
