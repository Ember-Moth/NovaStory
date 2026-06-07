import { randomUUID } from "node:crypto";

import {
  type InferInsertModel,
  type InferSelectModel,
  and,
  eq,
  inArray,
  isNull,
  or,
} from "drizzle-orm";

import { type DatabaseExecutor, db, schema } from "@/db";

export const ORIGIN_TIMELINE_POINT_ID = "origin" as const;

type WorkspaceRow = InferSelectModel<typeof schema.workspaces>;
type TimelinePointRow = InferSelectModel<typeof schema.timelinePoints>;
type ContentNodeRow = InferSelectModel<typeof schema.contentNodes>;
type AuxNodeRow = InferSelectModel<typeof schema.auxNodes>;
type AuxNodeLayerRow = InferSelectModel<typeof schema.auxNodeLayers>;

type TimelinePointRef = string | null | undefined | typeof ORIGIN_TIMELINE_POINT_ID;
type AuxNodeType = AuxNodeRow["nodeType"];

export interface TimelinePointView {
  id: string | typeof ORIGIN_TIMELINE_POINT_ID;
  key: string;
  label: string;
  description: string | null;
  prevPointId: string | typeof ORIGIN_TIMELINE_POINT_ID | null;
  isImplicitOrigin: boolean;
}

export interface ExportedContentNode {
  id: string;
  anchorTimelinePointId: string | typeof ORIGIN_TIMELINE_POINT_ID;
  kind: string | null;
  title: string | null;
  body: string | null;
  children: ExportedContentNode[];
}

export interface ExportedContentSubtree {
  rootNodeId: string;
  isWorkspaceRoot: boolean;
  nodes: ExportedContentNode[];
}

export interface ResolvedAuxNode {
  id: string;
  nodeType: AuxNodeType;
  parentAuxNodeId: string | null;
  name: string | null;
  content: string | null;
  symlinkTargetAuxNodeId: string | null;
  timelinePointId: string | typeof ORIGIN_TIMELINE_POINT_ID;
  path: string;
}

export interface WritingContext {
  contentNode: ExportedContentNode;
  timelinePointId: string | typeof ORIGIN_TIMELINE_POINT_ID;
  auxSnapshot: ResolvedAuxNode[];
}

interface ResolvedAuxSnapshotNode extends ResolvedAuxNode {
  reachable: boolean;
}

function createId(prefix: string) {
  return `${prefix}_${randomUUID()}`;
}

function normalizeTimelinePointId(pointId: TimelinePointRef) {
  return pointId == null || pointId === ORIGIN_TIMELINE_POINT_ID ? null : pointId;
}

function pointIdOrOrigin(pointId: string | null) {
  return pointId ?? ORIGIN_TIMELINE_POINT_ID;
}

function now() {
  return Date.now();
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function originTimelinePoint(): TimelinePointView {
  return {
    id: ORIGIN_TIMELINE_POINT_ID,
    key: ORIGIN_TIMELINE_POINT_ID,
    label: "Origin",
    description: "Implicit initial story state",
    prevPointId: null,
    isImplicitOrigin: true,
  };
}

function pointCondition(pointId: string | null) {
  return pointId == null
    ? isNull(schema.auxNodeLayers.timelinePointId)
    : eq(schema.auxNodeLayers.timelinePointId, pointId);
}

function getWorkspaceOrThrow(executor: DatabaseExecutor, workspaceId: string) {
  const workspace = executor
    .select()
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId))
    .get();
  invariant(workspace, `Workspace not found: ${workspaceId}`);
  return workspace;
}

function getProjectOrThrow(executor: DatabaseExecutor, projectId: string) {
  const project = executor
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .get();
  invariant(project, `Project not found: ${projectId}`);
  return project;
}

function getTimelinePointOrThrow(executor: DatabaseExecutor, workspaceId: string, pointId: string) {
  const point = executor
    .select()
    .from(schema.timelinePoints)
    .where(
      and(
        eq(schema.timelinePoints.id, pointId),
        eq(schema.timelinePoints.workspaceId, workspaceId),
      ),
    )
    .get();
  invariant(point, `Timeline point not found: ${pointId}`);
  return point;
}

function getContentNodeOrThrow(executor: DatabaseExecutor, workspaceId: string, nodeId: string) {
  const node = executor
    .select()
    .from(schema.contentNodes)
    .where(
      and(eq(schema.contentNodes.id, nodeId), eq(schema.contentNodes.workspaceId, workspaceId)),
    )
    .get();
  invariant(node, `Content node not found: ${nodeId}`);
  return node;
}

function getAuxNodeOrThrow(executor: DatabaseExecutor, workspaceId: string, nodeId: string) {
  const node = executor
    .select()
    .from(schema.auxNodes)
    .where(and(eq(schema.auxNodes.id, nodeId), eq(schema.auxNodes.workspaceId, workspaceId)))
    .get();
  invariant(node, `Aux node not found: ${nodeId}`);
  return node;
}

function listTimelineRows(executor: DatabaseExecutor, workspaceId: string) {
  return executor
    .select()
    .from(schema.timelinePoints)
    .where(eq(schema.timelinePoints.workspaceId, workspaceId))
    .all();
}

