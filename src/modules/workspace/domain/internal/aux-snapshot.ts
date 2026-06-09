import type { InferSelectModel } from "drizzle-orm";
import { and, eq, inArray, type InferInsertModel, isNull, or } from "drizzle-orm";

import { type DatabaseExecutor, schema } from "@/db";
import { ORIGIN_TIMELINE_POINT_ID } from "@/modules/workspace/domain/constants";

import type { ExportedAuxNode, ResolvedAuxSnapshotNode } from "../types";
import type { AuxLayerChangeView } from "../types";
import { getTimelinePointOrThrow, getWorkspaceOrThrow } from "./access";
import { createId, invariant, now } from "@/shared/lib/domain";
import { listOrderedTimelinePointIds, resolveTimelineChainIds } from "./timeline-chain";
import { pointCondition, pointIdOrOrigin } from "./timeline-point";

type WorkspaceRow = InferSelectModel<typeof schema.workspaces>;
type AuxNodeLayerRow = InferSelectModel<typeof schema.auxNodeLayers>;

function formatAuxSnapshotPointLabel(
  executor: DatabaseExecutor,
  workspaceId: string,
  pointId: string | null,
) {
  if (pointId == null) {
    return "原点";
  }

  return getTimelinePointOrThrow(executor, workspaceId, pointId).label;
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

export function collectChangedAuxNodeIds(
  executor: DatabaseExecutor,
  workspaceId: string,
  snapshot: Map<string, ResolvedAuxSnapshotNode>,
  timelinePointId: string | null,
) {
  const changedIds = new Set<string>();
  if (!timelinePointId) {
    return changedIds;
  }

  const layers = executor
    .select({ auxNodeId: schema.auxNodeLayers.auxNodeId })
    .from(schema.auxNodeLayers)
    .where(
      and(
        eq(schema.auxNodeLayers.workspaceId, workspaceId),
        eq(schema.auxNodeLayers.timelinePointId, timelinePointId),
      ),
    )
    .all();

  for (const layer of layers) {
    if (snapshot.has(layer.auxNodeId)) {
      changedIds.add(layer.auxNodeId);
    }
  }

  return changedIds;
}

export function collectDeletedAuxNodeIds(
  executor: DatabaseExecutor,
  workspaceId: string,
  timelinePointId: string | null,
) {
  const deletedIds = new Set<string>();
  if (!timelinePointId) {
    return deletedIds;
  }

  const layers = executor
    .select({ auxNodeId: schema.auxNodeLayers.auxNodeId })
    .from(schema.auxNodeLayers)
    .where(
      and(
        eq(schema.auxNodeLayers.workspaceId, workspaceId),
        eq(schema.auxNodeLayers.timelinePointId, timelinePointId),
        eq(schema.auxNodeLayers.isDeleted, true),
      ),
    )
    .all();

  for (const layer of layers) {
    deletedIds.add(layer.auxNodeId);
  }

  return deletedIds;
}

interface AuxNodeExportOptions {
  previousSnapshot?: Map<string, ResolvedAuxSnapshotNode> | null;
  deletedNodeIds?: ReadonlySet<string>;
  forceDeleted?: boolean;
}

function listAuxExportChildren(
  snapshot: Map<string, ResolvedAuxSnapshotNode>,
  parentId: string,
  options: AuxNodeExportOptions,
  parentDeleted: boolean,
) {
  const previousSnapshot = options.previousSnapshot ?? null;
  const deletedNodeIds = options.deletedNodeIds ?? new Set<string>();
  const children: { node: ResolvedAuxSnapshotNode; isDeleted: boolean }[] = [];

  if (parentDeleted) {
    if (previousSnapshot) {
      children.push(
        ...listChildrenFromSnapshot(previousSnapshot, parentId).map((node) => ({
          node,
          isDeleted: true,
        })),
      );
    }
    return children;
  }

  children.push(
    ...listChildrenFromSnapshot(snapshot, parentId).map((node) => ({
      node,
      isDeleted: false,
    })),
  );

  if (previousSnapshot) {
    children.push(
      ...listChildrenFromSnapshot(previousSnapshot, parentId)
        .filter((node) => deletedNodeIds.has(node.id) && !snapshot.has(node.id))
        .map((node) => ({
          node,
          isDeleted: true,
        })),
    );
  }

  return children.sort((left, right) =>
    (left.node.name ?? "").localeCompare(right.node.name ?? ""),
  );
}

export function exportAuxNode(
  snapshot: Map<string, ResolvedAuxSnapshotNode>,
  node: ResolvedAuxSnapshotNode,
  changedNodeIds: ReadonlySet<string> = new Set(),
  options: AuxNodeExportOptions = {},
): ExportedAuxNode {
  const isDeleted = options.forceDeleted === true;
  const sourceSnapshot =
    isDeleted && options.previousSnapshot ? options.previousSnapshot : snapshot;
  const deletedNodeIds = options.deletedNodeIds ?? new Set<string>();
  const symlinkTargetPath = node.symlinkTargetAuxNodeId
    ? (sourceSnapshot.get(node.symlinkTargetAuxNodeId)?.path ?? null)
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
    hasTimelineChange: changedNodeIds.has(node.id) || deletedNodeIds.has(node.id),
    isDeleted,
    children: listAuxExportChildren(snapshot, node.id, options, isDeleted).map((child) =>
      exportAuxNode(snapshot, child.node, changedNodeIds, {
        ...options,
        forceDeleted: child.isDeleted,
      }),
    ),
  };
}

