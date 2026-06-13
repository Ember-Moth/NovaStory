import { eq } from "drizzle-orm";

import { db, schema } from "@/db";
import { ORIGIN_TIMELINE_POINT_ID } from "@/modules/workspace/domain/constants";
import { createId, invariant, now } from "@/shared/lib/domain";

import type {
  AuxDirListTreeNode,
  AuxTimelineChangeSummary,
  AuxTimelineChangeView,
  ExportedAuxSnapshotTree,
  ResolvedAuxSnapshotNode,
  TimelinePointRef,
} from "./types";
import { getWorkspace } from "./lifecycle";
import {
  assertTimelinePoint,
  normalizePointId,
  pointIdOrOrigin,
  readAuxContent,
  readWorktreeState,
  writeAuxContent,
  writeWorktreeStateSync,
} from "./git-storage/worktree-state";
import type { AuxLayerMetaRow } from "./git-storage/types";
import type { WorktreeState } from "./git-storage/worktree-state";

export { ORIGIN_TIMELINE_POINT_ID };

function touchWorkspace(workspaceId: string) {
  db.update(schema.workspaces)
    .set({ updatedAt: now() })
    .where(eq(schema.workspaces.id, workspaceId))
    .run();
}

export function normalizeTimelinePointId(pointId: TimelinePointRef) {
  return normalizePointId(pointId) ?? ORIGIN_TIMELINE_POINT_ID;
}

function pointOrder(state: WorktreeState, pointId: string | null) {
  if (pointId == null) return 0;
  const index = state.timeline.findIndex((point) => point.id === pointId);
  return index < 0 ? -1 : index + 1;
}

function layerVisibleAt(state: WorktreeState, layer: AuxLayerMetaRow, pointId: string | null) {
  const targetOrder = pointOrder(state, pointId);
  const layerOrder = pointOrder(state, layer.timelinePointId);
  return layerOrder >= 0 && layerOrder <= targetOrder;
}

function latestLayersAt(state: WorktreeState, pointId: string | null) {
  const byNode = new Map<string, AuxLayerMetaRow>();
  for (const layer of state.auxLayers) {
    if (!layerVisibleAt(state, layer, pointId)) continue;
    const current = byNode.get(layer.auxNodeId);
    if (
      !current ||
      pointOrder(state, current.timelinePointId) <= pointOrder(state, layer.timelinePointId)
    ) {
      byNode.set(layer.auxNodeId, layer);
    }
  }
  return byNode;
}

function buildSnapshot(workspaceId: string, pointId: TimelinePointRef) {
  const workspace = getWorkspace(workspaceId);
  const state = readWorktreeState(workspace.worktreePath);
  const normalizedPointId = assertTimelinePoint(state, pointId);
  const layers = latestLayersAt(state, normalizedPointId);
  const reachable = new Map<string, ResolvedAuxSnapshotNode>();

  const resolvePath = (nodeId: string): string | null => {
    if (nodeId === workspace.auxRootId) return "/";
    const layer = layers.get(nodeId);
    if (!layer || layer.isDeleted || !layer.name) return null;
    const parentPath = resolvePath(layer.parentAuxNodeId ?? workspace.auxRootId);
    if (!parentPath) return null;
    return parentPath === "/" ? `/${layer.name}` : `${parentPath}/${layer.name}`;
  };

  for (const [nodeId, layer] of layers) {
    if (layer.isDeleted) continue;
    const path = resolvePath(nodeId);
    if (!path) continue;
    reachable.set(nodeId, {
      id: nodeId,
      nodeType: layer.nodeType,
      parentAuxNodeId: layer.parentAuxNodeId,
      name: layer.name,
      content: readAuxContent(workspace.worktreePath, layer),
      symlinkTargetAuxNodeId: layer.symlinkTargetAuxNodeId,
      timelinePointId: pointIdOrOrigin(layer.timelinePointId),
      path,
      reachable: true,
    });
  }

  return { workspace, state, pointId: normalizedPointId, snapshot: reachable };
}

function findChildName(
  snapshot: Map<string, ResolvedAuxSnapshotNode>,
  parentId: string,
  name: string,
  except?: string,
) {
  return [...snapshot.values()].find(
    (node) => node.parentAuxNodeId === parentId && node.name === name && node.id !== except,
  );
}

function addLayer(state: WorktreeState, layer: Omit<AuxLayerMetaRow, "id">) {
  const row: AuxLayerMetaRow = { ...layer, id: createId("aux_layer") };
  state.auxLayers.push(row);
  return row;
}

