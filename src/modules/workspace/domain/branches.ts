import { invariant } from "@/shared/lib/domain";

import {
  branchRef,
  deleteRef,
  readCommit,
  resolveRef,
  touchProjectRepo,
  writeRef,
  listBranchMappings,
  getBranchMapping,
  setBranchMapping,
  deleteBranchMapping,
  generateWorkdirKey,
} from "./git-storage/git-store";
import type { ProjectIndexRow } from "./git-storage/types";
import { readProjectMeta } from "./git-storage/project-meta-store";
import { writeWorktreeStateToWorkdir } from "./git-storage/worktree-state";
import {
  deleteWorkdirForBranch,
  setWorkdirForBranch,
  setWorkdirFromCommit,
} from "./git-storage/git-store";
import type { SHA1 } from "nano-git";

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

async function getProject(projectId: string): Promise<ProjectIndexRow> {
  return (await readProjectMeta(projectId)).project;
}

export async function createBranch(input: {
  projectId: string;
  name: string;
  fromCommitId?: string | null;
}) {
  const project = await getProject(input.projectId);
  const name = input.name.trim();
  invariant(name, "无法创建分支：分支名称不能为空。");

  // 检查同名分支（通过 branch-map.json）
  const existing = listBranchMappings(project.id);
  invariant(!existing.includes(name), `无法创建分支：已存在名为「${name}」的分支。`);

  // 写入 git ref: refs/heads/<name>
  const initialHeadCommitId = input.fromCommitId ?? null;
  if (initialHeadCommitId) {
    await writeRef({
      projectId: project.id,
      ref: branchRef(name),
      value: initialHeadCommitId as SHA1,
    });
  }

  // 生成不透明的 workdir key，存入 branch-map.json
  const workdirKey = generateWorkdirKey();
  setBranchMapping(project.id, name, workdirKey);

  await touchProjectRepo(project.id);

  // 创建持久化 VirtualWorkdir
  if (initialHeadCommitId) {
    setWorkdirFromCommit(project.id, workdirKey, initialHeadCommitId as SHA1);
  } else {
    const wd = setWorkdirForBranch(project.id, workdirKey);
    writeWorktreeStateToWorkdir(wd, { content: [], timeline: [] });
  }

  return { name, projectId: project.id };
}

export async function listBranches(projectId: string): Promise<BranchRow[]> {
  return listBranchMappings(projectId).map((name) => ({ name, projectId }));
}

export async function getBranch(projectId: string, branchName: string): Promise<BranchRow> {
  const names = listBranchMappings(projectId);
  invariant(names.includes(branchName), `未找到分支「${branchName}」。`);
  return { name: branchName, projectId };
}

export async function getBranchHeadCommitId(projectId: string, branchName: string) {
  return await resolveRef(projectId, branchRef(branchName));
}

export async function listBranchHeads(projectId: string): Promise<BranchHeadRow[]> {
  const names = listBranchMappings(projectId);
  return await Promise.all(
    names.map(async (name) => {
      const headCommitId = await resolveRef(projectId, branchRef(name));
      let headCommitTime: number | null = null;
      if (headCommitId) {
        try {
          const commit = await readCommit(projectId, headCommitId);
          headCommitTime = commit.committer.timestamp * 1000;
        } catch {
          // ignore broken commits
        }
      }
      return { branchName: name, headCommitId, headCommitTime };
    }),
  );
}

export async function deleteBranch(projectId: string, branchName: string) {
  const names = listBranchMappings(projectId);
  invariant(names.includes(branchName), `未找到分支「${branchName}」。`);
  const project = await getProject(projectId);
  invariant(
    project.defaultBranchName !== branchName,
    "无法删除：这是项目的默认分支。请先切换默认分支。",
  );
  await deleteRef({ projectId, ref: branchRef(branchName) });
  const workdirKey = getBranchMapping(projectId, branchName);
  if (workdirKey) {
    deleteWorkdirForBranch(projectId, workdirKey);
  }
  deleteBranchMapping(projectId, branchName);
  await touchProjectRepo(projectId);
}
