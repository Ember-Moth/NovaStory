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
import type {
  AuxDirListTreeNode,
  AuxTimelineChangeSummary,
  AuxTimelineChangeView,
  AuxTimelineModifiedAspect,
  ExportedAuxSnapshotTree,
  ResolvedAuxSnapshotNode,
  TimelinePointRef,
} from "./types";

function emptyAuxTimelineChangeSummary(): AuxTimelineChangeSummary {
  return {
    hasChanges: false,
    added: 0,
    modified: 0,
    deleted: 0,
    total: 0,
  };
}

function summarizeAuxTimelineChanges(changes: AuxTimelineChangeView[]): AuxTimelineChangeSummary {
  const summary = emptyAuxTimelineChangeSummary();

  for (const change of changes) {
    summary[change.kind] += 1;
    summary.total += 1;
  }

  summary.hasChanges = summary.total > 0;
  return summary;
}

function resolveSymlinkTargetPath(
  snapshot: Map<string, ResolvedAuxSnapshotNode>,
  node: ResolvedAuxSnapshotNode,
) {
  return node.symlinkTargetAuxNodeId
    ? (snapshot.get(node.symlinkTargetAuxNodeId)?.path ?? null)
    : null;
}

function compareAuxTimelineNode(
  previousNode: ResolvedAuxSnapshotNode,
  currentNode: ResolvedAuxSnapshotNode,
  previousSnapshot: Map<string, ResolvedAuxSnapshotNode>,
  currentSnapshot: Map<string, ResolvedAuxSnapshotNode>,
): AuxTimelineChangeView | null {
  const changedAspects: AuxTimelineModifiedAspect[] = [];

  if (previousNode.nodeType !== currentNode.nodeType) {
    changedAspects.push("node_type");
  }
  if (previousNode.path !== currentNode.path) {
    changedAspects.push("path");
  }
  if (previousNode.content !== currentNode.content) {
    changedAspects.push("content");
  }
  if (previousNode.symlinkTargetAuxNodeId !== currentNode.symlinkTargetAuxNodeId) {
    changedAspects.push("symlink_target");
  }

  if (changedAspects.length === 0) {
    return null;
  }

  return {
    kind: "modified",
    nodeId: currentNode.id,
    nodeType: currentNode.nodeType,
    path: currentNode.path,
    previousPath: previousNode.path === currentNode.path ? null : previousNode.path,
    symlinkTargetPath: resolveSymlinkTargetPath(currentSnapshot, currentNode),
    previousSymlinkTargetPath: resolveSymlinkTargetPath(previousSnapshot, previousNode),
    changedAspects,
  };
}