export function mkdirAt(input: {
  workspaceId: string;
  timelinePointId?: TimelinePointRef;
  parentDirId: string;
  name: string;
}) {
  const { workspace, state, pointId, snapshot } = buildSnapshot(
    input.workspaceId,
    input.timelinePointId,
  );
  const parent = snapshot.get(input.parentDirId);
  invariant(parent?.nodeType === "root" || parent?.nodeType === "dir", "父节点不是文件夹。");
  invariant(!findChildName(snapshot, input.parentDirId, input.name), "同名辅助信息已存在。");
  const nodeId = createId("aux");
  addLayer(state, {
    auxNodeId: nodeId,
    nodeType: "dir",
    timelinePointId: pointId,
    isDeleted: false,
    parentAuxNodeId: input.parentDirId,
    name: input.name,
    contentPath: null,
    symlinkTargetAuxNodeId: null,
  });
  writeWorktreeStateSync(workspace.worktreePath, state);
  touchWorkspace(workspace.id);
  return {
    id: nodeId,
    workspaceId: workspace.id,
    nodeType: "dir",
    createdAt: now(),
    updatedAt: now(),
  };
}

export function writeFileAt(input: {
  workspaceId: string;
  timelinePointId?: TimelinePointRef;
  parentDirId?: string;
  name?: string;
  nodeId?: string;
  content: string;
}) {
  const { workspace, state, pointId, snapshot } = buildSnapshot(
    input.workspaceId,
    input.timelinePointId,
  );
  let nodeId = input.nodeId;
  let parentAuxNodeId: string;
  let name: string;
  if (nodeId) {
    const existing = snapshot.get(nodeId);
    invariant(existing?.nodeType === "file", "当前辅助信息不是文件，无法写入内容。");
    parentAuxNodeId = existing.parentAuxNodeId!;
    name = existing.name!;
  } else {
    invariant(input.parentDirId, "创建辅助文件时必须指定父文件夹。");
    invariant(input.name, "创建辅助文件时必须填写名称。");
    const parent = snapshot.get(input.parentDirId);
    invariant(parent?.nodeType === "root" || parent?.nodeType === "dir", "父节点不是文件夹。");
    invariant(!findChildName(snapshot, input.parentDirId, input.name), "同名辅助信息已存在。");
    nodeId = createId("aux");
    parentAuxNodeId = input.parentDirId;
    name = input.name;
  }
  const layer = addLayer(state, {
    auxNodeId: nodeId,
    nodeType: "file",
    timelinePointId: pointId,
    isDeleted: false,
    parentAuxNodeId,
    name,
    contentPath: null,
    symlinkTargetAuxNodeId: null,
  });
  writeAuxContent(workspace.worktreePath, layer, input.content);
  writeWorktreeStateSync(workspace.worktreePath, state);
  touchWorkspace(workspace.id);
  return {
    id: nodeId,
    workspaceId: workspace.id,
    nodeType: "file",
    createdAt: now(),
    updatedAt: now(),
  };
}

export function linkAt(input: {
  workspaceId: string;
  timelinePointId?: TimelinePointRef;
  parentDirId: string;
  name: string;
  targetNodeId: string;
}) {
  const { workspace, state, pointId, snapshot } = buildSnapshot(
    input.workspaceId,
    input.timelinePointId,
  );
  invariant(snapshot.has(input.targetNodeId), "目标辅助信息不存在。");
  invariant(!findChildName(snapshot, input.parentDirId, input.name), "同名辅助信息已存在。");
  const nodeId = createId("aux");
  addLayer(state, {
    auxNodeId: nodeId,
    nodeType: "symlink",
    timelinePointId: pointId,
    isDeleted: false,
    parentAuxNodeId: input.parentDirId,
    name: input.name,
    contentPath: null,
    symlinkTargetAuxNodeId: input.targetNodeId,
  });
  writeWorktreeStateSync(workspace.worktreePath, state);
  touchWorkspace(workspace.id);
  return {
    id: nodeId,
    workspaceId: workspace.id,
    nodeType: "symlink",
    createdAt: now(),
    updatedAt: now(),
  };
}

export function moveAuxNodeAt(input: {
  workspaceId: string;
  timelinePointId?: TimelinePointRef;
  nodeId: string;
  newParentDirId: string;
  newName?: string | null;
}) {
  const { workspace, state, pointId, snapshot } = buildSnapshot(
    input.workspaceId,
    input.timelinePointId,
  );
  const existing = snapshot.get(input.nodeId);
  invariant(existing, "辅助信息不存在。");
  const name = input.newName ?? existing.name;
  invariant(name, "名称不能为空。");
  invariant(
    !findChildName(snapshot, input.newParentDirId, name, input.nodeId),
    "同名辅助信息已存在。",
  );
  const layer = addLayer(state, {
    auxNodeId: existing.id,
    nodeType: existing.nodeType as AuxLayerMetaRow["nodeType"],
    timelinePointId: pointId,
    isDeleted: false,
    parentAuxNodeId: input.newParentDirId,
    name,
    contentPath: null,
    symlinkTargetAuxNodeId: existing.symlinkTargetAuxNodeId,
  });
  writeAuxContent(workspace.worktreePath, layer, existing.content);
  writeWorktreeStateSync(workspace.worktreePath, state);
  touchWorkspace(workspace.id);
  return {
    id: existing.id,
    workspaceId: workspace.id,
    nodeType: existing.nodeType,
    createdAt: now(),
    updatedAt: now(),
  };
}

