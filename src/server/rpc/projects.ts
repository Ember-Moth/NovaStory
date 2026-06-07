import { mutation, query } from "@codehz/rpc";
import { type InferInsertModel, type InferSelectModel, eq } from "drizzle-orm";

import { db, schema } from "@/db";
import { createDefaultWorkspaceWithExecutor } from "@/domain";

export const list = query<void, InferSelectModel<(typeof schema)["projects"]>[]>((_, ctx) => {
  const projects = db.query.projects.findMany().sync();
  ctx.watch("projects.list");
  return projects;
});

export const create = mutation<
  Pick<InferInsertModel<(typeof schema)["projects"]>, "id" | "name" | "description">,
  { workspaceId: string }
>((input, ctx) => {
  const workspace = db.transaction((tx) => {
    tx.insert(schema.projects).values(input).run();
    return createDefaultWorkspaceWithExecutor(tx, input.id);
  });
  ctx.invalidate("projects.list", `projects:${input.id}`);
  return { workspaceId: workspace.id };
});

export const update = mutation<
  Pick<InferInsertModel<(typeof schema)["projects"]>, "id" | "name" | "description">,
  void
>((input, ctx) => {
  db.update(schema.projects)
    .set({
      name: input.name,
      description: input.description ?? null,
      updatedAt: Date.now(),
    })
    .where(eq(schema.projects.id, input.id))
    .run();
  ctx.invalidate("projects.list", `projects:${input.id}`);
});

export const deleteMutation = mutation<{ id: string }, void>(({ id }, ctx) => {
  db.delete(schema.projects).where(eq(schema.projects.id, id)).run();
  ctx.invalidate("projects.list", `projects:${id}`);
});
