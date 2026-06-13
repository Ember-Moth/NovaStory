import { mutation, query } from "@codehz/rpc/core";
import { and, eq, type InferInsertModel, type InferSelectModel } from "drizzle-orm";

import { db, schema } from "@/db";
import { createDefaultWorkspace } from "@/modules/workspace/domain";
import { invariant } from "@/shared/lib/domain";
import { rpcTags, type RpcTagList } from "@/rpc/tags";

type ProjectMutationInput = Pick<
  InferInsertModel<(typeof schema)["projects"]>,
  "id" | "name" | "description"
>;
type ProjectRow = InferSelectModel<(typeof schema)["projects"]>;

export const list = query<void, ProjectRow[], RpcTagList>({
  watch: () => [rpcTags.projectsList()],
  handler: () => db.query.projects.findMany().sync(),
});

export const get = query<{ projectId: string }, ProjectRow, RpcTagList>({
  watch: ({ projectId }) => [rpcTags.project(projectId)],
  handler: ({ projectId }) => {
    const project = db.query.projects
      .findFirst({
        where: eq(schema.projects.id, projectId),
      })
      .sync();
    invariant(project, "未找到项目。");
    return project;
  },
});

export const create = mutation<ProjectMutationInput, { workspaceId: string }, RpcTagList>({
  invalidate: (input) => [rpcTags.projectsList(), rpcTags.project(input.id)],
  handler: (input) => {
    db.insert(schema.projects).values(input).run();
    const workspace = createDefaultWorkspace(input.id);
    return { workspaceId: workspace.id };
  },
});

export const update = mutation<ProjectMutationInput, void, RpcTagList>({
  invalidate: (input) => [rpcTags.projectsList(), rpcTags.project(input.id)],
  handler: (input) => {
    db.update(schema.projects)
      .set({
        name: input.name,
        description: input.description ?? null,
        updatedAt: Date.now(),
      })
      .where(eq(schema.projects.id, input.id))
      .run();
  },
});

export const setDefaultBranch = mutation<{ projectId: string; branchId: string }, void, RpcTagList>(
  {
    invalidate: ({ projectId }) => [rpcTags.projectsList(), rpcTags.project(projectId)],
    handler: ({ projectId, branchId }) => {
      const project = db.query.projects
        .findFirst({
          where: eq(schema.projects.id, projectId),
        })
        .sync();
      invariant(project, "未找到项目。");

      const branch = db.query.branches
        .findFirst({
          where: and(eq(schema.branches.id, branchId), eq(schema.branches.projectId, projectId)),
        })
        .sync();
      invariant(branch, "无法设置默认分支：该分支不属于当前项目。");

      db.update(schema.projects)
        .set({
          defaultBranchId: branch.id,
          updatedAt: Date.now(),
        })
        .where(eq(schema.projects.id, projectId))
        .run();
    },
  },
);

export const deleteMutation = mutation<{ id: string }, void, RpcTagList>({
  invalidate: ({ id }) => [rpcTags.projectsList(), rpcTags.project(id)],
  handler: ({ id }) => {
    db.delete(schema.projects).where(eq(schema.projects.id, id)).run();
  },
});
