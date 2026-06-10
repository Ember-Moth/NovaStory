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
    parentId: workspace.contentRootId!,
    kind: "chapter",
    title: "Base",
  });
  const commit = service.createCommit({ branchId: workspace.branchId, message: "base" });

  const result = await branchHandlers.createWithWorkspace.handler(
    { projectId: "rpc_branch_create", name: "feature", fromCommitId: commit.id },
    requestCtx,
  );

  expect(result.invalidate).toEqual([
    rpcTags.branchesByProject("rpc_branch_create"),
    rpcTags.workspacesByProject("rpc_branch_create"),
  ]);
  expect(result.data.branchId).not.toBe(workspace.branchId);
});

test("commit create invalidates history and branch tags", async () => {
  const workspace = seedProject("rpc_commit_create");
  service.createContentNode({
    workspaceId: workspace.id,
    parentId: workspace.contentRootId!,
    kind: "chapter",
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
  ]);
  expect(result.data.id).toMatch(/^commit_/);
});

test("commit checkout invalidates the workspace content views", async () => {
  const workspace = seedProject("rpc_commit_checkout");
  service.createContentNode({
    workspaceId: workspace.id,
    parentId: workspace.contentRootId!,
    kind: "chapter",
    title: "One",
  });
  const commit = service.createCommit({ branchId: workspace.branchId, message: "one" });

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

test("commit history returns the mainline newest first", async () => {
  const workspace = seedProject("rpc_commit_history");
  service.createContentNode({
    workspaceId: workspace.id,
    parentId: workspace.contentRootId!,
    kind: "chapter",
    title: "One",
  });
  const c1 = service.createCommit({ branchId: workspace.branchId, message: "one" });
  service.createContentNode({
    workspaceId: workspace.id,
    parentId: workspace.contentRootId!,
    kind: "chapter",
    title: "Two",
  });
  const c2 = service.createCommit({ branchId: workspace.branchId, message: "two" });

  const result = await commitHandlers.history.handler({ branchId: workspace.branchId }, requestCtx);

  expect(result.watch).toEqual([rpcTags.commitHistory(workspace.branchId)]);
  expect(result.data.map((commit) => commit.id)).toEqual([c2.id, c1.id]);
});
