import { createId, invariant } from "@/shared/lib/domain";

import {
  branchRef,
  deleteBranchMeta,
  deleteRef,
  listBranchMetaIds,
  readBranchMeta,
  readCommit,
  resolveRef,
  touchProjectRepo,
  writeBranchMeta,
  writeRef,
} from "./git-storage/git-store";
import type { BranchIndexRow, ProjectIndexRow } from "./git-storage/types";
import { readProjectMeta } from "./git-storage/project-meta-store";
import { writeWorktreeStateToWorkdir } from "./git-storage/worktree-state";
import {
  deleteWorkdirForBranch,
  setWorkdirForBranch,
  setWorkdirFromCommit,
} from "./git-storage/git-store";
import type { SHA1 } from "nano-git";

export type BranchRow = BranchIndexRow;

export interface BranchHeadRow {
  branchId: string;
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

  // 检查同名分支
  const existing = await listBranches(project.id);
  invariant(
    !existing.find((branch) => branch.name === name),
    `无法创建分支：已存在名为「${name}」的分支。`,
  );

  const branchId = createId("branch");
  const initialHeadCommitId = input.fromCommitId ?? null;
  if (initialHeadCommitId) {
    await writeRef({
      projectId: project.id,
      ref: branchRef(branchId),
      value: initialHeadCommitId as SHA1,
    });
  }

  // 分支元数据写入独立 ref（直接指向 blob）
  await writeBranchMeta(project.id, branchId, {
    id: branchId,
    projectId: project.id,
    name,
    forkedFromCommitId: input.fromCommitId ?? null,
  });
  await touchProjectRepo(project.id);

  // 创建持久化 VirtualWorkdir（SQLite workdir.db）
  if (initialHeadCommitId) {
    setWorkdirFromCommit(project.id, branchId, initialHeadCommitId as SHA1);
  } else {
    const wd = setWorkdirForBranch(project.id, branchId);
    writeWorktreeStateToWorkdir(wd, { content: [], timeline: [] });
  }

  return (await getBranch(project.id, branchId))!;
}

export async function listBranches(projectId: string): Promise<BranchIndexRow[]> {
  const ids = await listBranchMetaIds(projectId);
  const rows = await Promise.all(ids.map((id) => readBranchMeta<BranchIndexRow>(projectId, id)));
  return rows.filter((r): r is BranchIndexRow => r != null);
}

export async function getBranch(projectId: string, branchId: string): Promise<BranchIndexRow> {
  const branch = await readBranchMeta<BranchIndexRow>(projectId, branchId);
  invariant(branch, "未找到分支。");
  return branch;
}

export async function getBranchHeadCommitId(projectId: string, branchId: string) {
  const branch = await getBranch(projectId, branchId);
  return await resolveRef(branch.projectId, branchRef(branch.id));
}

export async function listBranchHeads(projectId: string): Promise<BranchHeadRow[]> {
  const branches = await listBranches(projectId);
  return await Promise.all(
    branches.map(async (branch) => {
      const headCommitId = await resolveRef(projectId, branchRef(branch.id));
      let headCommitTime: number | null = null;
      if (headCommitId) {
        try {
          const commit = await readCommit(projectId, headCommitId);
          headCommitTime = commit.committer.timestamp * 1000;
        } catch {
          // ignore broken commits
        }
      }
      return { branchId: branch.id, headCommitId, headCommitTime };
    }),
  );
}

export async function deleteBranch(projectId: string, branchId: string) {
  const branch = await getBranch(projectId, branchId);
  const project = await getProject(projectId);
  invariant(
    project.defaultBranchId !== branch.id,
    "无法删除：这是项目的默认分支。请先切换默认分支。",
  );
  await deleteRef({ projectId, ref: branchRef(branch.id) });
  await deleteBranchMeta(projectId, branch.id);
  deleteWorkdirForBranch(projectId, branch.id);
  await touchProjectRepo(projectId);
}