export function exportAuxChildren(
  snapshot: Map<string, ResolvedAuxSnapshotNode>,
  parentId: string,
  changedNodeIds: ReadonlySet<string> = new Set(),
  options: AuxNodeExportOptions = {},
) {
  return listAuxExportChildren(snapshot, parentId, options, false).map((child) =>
    exportAuxNode(snapshot, child.node, changedNodeIds, {
      ...options,
      forceDeleted: child.isDeleted,
    }),
  );
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
  invariant(parent.nodeType === "dir" || parent.nodeType === "root", "辅助信息父级必须是文件夹。");
  return parent;
}

export function listAuxLayerChangesAtTimelinePoint(
  executor: DatabaseExecutor,
  workspace: WorkspaceRow,
  timelinePointId: string,
): AuxLayerChangeView[] {
  const layers = executor
    .select()
    .from(schema.auxNodeLayers)
    .where(
      and(
        eq(schema.auxNodeLayers.workspaceId, workspace.id),
        eq(schema.auxNodeLayers.timelinePointId, timelinePointId),
      ),
    )
    .all();

  if (layers.length === 0) {
    return [];
  }

  const point = getTimelinePointOrThrow(executor, workspace.id, timelinePointId);
  const snapshotAtPoint = buildReachableAuxSnapshot(executor, workspace, timelinePointId);
  const snapshotAtPrev = buildReachableAuxSnapshot(executor, workspace, point.prevPointId);

  const changes: AuxLayerChangeView[] = [];

  for (const layer of layers) {
    if (layer.auxNodeId === workspace.auxRootId) {
      continue;
    }

    const nodeAtPoint = snapshotAtPoint.get(layer.auxNodeId);
    if (nodeAtPoint) {
      changes.push({ path: nodeAtPoint.path, isDeleted: false });
      continue;
    }

    if (layer.isDeleted) {
      const nodeAtPrev = snapshotAtPrev.get(layer.auxNodeId);
      changes.push({
        path: nodeAtPrev?.path ?? layer.auxNodeId,
        isDeleted: true,
      });
      continue;
    }

    const parent = layer.parentAuxNodeId
      ? (snapshotAtPoint.get(layer.parentAuxNodeId) ?? snapshotAtPrev.get(layer.parentAuxNodeId))
      : null;
    const parentPath = parent?.path ?? "/";
    const path =
      layer.name && parentPath
        ? parentPath === "/"
          ? `/${layer.name}`
          : `${parentPath}/${layer.name}`
        : layer.auxNodeId;
    changes.push({ path, isDeleted: false });
  }

  return changes.sort((left, right) => left.path.localeCompare(right.path));
}

export function purgeAuxLayersAtTimelinePoint(
  executor: DatabaseExecutor,
  workspaceId: string,
  timelinePointId: string,
) {
  executor
    .delete(schema.auxNodeLayers)
    .where(
      and(
        eq(schema.auxNodeLayers.workspaceId, workspaceId),
        eq(schema.auxNodeLayers.timelinePointId, timelinePointId),
      ),
    )
    .run();
  gcOrphanAuxNodes(executor, workspaceId);
}

