import { mutation, query } from "@codehz/rpc";
import { type InferInsertModel, type InferSelectModel, eq } from "drizzle-orm";

import { db, schema } from "@/db";
import {
  ORIGIN_TIMELINE_POINT_ID,
  composeWritingContext,
  createContentNode,
  createDefaultWorkspaceWithExecutor,
  createTimelinePoint,
  deleteAuxNodeAt,
  deleteTimelinePoint,
  exportContentSubtree,
  getDefaultWorkspace,
  linkAt,
  listAuxDirAt,
  listTimelinePoints,
  listWorkspaces,
  mkdirAt,
  moveAuxNodeAt,
  moveContentNode,
  moveTimelinePoint,
  readAuxByIdAt,
  readAuxByPathAt,
  updateContentNode,
  writeFileAt,
} from "@/workspace/service";

export const healthcheck = query<void, "ok">(() => "ok");

export const projects = {
  list: query<void, InferSelectModel<(typeof schema)["projects"]>[]>((_, ctx) => {
    const projects = db.query.projects.findMany().sync();
    ctx.watch("projects.list");
    return projects;
  }),
  create: mutation<
    Pick<InferInsertModel<(typeof schema)["projects"]>, "id" | "name" | "description">,
    { workspaceId: string }
  >((input, ctx) => {
    const workspace = db.transaction((tx) => {
      tx.insert(schema.projects).values(input).run();
      return createDefaultWorkspaceWithExecutor(tx, input.id);
    });
    ctx.invalidate("projects.list", `projects:${input.id}`);
    return { workspaceId: workspace.id };
  }),
  update: mutation<
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
  }),
  delete: mutation<{ id: string }, void>(({ id }, ctx) => {
    db.delete(schema.projects).where(eq(schema.projects.id, id)).run();
    ctx.invalidate("projects.list", `projects:${id}`);
  }),
};

export const workspaces = {
  list: query<{ projectId: string }, ReturnType<typeof listWorkspaces>>(({ projectId }, ctx) => {
    const result = listWorkspaces(projectId);
    ctx.watch(`workspaces:${projectId}`);
    return result;
  }),
  default: query<{ projectId: string }, ReturnType<typeof getDefaultWorkspace>>(
    ({ projectId }, ctx) => {
      const result = getDefaultWorkspace(projectId);
      ctx.watch(`workspaces:${projectId}`);
      return result;
    },
  ),
};

export const timeline = {
  list: query<{ workspaceId: string }, ReturnType<typeof listTimelinePoints>>(
    ({ workspaceId }, ctx) => {
      const result = listTimelinePoints(workspaceId);
      ctx.watch(`timeline:${workspaceId}`);
      return result;
    },
  ),
  create: mutation<
    {
      workspaceId: string;
      afterPointId?: string | typeof ORIGIN_TIMELINE_POINT_ID;
      key: string;
      label: string;
      description?: string | null;
    },
    ReturnType<typeof createTimelinePoint>
  >((input, ctx) => {
    const point = createTimelinePoint(input);
    ctx.invalidate(`timeline:${input.workspaceId}`);
    return point;
  }),
  move: mutation<
    {
      workspaceId: string;
      pointId: string;
      afterPointId?: string | typeof ORIGIN_TIMELINE_POINT_ID;
    },
    ReturnType<typeof moveTimelinePoint>
  >((input, ctx) => {
    const point = moveTimelinePoint(input);
    ctx.invalidate(`timeline:${input.workspaceId}`);
    return point;
  }),
  delete: mutation<{ workspaceId: string; pointId: string }, void>(
    ({ workspaceId, pointId }, ctx) => {
      deleteTimelinePoint(workspaceId, pointId);
      ctx.invalidate(`timeline:${workspaceId}`);
    },
  ),
};