function orderTimelineRows(rows: TimelinePointRow[]) {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const successorByPrev = new Map<string | null, TimelinePointRow>();

  for (const row of rows) {
    if (successorByPrev.has(row.prevPointId)) {
      throw new Error("Timeline chain is invalid: multiple successors share the same prev point");
    }
    successorByPrev.set(row.prevPointId, row);
  }

  const ordered: TimelinePointRow[] = [];
  let current = successorByPrev.get(null);
  while (current) {
    ordered.push(current);
    successorByPrev.delete(current.prevPointId);
    current = successorByPrev.get(current.id);
  }

  invariant(
    ordered.length === rows.length,
    "Timeline chain is invalid: cycle or dangling predecessor detected",
  );
  for (const row of ordered) {
    invariant(
      !row.prevPointId || byId.has(row.prevPointId),
      `Timeline point ${row.id} has a missing predecessor`,
    );
  }

  return ordered;
}

function resolveTimelineChainIds(
  executor: DatabaseExecutor,
  workspaceId: string,
  pointId: string | null,
) {
  const ordered = orderTimelineRows(listTimelineRows(executor, workspaceId));
  if (pointId == null) {
    return [] as string[];
  }

  const pointIds = new Set(ordered.map((row) => row.id));
  invariant(pointIds.has(pointId), `Timeline point not found: ${pointId}`);

  const byId = new Map(ordered.map((row) => [row.id, row]));
  const chain: string[] = [];
  let currentId: string | null = pointId;

  while (currentId) {
    const row = byId.get(currentId);
    invariant(row, `Timeline point not found in chain: ${currentId}`);
    chain.push(row.id);
    currentId = row.prevPointId;
  }

  return chain;
}

function getTimelineSuccessor(
  executor: DatabaseExecutor,
  workspaceId: string,
  pointId: string | null,
) {
  const condition =
    pointId == null
      ? and(
          eq(schema.timelinePoints.workspaceId, workspaceId),
          isNull(schema.timelinePoints.prevPointId),
        )
      : and(
          eq(schema.timelinePoints.workspaceId, workspaceId),
          eq(schema.timelinePoints.prevPointId, pointId),
        );
  return executor.select().from(schema.timelinePoints).where(condition).get();
}

function listContentChildren(executor: DatabaseExecutor, workspaceId: string, parentId: string) {
  return executor
    .select()
    .from(schema.contentNodes)
    .where(
      and(
        eq(schema.contentNodes.workspaceId, workspaceId),
        eq(schema.contentNodes.parentId, parentId),
      ),
    )
    .all();
}

function orderContentChildren(children: ContentNodeRow[]) {
  const nextIds = new Set(
    children.map((child) => child.nextSiblingId).filter((id): id is string => id != null),
  );
  const heads = children.filter((child) => !nextIds.has(child.id));
  invariant(heads.length <= 1, "Content chain is invalid: multiple child heads detected");
  if (children.length === 0) {
    return [] as ContentNodeRow[];
  }

  const head = heads[0];
  invariant(head, "Content chain is invalid: missing child head");

  const byId = new Map(children.map((child) => [child.id, child]));
  const ordered: ContentNodeRow[] = [];
  let current: ContentNodeRow | undefined = head;
  while (current) {
    ordered.push(current);
    current = current.nextSiblingId ? byId.get(current.nextSiblingId) : undefined;
  }

  invariant(
    ordered.length === children.length,
    "Content chain is invalid: cycle or dangling sibling detected",
  );
  return ordered;
}

function getContentPrevSibling(executor: DatabaseExecutor, workspaceId: string, nodeId: string) {
  return executor
    .select()
    .from(schema.contentNodes)
    .where(
      and(
        eq(schema.contentNodes.workspaceId, workspaceId),
        eq(schema.contentNodes.nextSiblingId, nodeId),
      ),
    )
    .get();
}

function collectContentSubtreeIds(
  executor: DatabaseExecutor,
  workspaceId: string,
  rootNodeId: string,
) {
  const collected = new Set<string>();
  const queue = [rootNodeId];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    if (collected.has(currentId)) {
      continue;
    }
    collected.add(currentId);
    for (const child of listContentChildren(executor, workspaceId, currentId)) {
      queue.push(child.id);
    }
  }

  return collected;
}

function exportContentNode(
  executor: DatabaseExecutor,
  workspaceId: string,
  node: ContentNodeRow,
): ExportedContentNode {
  return {
    id: node.id,
    anchorTimelinePointId: pointIdOrOrigin(node.anchorTimelinePointId),
    kind: node.kind,
    title: node.title,
    body: node.body,
    children: orderContentChildren(listContentChildren(executor, workspaceId, node.id)).map(
      (child) => exportContentNode(executor, workspaceId, child),
    ),
  };
}

function getAuxLayerAtPoint(
  executor: DatabaseExecutor,
  workspaceId: string,
  auxNodeId: string,
  timelinePointId: string | null,
) {
  return executor
    .select()
    .from(schema.auxNodeLayers)
    .where(
      and(
        eq(schema.auxNodeLayers.workspaceId, workspaceId),
        eq(schema.auxNodeLayers.auxNodeId, auxNodeId),
        pointCondition(timelinePointId),
      ),
    )
    .get();
}

