import { type InferInsertModel, and, eq, inArray, isNull, or } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";

import { type DatabaseExecutor, schema } from "@/db";
import { ORIGIN_TIMELINE_POINT_ID } from "@/shared/constants";

import type { ExportedAuxNode, ResolvedAuxSnapshotNode } from "../types";
import { createId, invariant, now } from "./ids";
import { resolveTimelineChainIds } from "./timeline-chain";
import { pointCondition, pointIdOrOrigin } from "./timeline-point";

type WorkspaceRow = InferSelectModel<typeof schema.workspaces>;
type AuxNodeLayerRow = InferSelectModel<typeof schema.auxNodeLayers>;

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

export function putAuxLayer(
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

export function buildReachableAuxSnapshot(
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

export function listChildrenFromSnapshot(
  snapshot: Map<string, ResolvedAuxSnapshotNode>,
  parentId: string,
) {
  return [...snapshot.values()]
    .filter((node) => node.parentAuxNodeId === parentId)
    .sort((left, right) => (left.name ?? "").localeCompare(right.name ?? ""));
}

export function exportAuxNode(
  snapshot: Map<string, ResolvedAuxSnapshotNode>,
  node: ResolvedAuxSnapshotNode,
): ExportedAuxNode {
  const symlinkTargetPath = node.symlinkTargetAuxNodeId
    ? (snapshot.get(node.symlinkTargetAuxNodeId)?.path ?? null)
    : null;

  return {
    id: node.id,
    nodeType: node.nodeType,
    parentAuxNodeId: node.parentAuxNodeId,
    name: node.name,
    content: node.content,
    symlinkTargetAuxNodeId: node.symlinkTargetAuxNodeId,
    symlinkTargetPath,
    timelinePointId: node.timelinePointId,
    path: node.path,
    children: listChildrenFromSnapshot(snapshot, node.id).map((child) =>
      exportAuxNode(snapshot, child),
    ),
  };
}

export function resolveAuxNodeIdFromPath(
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

export function readAuxByIdAtInternal(
  executor: DatabaseExecutor,
  workspace: WorkspaceRow,
  timelinePointId: string | null,
  nodeId: string,
) {
  const snapshot = buildReachableAuxSnapshot(executor, workspace, timelinePointId);
  return snapshot.get(nodeId) ?? null;
}

export function validateAuxParent(
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

export function validateUniqueAuxName(
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
