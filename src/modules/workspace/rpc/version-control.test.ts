import { expect, test } from "bun:test";

import { seedProjectRecord } from "@/test/project";
import * as service from "@/modules/workspace/domain";
import { rpcTags } from "@/rpc/tags";
import * as branchHandlers from "./branches";
import * as commitHandlers from "./commits";
const requestCtx = { req: new Request("http://localhost/api/rpc") } as unknown as Parameters<
  typeof branchHandlers.list.handler
>[1];

async function seedProject(projectId: string) {
  await seedProjectRecord(projectId);
  if (!(await service.getDefaultWorkspace(projectId))) {
    await service.createDefaultWorkspace(projectId);
  }
  return (await service.getDefaultWorkspace(projectId))!;
}

test("branch list watches the project branches tag and includes the default branch", async () => {
  const workspace = await seedProject("rpc_branch_list");
  const result = await branchHandlers.list.handler({ projectId: "rpc_branch_list" }, requestCtx);

  expect(result.watch).toEqual([rpcTags.branchesByProject("rpc_branch_list")]);
  expect(result.data.map((branch) => branch.id)).toContain(workspace.branchId);
  expect(result.data[0]).not.toHaveProperty("headCommitId");
  expect(result.data[0]).not.toHaveProperty("ref");
});

test("branch heads watches the project branch-heads tag and resolves current heads", async () => {
  const workspace = await seedProject("rpc_branch_heads");
  const result = await branchHandlers.heads.handler({ projectId: "rpc_branch_heads" }, requestCtx);

  expect(result.watch).toEqual([rpcTags.branchHeadsByProject("rpc_branch_heads")]);
  expect(result.data).toContainEqual({
    branchId: workspace.branchId,
    headCommitId: null,
  });
});

test("creating a branch with workspace invalidates branches and workspaces", async () => {
  const workspace = await seedProject("rpc_branch_create");
  await service.createContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    parentId: null,
    title: "Base",
  });
  const commit = await service.createCommit({
    projectId: workspace.projectId,
    branchId: workspace.branchId,
    message: "base",
  });

  const result = await branchHandlers.createWithWorkspace.handler(
    { projectId: "rpc_branch_create", name: "feature", fromCommitId: commit.id },
    requestCtx,
  );

  expect(result.invalidate).toEqual([
    rpcTags.branchesByProject("rpc_branch_create"),
    rpcTags.branchHeadsByProject("rpc_branch_create"),
    rpcTags.workspacesByProject("rpc_branch_create"),
    rpcTags.project("rpc_branch_create"),
    rpcTags.projectsList(),
  ]);
  expect(result.data.branchId).not.toBe(workspace.branchId);
});

test("deleting a branch invalidates branch, workspace, and project tags", async () => {
  await seedProject("rpc_branch_delete");
  const featureWorkspace = await service.createBranchWorkspace({
    projectId: "rpc_branch_delete",
    name: "feature",
  });

  const result = await branchHandlers.deleteMutation.handler(
    {
      projectId: "rpc_branch_delete",
      branchId: featureWorkspace.branchId,
    },
    requestCtx,
  );

  expect(result.invalidate).toEqual([
    rpcTags.branchesByProject("rpc_branch_delete"),
    rpcTags.branchHeadsByProject("rpc_branch_delete"),
    rpcTags.branch(featureWorkspace.branchId),
    rpcTags.workspacesByProject("rpc_branch_delete"),
    rpcTags.project("rpc_branch_delete"),
    rpcTags.projectsList(),
  ]);
  await expect(
    service.getWorkspace(featureWorkspace.projectId, featureWorkspace.id),
  ).rejects.toThrow("未找到工作区。");
});

test("commit create invalidates history and branch tags", async () => {
  const workspace = await seedProject("rpc_commit_create");
  await service.createContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    parentId: null,
    title: "One",
  });

  const result = await commitHandlers.create.handler(
    { projectId: workspace.projectId, branchId: workspace.branchId, message: "one" },
    requestCtx,
  );

  expect(result.invalidate).toEqual([
    rpcTags.commitHistory(workspace.branchId),
    rpcTags.branch(workspace.branchId),
    rpcTags.branchHeadsByProject("rpc_commit_create"),
    rpcTags.branchesByProject("rpc_commit_create"),
    rpcTags.project("rpc_commit_create"),
    rpcTags.projectsList(),
  ]);
  expect(result.data.id).toMatch(/^[0-9a-f]{40}$/);
});

test("commit checkout invalidates the workspace content views", async () => {
  const workspace = await seedProject("rpc_commit_checkout");
  await service.createContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    parentId: null,
    title: "One",
  });
  const commit = await service.createCommit({
    projectId: workspace.projectId,
    branchId: workspace.branchId,
    message: "one",
  });

  const result = await commitHandlers.checkout.handler(
    { projectId: workspace.projectId, workspaceId: workspace.id, commitId: commit.id },
    requestCtx,
  );

  expect(result.invalidate).toEqual([
    rpcTags.workspace(workspace.id),
    rpcTags.contentTree(workspace.id),
    rpcTags.timelineList(workspace.id),
    rpcTags.auxWorkspace(workspace.id),
  ]);
});

test("working tree status watches branch, history and workspace tags", async () => {
  const workspace = await seedProject("rpc_working_tree_status");

  const result = await commitHandlers.workingTreeStatus.handler(
    { projectId: workspace.projectId, branchId: workspace.branchId },
    requestCtx,
  );

  expect(result.watch).toEqual([
    rpcTags.branch(workspace.branchId),
    rpcTags.commitHistory(workspace.branchId),
    rpcTags.contentTree(workspace.id),
    rpcTags.timelineList(workspace.id),
    rpcTags.auxWorkspace(workspace.id),
  ]);
  expect(result.data.hasChanges).toBe(false);
  expect(result.data.headCommitId).toBeNull();
});

test("commit history returns the mainline newest first", async () => {
  const workspace = await seedProject("rpc_commit_history");
  await service.createContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    parentId: null,
    title: "One",
  });
  const c1 = await service.createCommit({
    projectId: workspace.projectId,
    branchId: workspace.branchId,
    message: "one",
  });
  await service.createContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    parentId: null,
    title: "Two",
  });
  const c2 = await service.createCommit({
    projectId: workspace.projectId,
    branchId: workspace.branchId,
    message: "two",
  });

  const result = await commitHandlers.history.handler(
    { projectId: workspace.projectId, branchId: workspace.branchId },
    requestCtx,
  );

  expect(result.watch).toEqual([rpcTags.commitHistory(workspace.branchId)]);
  expect(result.data.map((commit) => commit.id)).toEqual([c2.id, c1.id]);
});