export const content = {
  create: mutation<Parameters<typeof createContentNode>[0], ReturnType<typeof createContentNode>>(
    (input, ctx) => {
      const node = createContentNode(input);
      ctx.invalidate(`content:${input.workspaceId}`);
      return node;
    },
  ),
  move: mutation<Parameters<typeof moveContentNode>[0], ReturnType<typeof moveContentNode>>(
    (input, ctx) => {
      const node = moveContentNode(input);
      ctx.invalidate(`content:${input.workspaceId}`);
      return node;
    },
  ),
  update: mutation<Parameters<typeof updateContentNode>[0], ReturnType<typeof updateContentNode>>(
    (input, ctx) => {
      const node = updateContentNode(input);
      ctx.invalidate(`content:${input.workspaceId}`);
      return node;
    },
  ),
  exportSubtree: query<
    { workspaceId: string; rootNodeId?: string },
    ReturnType<typeof exportContentSubtree>
  >(({ workspaceId, rootNodeId }, ctx) => {
    const tree = exportContentSubtree(workspaceId, rootNodeId);
    ctx.watch(`content:${workspaceId}`);
    return tree;
  }),
  composeWritingContext: query<
    { workspaceId: string; contentNodeId: string },
    ReturnType<typeof composeWritingContext>
  >(({ workspaceId, contentNodeId }, ctx) => {
    const context = composeWritingContext(workspaceId, contentNodeId);
    ctx.watch(`content:${workspaceId}`);
    ctx.watch(`aux:${workspaceId}`);
    ctx.watch(`timeline:${workspaceId}`);
    return context;
  }),
};

export const aux = {
  mkdir: mutation<Parameters<typeof mkdirAt>[0], ReturnType<typeof mkdirAt>>((input, ctx) => {
    const node = mkdirAt(input);
    ctx.invalidate(`aux:${input.workspaceId}`);
    return node;
  }),
  writeFile: mutation<Parameters<typeof writeFileAt>[0], ReturnType<typeof writeFileAt>>(
    (input, ctx) => {
      const node = writeFileAt(input);
      ctx.invalidate(`aux:${input.workspaceId}`);
      return node;
    },
  ),
  link: mutation<Parameters<typeof linkAt>[0], ReturnType<typeof linkAt>>((input, ctx) => {
    const node = linkAt(input);
    ctx.invalidate(`aux:${input.workspaceId}`);
    return node;
  }),
  move: mutation<Parameters<typeof moveAuxNodeAt>[0], ReturnType<typeof moveAuxNodeAt>>(
    (input, ctx) => {
      const node = moveAuxNodeAt(input);
      ctx.invalidate(`aux:${input.workspaceId}`);
      return node;
    },
  ),
  delete: mutation<Parameters<typeof deleteAuxNodeAt>[0], void>((input, ctx) => {
    deleteAuxNodeAt(input);
    ctx.invalidate(`aux:${input.workspaceId}`);
  }),
  readById: query<
    { workspaceId: string; pointId?: string | typeof ORIGIN_TIMELINE_POINT_ID; nodeId: string },
    ReturnType<typeof readAuxByIdAt>
  >(({ workspaceId, pointId, nodeId }, ctx) => {
    const result = readAuxByIdAt(workspaceId, pointId, nodeId);
    ctx.watch(`aux:${workspaceId}`);
    ctx.watch(`timeline:${workspaceId}`);
    return result;
  }),
  readByPath: query<
    { workspaceId: string; pointId?: string | typeof ORIGIN_TIMELINE_POINT_ID; path: string },
    ReturnType<typeof readAuxByPathAt>
  >(({ workspaceId, pointId, path }, ctx) => {
    const result = readAuxByPathAt(workspaceId, pointId, path);
    ctx.watch(`aux:${workspaceId}`);
    ctx.watch(`timeline:${workspaceId}`);
    return result;
  }),
  listDir: query<
    {
      workspaceId: string;
      pointId?: string | typeof ORIGIN_TIMELINE_POINT_ID;
      dirId?: string;
      path?: string;
    },
    ReturnType<typeof listAuxDirAt>
  >(({ workspaceId, pointId, dirId, path }, ctx) => {
    const result = listAuxDirAt(workspaceId, pointId, { dirId, path });
    ctx.watch(`aux:${workspaceId}`);
    ctx.watch(`timeline:${workspaceId}`);
    return result;
  }),
};
