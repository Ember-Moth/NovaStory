import { mutation, query } from "@codehz/rpc/core";
import { eq, type InferInsertModel, type InferSelectModel } from "drizzle-orm";

import { db, schema } from "@/db";
import { createDefaultWorkspaceWithExecutor } from "@/domain";
import { rpcTags, type RpcTagList } from "@/server/rpc/tags";

type ProjectMutationInput = Pick<
  InferInsertModel<(typeof schema)["projects"]>,
  "id" | "name" | "description"
>;
type ProjectRow = InferSelectModel<(typeof schema)["projects"]>;

export const list = query<void, ProjectRow[], RpcTagList>({
  watch: () => [rpcTags.projectsList()],
  handler: () => db.query.projects.findMany().sync(),
});

export const create = mutation<ProjectMutationInput, { workspaceId: string }, RpcTagList>({
  invalidate: (input) => [rpcTags.projectsList(), rpcTags.project(input.id)],
  handler: (input) => {
    const workspace = db.transaction((tx) => {
      tx.insert(schema.projects).values(input).run();
      return createDefaultWorkspaceWithExecutor(tx, input.id);
    });
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

export const deleteMutation = mutation<{ id: string }, void, RpcTagList>({
  invalidate: ({ id }) => [rpcTags.projectsList(), rpcTags.project(id)],
  handler: ({ id }) => {
    db.delete(schema.projects).where(eq(schema.projects.id, id)).run();
  },
});
