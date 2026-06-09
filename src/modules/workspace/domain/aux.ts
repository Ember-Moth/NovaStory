import { and, eq } from "drizzle-orm";

import { db, schema } from "@/db";

import {
  assertAuxRoot,
  getAuxNodeOrThrow,
  getTimelinePointOrThrow,
  getWorkspaceOrThrow,
  touchWorkspace,
} from "./internal/access";
import {
  buildReachableAuxSnapshot,
  collectChangedAuxNodeIds,
  collectDeletedAuxNodeIds,
  exportAuxChildren,
  gcOrphanAuxNodes,
  listAffectedAuxSnapshotPointIds,
  listAuxLayerChangesAtTimelinePoint,
  listChildrenFromSnapshot,
  putAuxLayer,
  readAuxByIdAtInternal,
  resolveAuxNodeIdFromPath,
  validateAuxParent,
  validateUniqueAuxName,
  validateUniqueAuxNameInSnapshot,
} from "./internal/aux-snapshot";
import { createId, invariant, now } from "@/shared/lib/domain";
import { pointIdOrOrigin, validateTimelinePointRef } from "./internal/timeline-point";
import type { ExportedAuxSnapshotTree, TimelinePointRef } from "./types";

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
    const name = validateUniqueAuxName(
      tx,
      workspace,
      timelinePointId,
      input.parentDirId,
      input.name,
      undefined,
      "创建辅助文件夹",
    );

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
      name,
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
      invariant(existing, "辅助文件不存在或在当前时间点不可见。");
      invariant(existing.nodeType === "file", "当前辅助信息不是文件，无法写入内容。");
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

    invariant(input.parentDirId, "创建辅助文件时必须指定父文件夹。");
    invariant(input.name, "创建辅助文件时必须填写名称。");
    validateAuxParent(tx, workspace, timelinePointId, input.parentDirId);
    const name = validateUniqueAuxName(
      tx,
      workspace,
      timelinePointId,
      input.parentDirId,
      input.name,
      undefined,
      "创建辅助文件",
    );

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
      name,
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
    const name = validateUniqueAuxName(
      tx,
      workspace,
      timelinePointId,
      input.parentDirId,
      input.name,
      undefined,
      "创建辅助符号链接",
    );
    const target = readAuxByIdAtInternal(tx, workspace, timelinePointId, input.targetNodeId);
    invariant(target, "符号链接目标不存在或在当前时间点不可见。");

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
      name,
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
    invariant(current, "辅助信息不存在或在当前时间点不可见。");
    invariant(current.id !== auxRootId, "无法移动隐藏的辅助信息根节点。");
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
    invariant(!subtree.has(input.newParentDirId), "无法移动：不能把辅助信息移动到自己的子节点下。");
    const newName = validateUniqueAuxName(
      tx,
      workspace,
      timelinePointId,
      input.newParentDirId,
      input.newName,
      current.id,
      "重命名辅助信息",
    );

    putAuxLayer(tx, {
      workspaceId: workspace.id,
      timelinePointId,
      auxNodeId: current.id,
      isDeleted: false,
      parentAuxNodeId: input.newParentDirId,
      name: newName,
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
    invariant(current, "辅助信息不存在或在当前时间点不可见。");
    invariant(current.id !== auxRootId, "无法删除隐藏的辅助信息根节点。");

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

    gcOrphanAuxNodes(tx, workspace.id);
    touchWorkspace(tx, workspace.id);
  });
}

export function restoreAuxNodeAt(input: {
  workspaceId: string;
  timelinePointId?: TimelinePointRef;
  nodeId: string;
}) {
  return db.transaction((tx) => {
    const workspace = getWorkspaceOrThrow(tx, input.workspaceId);
    const timelinePointId = validateTimelinePointRef(tx, workspace.id, input.timelinePointId);
    invariant(timelinePointId, "原点没有可恢复的辅助信息改动。");
    const point = getTimelinePointOrThrow(tx, workspace.id, timelinePointId);

    const layer = tx
      .select({ id: schema.auxNodeLayers.id })
      .from(schema.auxNodeLayers)
      .where(
        and(
          eq(schema.auxNodeLayers.workspaceId, workspace.id),
          eq(schema.auxNodeLayers.timelinePointId, timelinePointId),
          eq(schema.auxNodeLayers.auxNodeId, input.nodeId),
        ),
      )
      .get();
    invariant(layer, "未找到这个时间点上的辅助信息改动。");

    const currentSnapshot = buildReachableAuxSnapshot(tx, workspace, timelinePointId);
    const previousSnapshot = buildReachableAuxSnapshot(tx, workspace, point.prevPointId);
    const restored = previousSnapshot.get(input.nodeId) ?? null;
    if (restored?.parentAuxNodeId && restored.name) {
      for (const pointId of listAffectedAuxSnapshotPointIds(tx, workspace.id, timelinePointId)) {
        const snapshot =
          pointId === timelinePointId
            ? currentSnapshot
            : buildReachableAuxSnapshot(tx, workspace, pointId);
        validateUniqueAuxNameInSnapshot(
          snapshot,
          restored.parentAuxNodeId,
          restored.name,
          restored.id,
          "恢复辅助信息",
          pointId == null ? "原点" : getTimelinePointOrThrow(tx, workspace.id, pointId).label,
        );
      }
    }

    tx.delete(schema.auxNodeLayers).where(eq(schema.auxNodeLayers.id, layer.id)).run();
    gcOrphanAuxNodes(tx, workspace.id);
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
  invariant(dirId, "必须指定要读取的辅助信息文件夹。");
  const dir = snapshot.get(dirId);
  invariant(dir, "辅助信息文件夹不存在或在当前时间点不可见。");
  invariant(dir.nodeType === "dir" || dir.nodeType === "root", "目标辅助信息不是文件夹。");

  return listChildrenFromSnapshot(snapshot, dir.id);
}

export function listAuxChangesAt(workspaceId: string, pointId: TimelinePointRef) {
  const workspace = getWorkspaceOrThrow(db, workspaceId);
  const timelinePointId = validateTimelinePointRef(db, workspace.id, pointId);
  invariant(timelinePointId, "原点没有辅助信息改动列表。");
  return listAuxLayerChangesAtTimelinePoint(db, workspace, timelinePointId);
}

export function exportAuxSnapshotTree(workspaceId: string, pointId?: TimelinePointRef) {
  const workspace = getWorkspaceOrThrow(db, workspaceId);
  const auxRootId = assertAuxRoot(workspace);
  const timelinePointId = validateTimelinePointRef(db, workspace.id, pointId);
  const snapshot = buildReachableAuxSnapshot(db, workspace, timelinePointId);
  const changedNodeIds = collectChangedAuxNodeIds(db, workspace.id, snapshot, timelinePointId);
  const deletedNodeIds = collectDeletedAuxNodeIds(db, workspace.id, timelinePointId);
  const previousSnapshot = timelinePointId
    ? buildReachableAuxSnapshot(
        db,
        workspace,
        getTimelinePointOrThrow(db, workspace.id, timelinePointId).prevPointId,
      )
    : null;

  return {
    rootNodeId: auxRootId,
    timelinePointId: pointIdOrOrigin(timelinePointId),
    nodes: exportAuxChildren(snapshot, auxRootId, changedNodeIds, {
      previousSnapshot,
      deletedNodeIds,
    }),
  } satisfies ExportedAuxSnapshotTree;
}