export function retargetAuxSymlinkAt(input: {
  workspaceId: string;
  timelinePointId?: TimelinePointRef;
  symlinkNodeId: string;
  targetNodeId: string;
}) {
  const { workspace, state, pointId, snapshot } = buildSnapshot(
    input.workspaceId,
    input.timelinePointId,
  );
  const existing = snapshot.get(input.symlinkNodeId);
  invariant(existing?.nodeType === "symlink", "当前辅助信息不是链接。");
  invariant(snapshot.has(input.targetNodeId), "目标辅助信息不存在。");
  addLayer(state, {
    auxNodeId: existing.id,
    nodeType: "symlink",
    timelinePointId: pointId,
    isDeleted: false,
    parentAuxNodeId: existing.parentAuxNodeId,
    name: existing.name,
    contentPath: null,
    symlinkTargetAuxNodeId: input.targetNodeId,
  });
  writeWorktreeStateSync(workspace.worktreePath, state);
  touchWorkspace(workspace.id);
  return {
    id: existing.id,
    workspaceId: workspace.id,
    nodeType: "symlink",
    createdAt: now(),
    updatedAt: now(),
  };
}

export function deleteAuxNodeAt(input: {
  workspaceId: string;
  timelinePointId?: TimelinePointRef;
  nodeId: string;
}) {
  const { workspace, state, pointId, snapshot } = buildSnapshot(
    input.workspaceId,
    input.timelinePointId,
  );
  const existing = snapshot.get(input.nodeId);
  invariant(existing, "辅助信息不存在。");
  addLayer(state, {
    auxNodeId: existing.id,
    nodeType: existing.nodeType as AuxLayerMetaRow["nodeType"],
    timelinePointId: pointId,
    isDeleted: true,
    parentAuxNodeId: existing.parentAuxNodeId,
    name: existing.name,
    contentPath: null,
    symlinkTargetAuxNodeId: existing.symlinkTargetAuxNodeId,
  });
  writeWorktreeStateSync(workspace.worktreePath, state);
  touchWorkspace(workspace.id);
}

export function restoreAuxNodeAt(input: {
  workspaceId: string;
  timelinePointId?: TimelinePointRef;
  nodeId: string;
}) {
  const { workspace, state } = buildSnapshot(input.workspaceId, input.timelinePointId);
  const latest = [...state.auxLayers]
    .reverse()
    .find((layer) => layer.auxNodeId === input.nodeId && layer.isDeleted);
  invariant(latest, "未找到可恢复的辅助信息。");
  state.auxLayers = state.auxLayers.filter((layer) => layer.id !== latest.id);
  writeWorktreeStateSync(workspace.worktreePath, state);
  touchWorkspace(workspace.id);
}

export function readAuxByIdAt(workspaceId: string, pointId: TimelinePointRef, nodeId: string) {
  return buildSnapshot(workspaceId, pointId).snapshot.get(nodeId) ?? null;
}

export function readAuxByPathAt(
  workspaceId: string,
  pointId: TimelinePointRef,
  path: string,
  _options?: { followSymlinks?: boolean },
) {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return (
    [...buildSnapshot(workspaceId, pointId).snapshot.values()].find(
      (node) => node.path === normalized,
    ) ?? null
  );
}

export function listAuxDirAt(
  workspaceId: string,
  pointId: TimelinePointRef,
  input: { dirId?: string; path?: string } = {},
): AuxDirListTreeNode[] {
  const snapshot = buildSnapshot(workspaceId, pointId).snapshot;
  const dir = input.dirId
    ? snapshot.get(input.dirId)
    : input.path
      ? [...snapshot.values()].find((node) => node.path === input.path)
      : [...snapshot.values()].find((node) => node.path === "/");
  invariant(dir, "未找到辅助文件夹。");
  const build = (parentId: string): AuxDirListTreeNode[] =>
    [...snapshot.values()]
      .filter((node) => node.parentAuxNodeId === parentId)
      .sort((a, b) => a.path.localeCompare(b.path))
      .map((node) => ({
        nodeType: node.nodeType,
        name: node.name,
        path: node.path,
        ...(node.symlinkTargetAuxNodeId
          ? { symlinkTargetPath: snapshot.get(node.symlinkTargetAuxNodeId)?.path }
          : {}),
        children: node.nodeType === "dir" || node.nodeType === "root" ? build(node.id) : [],
      }));
  return build(dir.id);
}