function putAuxLayer(
  executor: DatabaseExecutor,
  input: Omit<InferInsertModel<typeof schema.auxNodeLayers>, "id" | "createdAt" | "updatedAt">,
) {
  const existing = getAuxLayerAtPoint(
    executor,
    input.workspaceId,
    input.auxNodeId,
    input.timelinePointId ?? null,
  );
  const payload = {
    isDeleted: input.isDeleted,
    parentAuxNodeId: input.parentAuxNodeId ?? null,
    name: input.name ?? null,
    content: input.content ?? null,
    symlinkTargetAuxNodeId: input.symlinkTargetAuxNodeId ?? null,
    updatedAt: now(),
  };

  if (existing) {
    executor
      .update(schema.auxNodeLayers)
      .set(payload)
      .where(eq(schema.auxNodeLayers.id, existing.id))
      .run();
    return { ...existing, ...payload };
  }

  const row = {
    id: createId("aux_layer"),
    ...input,
    parentAuxNodeId: input.parentAuxNodeId ?? null,
    name: input.name ?? null,
    content: input.content ?? null,
    symlinkTargetAuxNodeId: input.symlinkTargetAuxNodeId ?? null,
  };
  executor.insert(schema.auxNodeLayers).values(row).run();
  return row;
}

function buildReachableAuxSnapshot(
  executor: DatabaseExecutor,
  workspace: WorkspaceRow,
  timelinePointId: string | null,
) {
  invariant(workspace.auxRootId, `Workspace ${workspace.id} has no aux root`);
  const chain = resolveTimelineChainIds(executor, workspace.id, timelinePointId);
  const auxNodes = executor
    .select()
    .from(schema.auxNodes)
    .where(eq(schema.auxNodes.workspaceId, workspace.id))
    .all();
  const relevantLayers = executor
    .select()
    .from(schema.auxNodeLayers)
    .where(
      and(
        eq(schema.auxNodeLayers.workspaceId, workspace.id),
        chain.length > 0
          ? or(
              isNull(schema.auxNodeLayers.timelinePointId),
              inArray(schema.auxNodeLayers.timelinePointId, chain),
            )
          : isNull(schema.auxNodeLayers.timelinePointId),
      ),
    )
    .all();

  const layersByAuxNodeId = new Map<string, AuxNodeLayerRow[]>();
  for (const layer of relevantLayers) {
    const layers = layersByAuxNodeId.get(layer.auxNodeId) ?? [];
    layers.push(layer);
    layersByAuxNodeId.set(layer.auxNodeId, layers);
  }

  const pointRank = new Map<string | null, number>();
  chain.forEach((id, index) => pointRank.set(id, index));
  pointRank.set(null, chain.length);

  const rawStates = new Map<string, Omit<ResolvedAuxSnapshotNode, "reachable" | "path">>();
  for (const auxNode of auxNodes) {
    if (auxNode.id === workspace.auxRootId) {
      rawStates.set(auxNode.id, {
        id: auxNode.id,
        nodeType: auxNode.nodeType,
        parentAuxNodeId: null,
        name: null,
        content: null,
        symlinkTargetAuxNodeId: null,
        timelinePointId: ORIGIN_TIMELINE_POINT_ID,
      });
      continue;
    }

    const layers = layersByAuxNodeId.get(auxNode.id) ?? [];
    layers.sort(
      (left, right) =>
        (pointRank.get(left.timelinePointId) ?? Number.MAX_SAFE_INTEGER) -
        (pointRank.get(right.timelinePointId) ?? Number.MAX_SAFE_INTEGER),
    );
    const layer = layers[0];
    if (!layer || layer.isDeleted) {
      continue;
    }

    rawStates.set(auxNode.id, {
      id: auxNode.id,
      nodeType: auxNode.nodeType,
      parentAuxNodeId: layer.parentAuxNodeId,
      name: layer.name,
      content: layer.content,
      symlinkTargetAuxNodeId: layer.symlinkTargetAuxNodeId,
      timelinePointId: pointIdOrOrigin(layer.timelinePointId),
    });
  }

  const memo = new Map<string, boolean>();
  const inProgress = new Set<string>();

  const isReachable = (nodeId: string): boolean => {
    if (memo.has(nodeId)) {
      return memo.get(nodeId)!;
    }
    if (nodeId === workspace.auxRootId) {
      memo.set(nodeId, true);
      return true;
    }
    if (inProgress.has(nodeId)) {
      throw new Error("Auxiliary tree is invalid: cycle detected");
    }

    const node = rawStates.get(nodeId);
    if (!node || !node.parentAuxNodeId) {
      memo.set(nodeId, false);
      return false;
    }

    inProgress.add(nodeId);
    const reachable = rawStates.has(node.parentAuxNodeId) && isReachable(node.parentAuxNodeId);
    inProgress.delete(nodeId);
    memo.set(nodeId, reachable);
    return reachable;
  };

  const snapshot = new Map<string, ResolvedAuxSnapshotNode>();
  const pathMemo = new Map<string, string>();
  const buildPath = (nodeId: string): string => {
    if (pathMemo.has(nodeId)) {
      return pathMemo.get(nodeId)!;
    }
    if (nodeId === workspace.auxRootId) {
      pathMemo.set(nodeId, "/");
      return "/";
    }
    const node = rawStates.get(nodeId);
    invariant(node?.parentAuxNodeId, `Aux node ${nodeId} is missing a parent`);
    const parentPath = buildPath(node.parentAuxNodeId);
    const path = parentPath === "/" ? `/${node.name}` : `${parentPath}/${node.name}`;
    pathMemo.set(nodeId, path);
    return path;
  };

  for (const [nodeId, node] of rawStates) {
    const reachable = isReachable(nodeId);
    if (!reachable) {
      continue;
    }
    snapshot.set(nodeId, {
      ...node,
      reachable,
      path: buildPath(nodeId),
    });
  }

  return snapshot;
}

