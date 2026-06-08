import { and, eq } from "drizzle-orm";

import { db, schema } from "@/db";

import {
  assertAuxRoot,
  getAuxNodeOrThrow,
  getTimelinePointOrThrow,
  getWorkspaceOrThrow,
  touchWorkspace,
} from "../internal/access";
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
} from "../internal/aux-snapshot";
import { createId, invariant, now } from "../internal/ids";
import { pointIdOrOrigin, validateTimelinePointRef } from "../internal/timeline-point";
import type { ExportedAuxSnapshotTree, TimelinePointRef } from "../types";

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
    invariant(timelinePointId, "Cannot restore auxiliary changes at implicit origin");
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
    invariant(layer, `Aux change not found: ${input.nodeId}`);

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
  invariant(dirId, "Directory target is required");
  const dir = snapshot.get(dirId);
  invariant(dir, `Directory not found: ${dirId}`);
  invariant(dir.nodeType === "dir" || dir.nodeType === "root", "Target is not a directory");

  return listChildrenFromSnapshot(snapshot, dir.id);
}

export function listAuxChangesAt(workspaceId: string, pointId: TimelinePointRef) {
  const workspace = getWorkspaceOrThrow(db, workspaceId);
  const timelinePointId = validateTimelinePointRef(db, workspace.id, pointId);
  invariant(timelinePointId, "Cannot list auxiliary changes at implicit origin");
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
