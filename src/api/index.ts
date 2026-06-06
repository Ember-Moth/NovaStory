import { mutation, query } from "@codehz/rpc";
import { type InferInsertModel, type InferSelectModel, eq } from "drizzle-orm";

import { db, schema } from "@/db";

export const healthcheck = query<void, "ok">(() => "ok");

export const projects = {
  list: query<void, InferSelectModel<(typeof schema)["projects"]>[]>((_, ctx) => {
    const projects = db.query.projects.findMany().sync();
    ctx.watch("projects.list");
    return projects;
  }),
  create: mutation<
    Pick<InferInsertModel<(typeof schema)["projects"]>, "id" | "name" | "description">,
    void
  >((input, ctx) => {
    db.insert(schema.projects).values(input).run();
    ctx.invalidate("projects.list", `projects:${input.id}`);
  }),
  update: mutation<
    Pick<InferInsertModel<(typeof schema)["projects"]>, "id" | "name" | "description">,
    void
  >((input, ctx) => {
    db.update(schema.projects).set(input).run();
    ctx.invalidate("projects.list", `projects:${input.id}`);
  }),
  delete: mutation<{ id: string }, void>(({ id }, ctx) => {
    db.delete(schema.projects).where(eq(schema.projects.id, id)).run();
    ctx.invalidate("projects.list", `projects:${id}`);
  }),
};