function listChildrenFromSnapshot(
  snapshot: Map<string, ResolvedAuxSnapshotNode>,
  parentId: string,
) {
  return [...snapshot.values()]
    .filter((node) => node.parentAuxNodeId === parentId)
    .sort((left, right) => (left.name ?? "").localeCompare(right.name ?? ""));
}

function resolveAuxNodeIdFromPath(
  snapshot: Map<string, ResolvedAuxSnapshotNode>,
  rootId: string,
  path: string,
  followSymlinks = true,
) {
  if (path === "/" || path === "") {
    return rootId;
  }

  const segments = path.split("/").filter(Boolean);
  let currentId = rootId;

  for (const segment of segments) {
    const children = listChildrenFromSnapshot(snapshot, currentId);
    const child = children.find((node) => node.name === segment);
    if (!child) {
      return null;
    }
    if (followSymlinks && child.nodeType === "symlink") {
      invariant(child.symlinkTargetAuxNodeId, `Symlink ${child.id} has no target`);
      const target = snapshot.get(child.symlinkTargetAuxNodeId);
      invariant(target, `Symlink target ${child.symlinkTargetAuxNodeId} is not visible`);
      currentId = target.id;
      continue;
    }
    currentId = child.id;
  }

  return currentId;
}

function validateTimelinePointRef(
  executor: DatabaseExecutor,
  workspaceId: string,
  pointId: TimelinePointRef,
) {
  const normalized = normalizeTimelinePointId(pointId);
  if (normalized) {
    getTimelinePointOrThrow(executor, workspaceId, normalized);
  }
  return normalized;
}

function assertContentRoot(workspace: WorkspaceRow) {
  invariant(workspace.contentRootId, `Workspace ${workspace.id} has no content root`);
  return workspace.contentRootId;
}

function assertAuxRoot(workspace: WorkspaceRow) {
  invariant(workspace.auxRootId, `Workspace ${workspace.id} has no aux root`);
  return workspace.auxRootId;
}

function validateAuxParent(
  executor: DatabaseExecutor,
  workspace: WorkspaceRow,
  timelinePointId: string | null,
  parentAuxNodeId: string,
) {
  const parent = readAuxByIdAtInternal(executor, workspace, timelinePointId, parentAuxNodeId);
  invariant(parent, `Aux parent not found: ${parentAuxNodeId}`);
  invariant(
    parent.nodeType === "dir" || parent.nodeType === "root",
    "Aux parent must be a directory",
  );
  return parent;
}

function validateUniqueAuxName(
  executor: DatabaseExecutor,
  workspace: WorkspaceRow,
  timelinePointId: string | null,
  parentAuxNodeId: string,
  name: string,
  ignoreNodeId?: string,
) {
  const snapshot = buildReachableAuxSnapshot(executor, workspace, timelinePointId);
  const conflict = listChildrenFromSnapshot(snapshot, parentAuxNodeId).find(
    (node) => node.name === name && node.id !== ignoreNodeId,
  );
  invariant(!conflict, `Aux node name already exists: ${name}`);
}

function readAuxByIdAtInternal(
  executor: DatabaseExecutor,
  workspace: WorkspaceRow,
  timelinePointId: string | null,
  nodeId: string,
) {
  const snapshot = buildReachableAuxSnapshot(executor, workspace, timelinePointId);
  return snapshot.get(nodeId) ?? null;
}

function touchWorkspace(executor: DatabaseExecutor, workspaceId: string) {
  executor
    .update(schema.workspaces)
    .set({ updatedAt: now() })
    .where(eq(schema.workspaces.id, workspaceId))
    .run();
}

function touchProject(executor: DatabaseExecutor, projectId: string) {
  executor
    .update(schema.projects)
    .set({ updatedAt: now() })
    .where(eq(schema.projects.id, projectId))
    .run();
}