export function gcOrphanAuxNodes(executor: DatabaseExecutor, workspaceId: string) {
  const workspace = getWorkspaceOrThrow(executor, workspaceId);
  const auxRootId = workspace.auxRootId;
  if (!auxRootId) {
    return 0;
  }

  let removed = 0;
  let changed = true;

  while (changed) {
    changed = false;
    const nodes = executor
      .select({ id: schema.auxNodes.id })
      .from(schema.auxNodes)
      .where(eq(schema.auxNodes.workspaceId, workspaceId))
      .all();

    for (const node of nodes) {
      if (node.id === auxRootId) {
        continue;
      }

      const referencedAsParent = executor
        .select({ id: schema.auxNodeLayers.id })
        .from(schema.auxNodeLayers)
        .where(
          and(
            eq(schema.auxNodeLayers.workspaceId, workspaceId),
            eq(schema.auxNodeLayers.parentAuxNodeId, node.id),
          ),
        )
        .get();
      if (referencedAsParent) {
        continue;
      }

      const referencedAsSymlink = executor
        .select({ id: schema.auxNodeLayers.id })
        .from(schema.auxNodeLayers)
        .where(
          and(
            eq(schema.auxNodeLayers.workspaceId, workspaceId),
            eq(schema.auxNodeLayers.symlinkTargetAuxNodeId, node.id),
          ),
        )
        .get();
      if (referencedAsSymlink) {
        continue;
      }

      const layers = executor
        .select({ isDeleted: schema.auxNodeLayers.isDeleted })
        .from(schema.auxNodeLayers)
        .where(
          and(
            eq(schema.auxNodeLayers.workspaceId, workspaceId),
            eq(schema.auxNodeLayers.auxNodeId, node.id),
          ),
        )
        .all();

      if (layers.length === 0) {
        executor.delete(schema.auxNodes).where(eq(schema.auxNodes.id, node.id)).run();
        removed += 1;
        changed = true;
        continue;
      }

      if (layers.every((layer) => layer.isDeleted)) {
        executor
          .delete(schema.auxNodeLayers)
          .where(
            and(
              eq(schema.auxNodeLayers.workspaceId, workspaceId),
              eq(schema.auxNodeLayers.auxNodeId, node.id),
            ),
          )
          .run();
        executor.delete(schema.auxNodes).where(eq(schema.auxNodes.id, node.id)).run();
        removed += 1;
        changed = true;
      }
    }
  }

  return removed;
}

export function validateUniqueAuxName(
  executor: DatabaseExecutor,
  workspace: WorkspaceRow,
  timelinePointId: string | null,
  parentAuxNodeId: string,
  name: string,
  ignoreNodeId?: string,
  action = "保存辅助信息",
) {
  const normalizedName = name.trim();
  invariant(normalizedName, `无法${action}：辅助信息名称不能为空。请输入名称后再保存。`);
  for (const pointId of listAffectedAuxSnapshotPointIds(executor, workspace.id, timelinePointId)) {
    const snapshot = buildReachableAuxSnapshot(executor, workspace, pointId);
    if (!snapshot.has(parentAuxNodeId)) {
      continue;
    }
    validateUniqueAuxNameInSnapshot(
      snapshot,
      parentAuxNodeId,
      normalizedName,
      ignoreNodeId,
      action,
      formatAuxSnapshotPointLabel(executor, workspace.id, pointId),
    );
  }
  return normalizedName;
}

export function listAffectedAuxSnapshotPointIds(
  executor: DatabaseExecutor,
  workspaceId: string,
  timelinePointId: string | null,
) {
  const orderedIds = listOrderedTimelinePointIds(executor, workspaceId);
  if (timelinePointId == null) {
    return [null, ...orderedIds];
  }

  const startIndex = orderedIds.indexOf(timelinePointId);
  invariant(startIndex >= 0, `Timeline point not found: ${timelinePointId}`);
  return orderedIds.slice(startIndex);
}

export function validateUniqueAuxNameInSnapshot(
  snapshot: Map<string, ResolvedAuxSnapshotNode>,
  parentAuxNodeId: string,
  name: string,
  ignoreNodeId?: string,
  action = "保存辅助信息",
  timelineLabel?: string,
) {
  const normalizedName = name.trim();
  invariant(normalizedName, `无法${action}：辅助信息名称不能为空。请输入名称后再保存。`);
  const conflict = listChildrenFromSnapshot(snapshot, parentAuxNodeId).find(
    (node) => node.name?.trim() === normalizedName && node.id !== ignoreNodeId,
  );
  const conflictScope = timelineLabel ? `时间点「${timelineLabel}」的` : "";
  invariant(
    !conflict,
    `无法${action}：${conflictScope}同一文件夹中已存在名为「${normalizedName}」的辅助信息（${conflict?.path ?? normalizedName}）。请换一个名称后再保存。`,
  );
  return normalizedName;
}
