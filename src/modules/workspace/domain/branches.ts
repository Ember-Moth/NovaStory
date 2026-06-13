import fs from "node:fs";

import { and, eq } from "drizzle-orm";

import { db, schema } from "@/db";
import { createId, invariant, now } from "@/shared/lib/domain";

import { toBranchRef } from "./git-storage/git-store";
import type { BranchIndexRow, ProjectIndexRow } from "./git-storage/types";
import { getWorkspaceForBranchId, writeProjectMeta, writeProjectMetaSync } from "./lifecycle";

export type BranchRow = BranchIndexRow;

function getProject(projectId: string): ProjectIndexRow {
  const project = db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).get();
  invariant(project, "未找到项目。");
  return project as ProjectIndexRow;
}

export function createBranch(input: {
  projectId: string;
  name: string;
  fromCommitId?: string | null;
}) {
  const project = getProject(input.projectId);
  const name = input.name.trim();
  invariant(name, "无法创建分支：分支名称不能为空。");
  const existing = db
    .select({ id: schema.branches.id })
    .from(schema.branches)
    .where(and(eq(schema.branches.projectId, project.id), eq(schema.branches.name, name)))
    .get();
  invariant(!existing, `无法创建分支：已存在名为「${name}」的分支。`);

  const branchId = createId("branch");
  const timestamp = now();
  const ref = toBranchRef(name);
  const headCommitId = input.fromCommitId ?? null;
  db.insert(schema.branches)
    .values({
      id: branchId,
      projectId: project.id,
      name,
      ref,
      headCommitId,
      forkedFromCommitId: input.fromCommitId ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
    } as typeof schema.branches.$inferInsert)
    .run();
  db.update(schema.projects)
    .set({ updatedAt: timestamp })
    .where(eq(schema.projects.id, project.id))
    .run();
  writeProjectMetaSync(project.id);
  return getBranch(branchId);
}

export function listBranches(projectId: string) {
  getProject(projectId);
  return db
    .select()
    .from(schema.branches)
    .where(eq(schema.branches.projectId, projectId))
    .all() as BranchRow[];
}

export function getBranch(branchId: string) {
  const branch = db.select().from(schema.branches).where(eq(schema.branches.id, branchId)).get();
  invariant(branch, "未找到分支。");
  return branch as BranchRow;
}

export async function deleteBranch(branchId: string) {
  const branch = getBranch(branchId);
  const project = getProject(branch.projectId);
  invariant(
    project.defaultBranchId !== branch.id,
    "无法删除：这是项目的默认分支。请先切换默认分支。",
  );
  const workspace = getWorkspaceForBranchId(branch.id);
  if (workspace) {
    await fs.promises.rm(workspace.worktreePath, { recursive: true, force: true });
    db.delete(schema.workspaces).where(eq(schema.workspaces.id, workspace.id)).run();
  }
  db.delete(schema.branches).where(eq(schema.branches.id, branch.id)).run();
  db.update(schema.projects)
    .set({ updatedAt: now() })
    .where(eq(schema.projects.id, project.id))
    .run();
  await writeProjectMeta(project.id);
}