export function createDefaultWorkspaceWithExecutor(
  executor: DatabaseExecutor,
  projectId: string,
  name = "main",
) {
  const project = getProjectOrThrow(executor, projectId);
  const workspaceId = createId("workspace");
  const contentRootId = createId("content");
  const auxRootId = createId("aux");
  const timestamp = now();

  executor
    .insert(schema.workspaces)
    .values({
      id: workspaceId,
      projectId,
      name,
      isDefault: true,
      contentRootId,
      auxRootId,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();

  executor
    .insert(schema.contentNodes)
    .values({
      id: contentRootId,
      workspaceId,
      parentId: null,
      nextSiblingId: null,
      anchorTimelinePointId: null,
      kind: "_root",
      title: null,
      body: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();

  executor
    .insert(schema.auxNodes)
    .values({
      id: auxRootId,
      workspaceId,
      nodeType: "root",
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();

  touchProject(executor, project.id);
  return getWorkspaceOrThrow(executor, workspaceId);
}

export function createDefaultWorkspace(projectId: string, name = "main") {
  return db.transaction((tx) => createDefaultWorkspaceWithExecutor(tx, projectId, name));
}

export function getDefaultWorkspace(projectId: string) {
  return db
    .select()
    .from(schema.workspaces)
    .where(and(eq(schema.workspaces.projectId, projectId), eq(schema.workspaces.isDefault, true)))
    .get();
}

export function listWorkspaces(projectId: string) {
  getProjectOrThrow(db, projectId);
  return db
    .select()
    .from(schema.workspaces)
    .where(eq(schema.workspaces.projectId, projectId))
    .all();
}

export function listTimelinePoints(workspaceId: string): TimelinePointView[] {
  getWorkspaceOrThrow(db, workspaceId);
  const ordered = orderTimelineRows(listTimelineRows(db, workspaceId));
  return [
    originTimelinePoint(),
    ...ordered.map((row) => ({
      id: row.id,
      key: row.key,
      label: row.label,
      description: row.description,
      prevPointId: pointIdOrOrigin(row.prevPointId),
      isImplicitOrigin: false,
    })),
  ];
}

export function createTimelinePoint(input: {
  workspaceId: string;
  afterPointId?: string | typeof ORIGIN_TIMELINE_POINT_ID;
  key: string;
  label: string;
  description?: string | null;
}) {
  return db.transaction((tx) => {
    const workspace = getWorkspaceOrThrow(tx, input.workspaceId);
    const afterPointId = validateTimelinePointRef(tx, workspace.id, input.afterPointId);
    const successor = getTimelineSuccessor(tx, workspace.id, afterPointId);
    const pointId = createId("timeline");
    const timestamp = now();

    tx.insert(schema.timelinePoints)
      .values({
        id: pointId,
        workspaceId: workspace.id,
        key: input.key,
        label: input.label,
        description: input.description ?? null,
        prevPointId: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();

    if (successor) {
      tx.update(schema.timelinePoints)
        .set({ prevPointId: pointId, updatedAt: timestamp })
        .where(eq(schema.timelinePoints.id, successor.id))
        .run();
    }

    tx.update(schema.timelinePoints)
      .set({ prevPointId: afterPointId, updatedAt: timestamp })
      .where(eq(schema.timelinePoints.id, pointId))
      .run();

    touchWorkspace(tx, workspace.id);
    return getTimelinePointOrThrow(tx, workspace.id, pointId);
  });
}

export function moveTimelinePoint(input: {
  workspaceId: string;
  pointId: string;
  afterPointId?: string | typeof ORIGIN_TIMELINE_POINT_ID;
}) {
  return db.transaction((tx) => {
    const workspace = getWorkspaceOrThrow(tx, input.workspaceId);
    const point = getTimelinePointOrThrow(tx, workspace.id, input.pointId);
    const afterPointId = validateTimelinePointRef(tx, workspace.id, input.afterPointId);
    invariant(point.id !== afterPointId, "Timeline point cannot move after itself");
    if (point.prevPointId === afterPointId) {
      return point;
    }

    const successor = getTimelineSuccessor(tx, workspace.id, point.id);
    const timestamp = now();

    tx.update(schema.timelinePoints)
      .set({ prevPointId: null, updatedAt: timestamp })
      .where(eq(schema.timelinePoints.id, point.id))
      .run();

    if (successor) {
      tx.update(schema.timelinePoints)
        .set({ prevPointId: point.prevPointId, updatedAt: timestamp })
        .where(eq(schema.timelinePoints.id, successor.id))
        .run();
    }

    const targetSuccessor = getTimelineSuccessor(tx, workspace.id, afterPointId);
    if (targetSuccessor && targetSuccessor.id !== point.id) {
      tx.update(schema.timelinePoints)
        .set({ prevPointId: point.id, updatedAt: timestamp })
        .where(eq(schema.timelinePoints.id, targetSuccessor.id))
        .run();
    }

    tx.update(schema.timelinePoints)
      .set({ prevPointId: afterPointId, updatedAt: timestamp })
      .where(eq(schema.timelinePoints.id, point.id))
      .run();

    touchWorkspace(tx, workspace.id);
    return getTimelinePointOrThrow(tx, workspace.id, point.id);
  });
}

export function deleteTimelinePoint(workspaceId: string, pointId: string) {
  return db.transaction((tx) => {
    const workspace = getWorkspaceOrThrow(tx, workspaceId);
    const point = getTimelinePointOrThrow(tx, workspace.id, pointId);
    const contentUse = tx
      .select()
      .from(schema.contentNodes)
      .where(eq(schema.contentNodes.anchorTimelinePointId, point.id))
      .get();
    invariant(!contentUse, "Timeline point is still referenced by content nodes");

    const auxUse = tx
      .select()
      .from(schema.auxNodeLayers)
      .where(eq(schema.auxNodeLayers.timelinePointId, point.id))
      .get();
    invariant(!auxUse, "Timeline point is still referenced by auxiliary layers");

    const successor = getTimelineSuccessor(tx, workspace.id, point.id);
    const timestamp = now();

    tx.update(schema.timelinePoints)
      .set({ prevPointId: null, updatedAt: timestamp })
      .where(eq(schema.timelinePoints.id, point.id))
      .run();

    if (successor) {
      tx.update(schema.timelinePoints)
        .set({ prevPointId: point.prevPointId, updatedAt: timestamp })
        .where(eq(schema.timelinePoints.id, successor.id))
        .run();
    }

    tx.delete(schema.timelinePoints).where(eq(schema.timelinePoints.id, point.id)).run();
    touchWorkspace(tx, workspace.id);
  });
}

export function createContentNode(input: {
  workspaceId: string;
  parentId: string;
  afterSiblingId?: string | null;
  anchorPointId?: TimelinePointRef;
  kind?: string | null;
  title?: string | null;
  body?: string | null;
}) {
  return db.transaction((tx) => {
    const workspace = getWorkspaceOrThrow(tx, input.workspaceId);
    getContentNodeOrThrow(tx, workspace.id, input.parentId);
    const anchorTimelinePointId = validateTimelinePointRef(tx, workspace.id, input.anchorPointId);
    const timestamp = now();
    const nodeId = createId("content");

    if (input.afterSiblingId) {
      const previousSibling = getContentNodeOrThrow(tx, workspace.id, input.afterSiblingId);
      invariant(
        previousSibling.parentId === input.parentId,
        "afterSiblingId must belong to the same parent",
      );

      tx.insert(schema.contentNodes)
        .values({
          id: nodeId,
          workspaceId: workspace.id,
          parentId: input.parentId,
          nextSiblingId: null,
          anchorTimelinePointId,
          kind: input.kind ?? null,
          title: input.title ?? null,
          body: input.body ?? null,
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .run();

      tx.update(schema.contentNodes)
        .set({ nextSiblingId: nodeId, updatedAt: timestamp })
        .where(eq(schema.contentNodes.id, previousSibling.id))
        .run();

      tx.update(schema.contentNodes)
        .set({ nextSiblingId: previousSibling.nextSiblingId, updatedAt: timestamp })
        .where(eq(schema.contentNodes.id, nodeId))
        .run();
    } else {
      const head = orderContentChildren(listContentChildren(tx, workspace.id, input.parentId))[0];
      tx.insert(schema.contentNodes)
        .values({
          id: nodeId,
          workspaceId: workspace.id,
          parentId: input.parentId,
          nextSiblingId: head?.id ?? null,
          anchorTimelinePointId,
          kind: input.kind ?? null,
          title: input.title ?? null,
          body: input.body ?? null,
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .run();
    }

    touchWorkspace(tx, workspace.id);
    return getContentNodeOrThrow(tx, workspace.id, nodeId);
  });
}

export function moveContentNode(input: {
  workspaceId: string;
  nodeId: string;
  newParentId: string;
  afterSiblingId?: string | null;
}) {
  return db.transaction((tx) => {
    const workspace = getWorkspaceOrThrow(tx, input.workspaceId);
    const contentRootId = assertContentRoot(workspace);
    const node = getContentNodeOrThrow(tx, workspace.id, input.nodeId);
    invariant(node.id !== contentRootId, "Cannot move the hidden content root");
    const newParent = getContentNodeOrThrow(tx, workspace.id, input.newParentId);
    const subtreeIds = collectContentSubtreeIds(tx, workspace.id, node.id);
    invariant(!subtreeIds.has(newParent.id), "Cannot move a content node under its own descendant");
    if (input.afterSiblingId) {
      const previousSibling = getContentNodeOrThrow(tx, workspace.id, input.afterSiblingId);
      invariant(
        previousSibling.parentId === newParent.id,
        "afterSiblingId must belong to the destination parent",
      );
      invariant(previousSibling.id !== node.id, "afterSiblingId cannot be the moved node");
    }

    const oldPrev = getContentPrevSibling(tx, workspace.id, node.id);
    const timestamp = now();

    tx.update(schema.contentNodes)
      .set({ nextSiblingId: null, updatedAt: timestamp })
      .where(eq(schema.contentNodes.id, node.id))
      .run();

    if (oldPrev) {
      tx.update(schema.contentNodes)
        .set({ nextSiblingId: node.nextSiblingId, updatedAt: timestamp })
        .where(eq(schema.contentNodes.id, oldPrev.id))
        .run();
    }

    if (input.afterSiblingId) {
      const previousSibling = getContentNodeOrThrow(tx, workspace.id, input.afterSiblingId);
      const afterNext = previousSibling.nextSiblingId;
      tx.update(schema.contentNodes)
        .set({ nextSiblingId: node.id, updatedAt: timestamp })
        .where(eq(schema.contentNodes.id, previousSibling.id))
        .run();

      tx.update(schema.contentNodes)
        .set({ parentId: newParent.id, nextSiblingId: afterNext, updatedAt: timestamp })
        .where(eq(schema.contentNodes.id, node.id))
        .run();
    } else {
      const head = orderContentChildren(listContentChildren(tx, workspace.id, newParent.id))[0];
      tx.update(schema.contentNodes)
        .set({ parentId: newParent.id, nextSiblingId: head?.id ?? null, updatedAt: timestamp })
        .where(eq(schema.contentNodes.id, node.id))
        .run();
    }

    touchWorkspace(tx, workspace.id);
    return getContentNodeOrThrow(tx, workspace.id, node.id);
  });
}

export function updateContentNode(input: {
  workspaceId: string;
  nodeId: string;
  anchorPointId?: TimelinePointRef;
  kind?: string | null;
  title?: string | null;
  body?: string | null;
}) {
  return db.transaction((tx) => {
    const workspace = getWorkspaceOrThrow(tx, input.workspaceId);
    const node = getContentNodeOrThrow(tx, workspace.id, input.nodeId);
    const anchorTimelinePointId =
      input.anchorPointId === undefined
        ? node.anchorTimelinePointId
        : validateTimelinePointRef(tx, workspace.id, input.anchorPointId);

    tx.update(schema.contentNodes)
      .set({
        anchorTimelinePointId,
        kind: input.kind === undefined ? node.kind : input.kind,
        title: input.title === undefined ? node.title : input.title,
        body: input.body === undefined ? node.body : input.body,
        updatedAt: now(),
      })
      .where(eq(schema.contentNodes.id, node.id))
      .run();

    touchWorkspace(tx, workspace.id);
    return getContentNodeOrThrow(tx, workspace.id, node.id);
  });
}

export function exportContentSubtree(workspaceId: string, rootNodeId?: string) {
  const workspace = getWorkspaceOrThrow(db, workspaceId);
  const contentRootId = assertContentRoot(workspace);
  const targetRootId = rootNodeId ?? contentRootId;
  const targetNode = getContentNodeOrThrow(db, workspace.id, targetRootId);
  if (targetRootId === contentRootId) {
    return {
      rootNodeId: targetRootId,
      isWorkspaceRoot: true,
      nodes: orderContentChildren(listContentChildren(db, workspace.id, targetRootId)).map(
        (child) => exportContentNode(db, workspace.id, child),
      ),
    } satisfies ExportedContentSubtree;
  }

  return {
    rootNodeId: targetRootId,
    isWorkspaceRoot: false,
    nodes: [exportContentNode(db, workspace.id, targetNode)],
  } satisfies ExportedContentSubtree;
}

export function mkdirAt(input: {
  workspaceId: string;
  timelinePointId?: TimelinePointRef;
  parentDirId: string;
  name: string;
}) {
  return db.transaction((tx) => {
    const workspace = getWorkspaceOrThrow(tx, input.workspaceId);
    const timelinePointId = validateTimelinePointRef(tx, workspace.id, input.timelinePointId);
    validateAuxParent(tx, workspace, timelinePointId, input.parentDirId);
    validateUniqueAuxName(tx, workspace, timelinePointId, input.parentDirId, input.name);

    const nodeId = createId("aux");
    const timestamp = now();
    tx.insert(schema.auxNodes)
      .values({
        id: nodeId,
        workspaceId: workspace.id,
        nodeType: "dir",
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();

    putAuxLayer(tx, {
      workspaceId: workspace.id,
      timelinePointId,
      auxNodeId: nodeId,
      isDeleted: false,
      parentAuxNodeId: input.parentDirId,
      name: input.name,
      content: null,
      symlinkTargetAuxNodeId: null,
    });

    touchWorkspace(tx, workspace.id);
    return getAuxNodeOrThrow(tx, workspace.id, nodeId);
  });
}

export function writeFileAt(input: {
  workspaceId: string;
  timelinePointId?: TimelinePointRef;
  parentDirId?: string;
  name?: string;
  nodeId?: string;
  content: string;
}) {
  return db.transaction((tx) => {
    const workspace = getWorkspaceOrThrow(tx, input.workspaceId);
    const timelinePointId = validateTimelinePointRef(tx, workspace.id, input.timelinePointId);
    const timestamp = now();

    if (input.nodeId) {
      const existing = readAuxByIdAtInternal(tx, workspace, timelinePointId, input.nodeId);
      invariant(existing, `Aux file not found: ${input.nodeId}`);
      invariant(existing.nodeType === "file", "Aux node is not a file");
      putAuxLayer(tx, {
        workspaceId: workspace.id,
        timelinePointId,
        auxNodeId: existing.id,
        isDeleted: false,
        parentAuxNodeId: existing.parentAuxNodeId,
        name: existing.name,
        content: input.content,
        symlinkTargetAuxNodeId: null,
      });
      tx.update(schema.auxNodes)
        .set({ updatedAt: timestamp })
        .where(eq(schema.auxNodes.id, existing.id))
        .run();
      touchWorkspace(tx, workspace.id);
      return getAuxNodeOrThrow(tx, workspace.id, existing.id);
    }

    invariant(input.parentDirId, "parentDirId is required when creating a file");
    invariant(input.name, "name is required when creating a file");
    validateAuxParent(tx, workspace, timelinePointId, input.parentDirId);
    validateUniqueAuxName(tx, workspace, timelinePointId, input.parentDirId, input.name);

    const nodeId = createId("aux");
    tx.insert(schema.auxNodes)
      .values({
        id: nodeId,
        workspaceId: workspace.id,
        nodeType: "file",
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();
    putAuxLayer(tx, {
      workspaceId: workspace.id,
      timelinePointId,
      auxNodeId: nodeId,
      isDeleted: false,
      parentAuxNodeId: input.parentDirId,
      name: input.name,
      content: input.content,
      symlinkTargetAuxNodeId: null,
    });

    touchWorkspace(tx, workspace.id);
    return getAuxNodeOrThrow(tx, workspace.id, nodeId);
  });
}

export function linkAt(input: {
  workspaceId: string;
  timelinePointId?: TimelinePointRef;
  parentDirId: string;
  name: string;
  targetNodeId: string;
}) {
  return db.transaction((tx) => {
    const workspace = getWorkspaceOrThrow(tx, input.workspaceId);
    const timelinePointId = validateTimelinePointRef(tx, workspace.id, input.timelinePointId);
    validateAuxParent(tx, workspace, timelinePointId, input.parentDirId);
    validateUniqueAuxName(tx, workspace, timelinePointId, input.parentDirId, input.name);
    const target = readAuxByIdAtInternal(tx, workspace, timelinePointId, input.targetNodeId);
    invariant(target, `Symlink target is not visible: ${input.targetNodeId}`);

    const nodeId = createId("aux");
    const timestamp = now();
    tx.insert(schema.auxNodes)
      .values({
        id: nodeId,
        workspaceId: workspace.id,
        nodeType: "symlink",
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();

    putAuxLayer(tx, {
      workspaceId: workspace.id,
      timelinePointId,
      auxNodeId: nodeId,
      isDeleted: false,
      parentAuxNodeId: input.parentDirId,
      name: input.name,
      content: null,
      symlinkTargetAuxNodeId: target.id,
    });

    touchWorkspace(tx, workspace.id);
    return getAuxNodeOrThrow(tx, workspace.id, nodeId);
  });
}

export function moveAuxNodeAt(input: {
  workspaceId: string;
  timelinePointId?: TimelinePointRef;
  nodeId: string;
  newParentDirId: string;
  newName: string;
}) {
  return db.transaction((tx) => {
    const workspace = getWorkspaceOrThrow(tx, input.workspaceId);
    const auxRootId = assertAuxRoot(workspace);
    const timelinePointId = validateTimelinePointRef(tx, workspace.id, input.timelinePointId);
    const current = readAuxByIdAtInternal(tx, workspace, timelinePointId, input.nodeId);
    invariant(current, `Aux node not found: ${input.nodeId}`);
    invariant(current.id !== auxRootId, "Cannot move the hidden aux root");
    validateAuxParent(tx, workspace, timelinePointId, input.newParentDirId);

    const snapshot = buildReachableAuxSnapshot(tx, workspace, timelinePointId);
    const subtree = new Set<string>();
    const queue = [current.id];
    while (queue.length > 0) {
      const currentId = queue.shift()!;
      if (subtree.has(currentId)) {
        continue;
      }
      subtree.add(currentId);
      for (const child of listChildrenFromSnapshot(snapshot, currentId)) {
        queue.push(child.id);
      }
    }
    invariant(
      !subtree.has(input.newParentDirId),
      "Cannot move an aux node under its own descendant",
    );
    validateUniqueAuxName(
      tx,
      workspace,
      timelinePointId,
      input.newParentDirId,
      input.newName,
      current.id,
    );

    putAuxLayer(tx, {
      workspaceId: workspace.id,
      timelinePointId,
      auxNodeId: current.id,
      isDeleted: false,
      parentAuxNodeId: input.newParentDirId,
      name: input.newName,
      content: current.content,
      symlinkTargetAuxNodeId: current.symlinkTargetAuxNodeId,
    });

    touchWorkspace(tx, workspace.id);
    return getAuxNodeOrThrow(tx, workspace.id, current.id);
  });
}

export function deleteAuxNodeAt(input: {
  workspaceId: string;
  timelinePointId?: TimelinePointRef;
  nodeId: string;
}) {
  return db.transaction((tx) => {
    const workspace = getWorkspaceOrThrow(tx, input.workspaceId);
    const auxRootId = assertAuxRoot(workspace);
    const timelinePointId = validateTimelinePointRef(tx, workspace.id, input.timelinePointId);
    const current = readAuxByIdAtInternal(tx, workspace, timelinePointId, input.nodeId);
    invariant(current, `Aux node not found: ${input.nodeId}`);
    invariant(current.id !== auxRootId, "Cannot delete the hidden aux root");

    putAuxLayer(tx, {
      workspaceId: workspace.id,
      timelinePointId,
      auxNodeId: current.id,
      isDeleted: true,
      parentAuxNodeId: null,
      name: null,
      content: null,
      symlinkTargetAuxNodeId: null,
    });

    touchWorkspace(tx, workspace.id);
  });
}

export function readAuxByIdAt(workspaceId: string, pointId: TimelinePointRef, nodeId: string) {
  const workspace = getWorkspaceOrThrow(db, workspaceId);
  const timelinePointId = validateTimelinePointRef(db, workspace.id, pointId);
  return readAuxByIdAtInternal(db, workspace, timelinePointId, nodeId);
}

export function readAuxByPathAt(workspaceId: string, pointId: TimelinePointRef, path: string) {
  const workspace = getWorkspaceOrThrow(db, workspaceId);
  const auxRootId = assertAuxRoot(workspace);
  const timelinePointId = validateTimelinePointRef(db, workspace.id, pointId);
  const snapshot = buildReachableAuxSnapshot(db, workspace, timelinePointId);
  const nodeId = resolveAuxNodeIdFromPath(snapshot, auxRootId, path);
  return nodeId ? (snapshot.get(nodeId) ?? null) : null;
}

export function listAuxDirAt(
  workspaceId: string,
  pointId: TimelinePointRef,
  target: { dirId?: string; path?: string },
) {
  const workspace = getWorkspaceOrThrow(db, workspaceId);
  const auxRootId = assertAuxRoot(workspace);
  const timelinePointId = validateTimelinePointRef(db, workspace.id, pointId);
  const snapshot = buildReachableAuxSnapshot(db, workspace, timelinePointId);

  const dirId = target.path
    ? (resolveAuxNodeIdFromPath(snapshot, auxRootId, target.path) ?? undefined)
    : target.dirId;
  invariant(dirId, "Directory target is required");
  const dir = snapshot.get(dirId);
  invariant(dir, `Directory not found: ${dirId}`);
  invariant(dir.nodeType === "dir" || dir.nodeType === "root", "Target is not a directory");

  return listChildrenFromSnapshot(snapshot, dir.id);
}

export function composeWritingContext(workspaceId: string, contentNodeId: string): WritingContext {
  const workspace = getWorkspaceOrThrow(db, workspaceId);
  const contentNode = getContentNodeOrThrow(db, workspace.id, contentNodeId);
  const exported = exportContentNode(db, workspace.id, contentNode);
  const timelinePointId = normalizeTimelinePointId(contentNode.anchorTimelinePointId);
  const snapshot = buildReachableAuxSnapshot(db, workspace, timelinePointId);

  return {
    contentNode: exported,
    timelinePointId: pointIdOrOrigin(timelinePointId),
    auxSnapshot: [...snapshot.values()]
      .filter((node) => node.nodeType !== "root")
      .sort((left, right) => left.path.localeCompare(right.path)),
  };
}
