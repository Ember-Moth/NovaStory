import { expect, test } from "bun:test";

import { setupMockDatabase } from "@/test/mock-db";

setupMockDatabase();

const { db, schema } = await import("@/db");
const service = await import("@/modules/workspace/domain");
const { rpcTags } = await import("@/rpc/tags");
const branchHandlers = await import("./branches");
const commitHandlers = await import("./commits");
const requestCtx = { req: new Request("http://localhost/api/rpc") } as unknown as Parameters<
  typeof branchHandlers.list.handler
>[1];

function seedProject(projectId: string) {
  db.insert(schema.projects)
    .values({ id: projectId, name: `Project ${projectId}`, description: null })
    .run();
  return service.createDefaultWorkspace(projectId);
}

test("branch list watches the project branches tag and includes the default branch", async () => {
  const workspace = seedProject("rpc_branch_list");
  const result = await branchHandlers.list.handler({ projectId: "rpc_branch_list" }, requestCtx);

  expect(result.watch).toEqual([rpcTags.branchesByProject("rpc_branch_list")]);
  expect(result.data.map((branch) => branch.id)).toContain(workspace.branchId);
});

test("creating a branch with workspace invalidates branches and workspaces", async () => {
  const workspace = seedProject("rpc_branch_create");
  service.createContentNode({
    workspaceId: workspace.id,
    parentId: null,
    title: "Base",
  });
  const commit = await service.createCommit({ branchId: workspace.branchId, message: "base" });

  const result = await branchHandlers.createWithWorkspace.handler(
    { projectId: "rpc_branch_create", name: "feature", fromCommitId: commit.id },
    requestCtx,
  );

  expect(result.invalidate).toEqual([
    rpcTags.branchesByProject("rpc_branch_create"),
    rpcTags.workspacesByProject("rpc_branch_create"),
    rpcTags.project("rpc_branch_create"),
    rpcTags.projectsList(),
  ]);
  expect(result.data.branchId).not.toBe(workspace.branchId);
});

test("deleting a branch invalidates branch, workspace, and project tags", async () => {
  seedProject("rpc_branch_delete");
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
    rpcTags.branch(featureWorkspace.branchId),
    rpcTags.workspacesByProject("rpc_branch_delete"),
    rpcTags.project("rpc_branch_delete"),
    rpcTags.projectsList(),
  ]);
  expect(() => service.getWorkspace(featureWorkspace.id)).toThrow("未找到工作区。");
});

test("commit create invalidates history and branch tags", async () => {
  const workspace = seedProject("rpc_commit_create");
  service.createContentNode({
    workspaceId: workspace.id,
    parentId: null,
    title: "One",
  });

  const result = await commitHandlers.create.handler(
    { branchId: workspace.branchId, message: "one" },
    requestCtx,
  );

  expect(result.invalidate).toEqual([
    rpcTags.commitHistory(workspace.branchId),
    rpcTags.branch(workspace.branchId),
    rpcTags.branchesByProject("rpc_commit_create"),
    rpcTags.project("rpc_commit_create"),
    rpcTags.projectsList(),
  ]);
  expect(result.data.id).toMatch(/^[0-9a-f]{40}$/);
});

test("commit checkout invalidates the workspace content views", async () => {
  const workspace = seedProject("rpc_commit_checkout");
  service.createContentNode({
    workspaceId: workspace.id,
    parentId: null,
    title: "One",
  });
  const commit = await await service.createCommit({ branchId: workspace.branchId, message: "one" });

  const result = await commitHandlers.checkout.handler(
    { workspaceId: workspace.id, commitId: commit.id },
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
  const workspace = seedProject("rpc_working_tree_status");

  const result = await commitHandlers.workingTreeStatus.handler(
    { branchId: workspace.branchId },
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
  const workspace = seedProject("rpc_commit_history");
  service.createContentNode({
    workspaceId: workspace.id,
    parentId: null,
    title: "One",
  });
  const c1 = await await service.createCommit({ branchId: workspace.branchId, message: "one" });
  service.createContentNode({
    workspaceId: workspace.id,
    parentId: null,
    title: "Two",
  });
  const c2 = await await service.createCommit({ branchId: workspace.branchId, message: "two" });

  const result = await commitHandlers.history.handler({ branchId: workspace.branchId }, requestCtx);

  expect(result.watch).toEqual([rpcTags.commitHistory(workspace.branchId)]);
  expect(result.data.map((commit) => commit.id)).toEqual([c2.id, c1.id]);
});