function listAuxTimelineChangesFromSnapshots(input: {
  auxRootId: string;
  previousSnapshot: Map<string, ResolvedAuxSnapshotNode>;
  currentSnapshot: Map<string, ResolvedAuxSnapshotNode>;
}) {
  const changes: AuxTimelineChangeView[] = [];
  const allNodeIds = new Set([...input.previousSnapshot.keys(), ...input.currentSnapshot.keys()]);

  allNodeIds.delete(input.auxRootId);

  for (const nodeId of allNodeIds) {
    const previousNode = input.previousSnapshot.get(nodeId);
    const currentNode = input.currentSnapshot.get(nodeId);

    if (previousNode && !currentNode) {
      changes.push({
        kind: "deleted",
        nodeId: previousNode.id,
        nodeType: previousNode.nodeType,
        path: previousNode.path,
        previousPath: null,
        symlinkTargetPath: null,
        previousSymlinkTargetPath: resolveSymlinkTargetPath(input.previousSnapshot, previousNode),
        changedAspects: [],
      });
      continue;
    }

    if (!previousNode && currentNode) {
      changes.push({
        kind: "added",
        nodeId: currentNode.id,
        nodeType: currentNode.nodeType,
        path: currentNode.path,
        previousPath: null,
        symlinkTargetPath: resolveSymlinkTargetPath(input.currentSnapshot, currentNode),
        previousSymlinkTargetPath: null,
        changedAspects: [],
      });
      continue;
    }

    if (!previousNode || !currentNode) {
      continue;
    }

    const modified = compareAuxTimelineNode(
      previousNode,
      currentNode,
      input.previousSnapshot,
      input.currentSnapshot,
    );
    if (modified) {
      changes.push(modified);
    }
  }

  const kindRank: Record<AuxTimelineChangeView["kind"], number> = {
    added: 0,
    modified: 1,
    deleted: 2,
  };

  return changes.sort(
    (left, right) =>
      left.path.localeCompare(right.path) || kindRank[left.kind] - kindRank[right.kind],
  );
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

export function retargetAuxSymlinkAt(input: {
  workspaceId: string;
  timelinePointId?: TimelinePointRef;
  symlinkNodeId: string;
  targetNodeId: string;
}) {
  return db.transaction((tx) => {
    const workspace = getWorkspaceOrThrow(tx, input.workspaceId);
    const timelinePointId = validateTimelinePointRef(tx, workspace.id, input.timelinePointId);
    const current = readAuxByIdAtInternal(tx, workspace, timelinePointId, input.symlinkNodeId);
    invariant(current, "辅助信息不存在或在当前时间点不可见。");
    invariant(current.nodeType === "symlink", "当前辅助信息不是符号链接，无法更新目标。");

    const target = readAuxByIdAtInternal(tx, workspace, timelinePointId, input.targetNodeId);
    invariant(target, "符号链接目标不存在或在当前时间点不可见。");

    const snapshot = buildReachableAuxSnapshot(tx, workspace, timelinePointId);
    const seen = new Set<string>();
    let currentTarget = target;
    while (true) {
      invariant(
        currentTarget.id !== current.id && !seen.has(currentTarget.id),
        "符号链接目标会形成循环，无法保存。",
      );
      seen.add(currentTarget.id);
      if (currentTarget.nodeType !== "symlink" || !currentTarget.symlinkTargetAuxNodeId) {
        break;
      }
      const nextTarget = snapshot.get(currentTarget.symlinkTargetAuxNodeId);
      invariant(nextTarget, "符号链接目标不存在或在当前时间点不可见。");
      currentTarget = nextTarget;
    }

    putAuxLayer(tx, {
      workspaceId: workspace.id,
      timelinePointId,
      auxNodeId: current.id,
      isDeleted: false,
      parentAuxNodeId: current.parentAuxNodeId,
      name: current.name,
      content: current.content,
      symlinkTargetAuxNodeId: target.id,
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

export function readAuxByPathAt(
  workspaceId: string,
  pointId: TimelinePointRef,
  path: string,
  options: { followSymlinks?: boolean } = {},
) {
  const workspace = getWorkspaceOrThrow(db, workspaceId);
  const auxRootId = assertAuxRoot(workspace);
  const timelinePointId = validateTimelinePointRef(db, workspace.id, pointId);
  const snapshot = buildReachableAuxSnapshot(db, workspace, timelinePointId);
  const nodeId = resolveAuxNodeIdFromPath(
    snapshot,
    auxRootId,
    path,
    options.followSymlinks ?? true,
  );
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

function buildAuxDirTreeFromSnapshot(
  snapshot: ReturnType<typeof buildReachableAuxSnapshot>,
  parentId: string,
  remainingDepth: number,
): { nodes: AuxDirListTreeNode[]; truncated: boolean } {
  let truncated = false;

  const nodes = listChildrenFromSnapshot(snapshot, parentId).map((node) => {
    const symlinkTargetPath = node.symlinkTargetAuxNodeId
      ? (snapshot.get(node.symlinkTargetAuxNodeId)?.path ?? null)
      : null;

    if ((node.nodeType === "dir" || node.nodeType === "root") && remainingDepth > 1) {
      const childTree = buildAuxDirTreeFromSnapshot(snapshot, node.id, remainingDepth - 1);
      if (childTree.truncated) {
        truncated = true;
      }
      return {
        nodeType: node.nodeType,
        name: node.name,
        path: node.path,
        children: childTree.nodes,
        ...(symlinkTargetPath ? { symlinkTargetPath } : {}),
      } satisfies AuxDirListTreeNode;
    }

    const hiddenChildrenCount =
      node.nodeType === "dir" || node.nodeType === "root"
        ? listChildrenFromSnapshot(snapshot, node.id).length
        : 0;
    if (hiddenChildrenCount > 0) {
      truncated = true;
    }

    return {
      nodeType: node.nodeType,
      name: node.name,
      path: node.path,
      children: [],
      ...(symlinkTargetPath ? { symlinkTargetPath } : {}),
      ...(hiddenChildrenCount > 0 ? { hiddenChildrenCount } : {}),
    } satisfies AuxDirListTreeNode;
  });

  return {
    nodes,
    truncated,
  };
}

export function listAuxTreeAt(
  workspaceId: string,
  pointId: TimelinePointRef,
  target: { dirId?: string; path?: string },
  options: { depth?: number } = {},
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

  const depth = Math.max(1, Math.trunc(options.depth ?? 2));
  return buildAuxDirTreeFromSnapshot(snapshot, dir.id, depth);
}

export function listAuxChangesAt(workspaceId: string, pointId: TimelinePointRef) {
  const workspace = getWorkspaceOrThrow(db, workspaceId);
  const timelinePointId = validateTimelinePointRef(db, workspace.id, pointId);
  invariant(timelinePointId, "原点没有辅助信息改动列表。");
  return listAuxLayerChangesAtTimelinePoint(db, workspace, timelinePointId);
}

export function listAuxTimelineChangesAt(workspaceId: string, pointId: TimelinePointRef) {
  const workspace = getWorkspaceOrThrow(db, workspaceId);
  const auxRootId = assertAuxRoot(workspace);
  const timelinePointId = validateTimelinePointRef(db, workspace.id, pointId);
  invariant(timelinePointId, "原点没有相对前一个时间线的辅助信息变更。");
  const point = getTimelinePointOrThrow(db, workspace.id, timelinePointId);
  const currentSnapshot = buildReachableAuxSnapshot(db, workspace, timelinePointId);
  const previousSnapshot = buildReachableAuxSnapshot(db, workspace, point.prevPointId);

  return listAuxTimelineChangesFromSnapshots({
    auxRootId,
    previousSnapshot,
    currentSnapshot,
  });
}

export function summarizeAuxTimelineChangesAt(
  workspaceId: string,
  pointId: TimelinePointRef,
): AuxTimelineChangeSummary {
  const workspace = getWorkspaceOrThrow(db, workspaceId);
  const timelinePointId = validateTimelinePointRef(db, workspace.id, pointId);
  if (!timelinePointId) {
    return emptyAuxTimelineChangeSummary();
  }

  return summarizeAuxTimelineChanges(listAuxTimelineChangesAt(workspace.id, timelinePointId));
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