export function listAuxTreeAt(
  workspaceId: string,
  pointId: TimelinePointRef,
  input: { dirId?: string; path?: string } = {},
  _options: { depth?: number } = {},
) {
  return { nodes: listAuxDirAt(workspaceId, pointId, input), truncated: false };
}

export function exportAuxSnapshotTree(
  workspaceId: string,
  pointId?: TimelinePointRef,
): ExportedAuxSnapshotTree {
  const { workspace, snapshot } = buildSnapshot(workspaceId, pointId);
  const build = (parentId: string): ExportedAuxSnapshotTree["nodes"] =>
    [...snapshot.values()]
      .filter((node) => node.parentAuxNodeId === parentId)
      .sort((a, b) => a.path.localeCompare(b.path))
      .map((node) => ({
        id: node.id,
        nodeType: node.nodeType,
        parentAuxNodeId: node.parentAuxNodeId,
        name: node.name,
        content: node.content,
        symlinkTargetAuxNodeId: node.symlinkTargetAuxNodeId,
        symlinkTargetPath: node.symlinkTargetAuxNodeId
          ? (snapshot.get(node.symlinkTargetAuxNodeId)?.path ?? null)
          : null,
        timelinePointId: node.timelinePointId,
        path: node.path,
        hasTimelineChange: node.timelinePointId !== ORIGIN_TIMELINE_POINT_ID,
        isDeleted: false,
        children: build(node.id),
      }));
  return {
    rootNodeId: workspace.auxRootId,
    timelinePointId: pointIdOrOrigin(normalizePointId(pointId)),
    nodes: build(workspace.auxRootId),
  };
}

export function listAuxTimelineChangesAt(
  workspaceId: string,
  pointId: TimelinePointRef,
): AuxTimelineChangeView[] {
  const current = buildSnapshot(workspaceId, pointId).snapshot;
  const previousPointId = normalizePointId(pointId);
  const workspace = getWorkspace(workspaceId);
  const state = readWorktreeState(workspace.worktreePath);
  const point = previousPointId ? state.timeline.find((item) => item.id === previousPointId) : null;
  const previous = buildSnapshot(workspaceId, point?.prevPointId ?? null).snapshot;
  const ids = new Set([...current.keys(), ...previous.keys()]);
  ids.delete(workspace.auxRootId);
  const changes: AuxTimelineChangeView[] = [];
  for (const id of ids) {
    const before = previous.get(id);
    const after = current.get(id);
    if (after && !before) {
      changes.push({
        kind: "added",
        nodeId: id,
        nodeType: after.nodeType,
        path: after.path,
        previousPath: null,
        symlinkTargetPath: null,
        previousSymlinkTargetPath: null,
        changedAspects: [],
        isDeleted: false,
      });
      continue;
    }
    if (before && !after) {
      changes.push({
        kind: "deleted",
        nodeId: id,
        nodeType: before.nodeType,
        path: before.path,
        previousPath: null,
        symlinkTargetPath: null,
        previousSymlinkTargetPath: null,
        changedAspects: [],
        isDeleted: true,
      });
      continue;
    }
    if (before && after && JSON.stringify(before) !== JSON.stringify(after)) {
      changes.push({
        kind: "modified",
        nodeId: id,
        nodeType: after.nodeType,
        path: after.path,
        previousPath: before.path === after.path ? null : before.path,
        symlinkTargetPath: null,
        previousSymlinkTargetPath: null,
        changedAspects: ["content"],
        isDeleted: false,
      });
    }
  }
  return changes;
}

export function listAuxChangesAt(workspaceId: string, pointId: TimelinePointRef) {
  return listAuxTimelineChangesAt(workspaceId, pointId).map((change) => ({
    path: change.path,
    isDeleted: change.isDeleted ?? change.kind === "deleted",
  }));
}

export function summarizeAuxTimelineChangesAt(
  workspaceId: string,
  pointId: TimelinePointRef,
): AuxTimelineChangeSummary {
  const changes = listAuxTimelineChangesAt(workspaceId, pointId);
  return {
    hasChanges: changes.length > 0,
    added: changes.filter((change) => change.kind === "added").length,
    modified: changes.filter((change) => change.kind === "modified").length,
    deleted: changes.filter((change) => change.kind === "deleted").length,
    total: changes.length,
  };
}
