import { eq } from "drizzle-orm";

import { db, schema } from "@/db";
import { createId, now } from "@/shared/lib/domain";

import { getWorkspace } from "./lifecycle";
import type {
  ExportedContentNode,
  ExportedContentSubtree,
  ManuscriptListNode,
  ManuscriptNodeList,
  ManuscriptNodeRead,
  TimelinePointRef,
} from "./types";
import {
  assertTimelinePoint,
  findManuscriptNode,
  flattenManuscriptNodes,
  insertManuscriptNode,
  listManuscriptChildren,
  moveManuscriptNode,
  pointIdOrOrigin,
  readWorktreeState,
  removeManuscriptNode,
  writeWorktreeStateSync,
} from "./git-storage/worktree-state";
import type { ManuscriptNodeDiskState } from "./git-storage/types";

function touchWorkspace(workspaceId: string) {
  db.update(schema.workspaces)
    .set({ updatedAt: now() })
    .where(eq(schema.workspaces.id, workspaceId))
    .run();
}

function toExportedNode(node: ManuscriptNodeDiskState): ExportedContentNode {
  return {
    id: node.id,
    anchorTimelinePointId: pointIdOrOrigin(node.anchorTimelinePointId),
    title: node.title,
    body: node.body,
    children: node.children
      .slice()
      .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
      .map((child) => toExportedNode(child)),
  };
}

function toListNode(
  node: ManuscriptNodeDiskState,
  depth: number,
): { node: ManuscriptListNode; truncated: boolean } {
  const children = node.children
    .slice()
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));

  if (depth <= 1) {
    return {
      node: {
        id: node.id,
        anchorTimelinePointId: pointIdOrOrigin(node.anchorTimelinePointId),
        title: node.title,
        children: [],
        ...(children.length ? { hiddenChildrenCount: children.length } : {}),
      },
      truncated: children.length > 0,
    };
  }

  let truncated = false;
  const listedChildren = children.map((child) => {
    const listed = toListNode(child, depth - 1);
    truncated ||= listed.truncated;
    return listed.node;
  });

  return {
    node: {
      id: node.id,
      anchorTimelinePointId: pointIdOrOrigin(node.anchorTimelinePointId),
      title: node.title,
      children: listedChildren,
    },
    truncated,
  };
}

export function createContentNode(input: {
  workspaceId: string;
  parentId: string | null;
  afterSiblingId?: string | null;
  anchorPointId?: TimelinePointRef;
  title?: string | null;
  body?: string | null;
}) {
  const workspace = getWorkspace(input.workspaceId);
  const state = readWorktreeState(workspace.worktreePath);
  if (input.parentId) {
    findManuscriptNode(state, input.parentId);
  }
  const anchorTimelinePointId = assertTimelinePoint(state, input.anchorPointId);
  const node: ManuscriptNodeDiskState = {
    id: createId("content"),
    parentId: input.parentId,
    order: 0,
    title: input.title ?? null,
    anchorTimelinePointId,
    body: input.body ?? "",
    dirPath: "",
    children: [],
  };

  insertManuscriptNode(workspace.worktreePath, state, {
    node,
    parentId: input.parentId,
    afterSiblingId: input.afterSiblingId,
  });
  writeWorktreeStateSync(workspace.worktreePath, state);
  touchWorkspace(workspace.id);
  const created = findManuscriptNode(state, node.id);
  return {
    id: created.id,
    parentId: created.parentId,
    order: created.order,
    title: created.title,
    anchorTimelinePointId: created.anchorTimelinePointId,
    workspaceId: workspace.id,
    body: created.body,
    nextSiblingId: null,
  };
}

export function moveContentNode(input: {
  workspaceId: string;
  nodeId: string;
  newParentId: string | null;
  afterSiblingId?: string | null;
}) {
  const workspace = getWorkspace(input.workspaceId);
  const state = readWorktreeState(workspace.worktreePath);
  if (input.newParentId) {
    findManuscriptNode(state, input.newParentId);
  }
  const moved = moveManuscriptNode(workspace.worktreePath, state, {
    nodeId: input.nodeId,
    newParentId: input.newParentId,
    afterSiblingId: input.afterSiblingId,
  });
  writeWorktreeStateSync(workspace.worktreePath, state);
  touchWorkspace(workspace.id);
  const node = findManuscriptNode(state, moved.id);
  return {
    id: node.id,
    parentId: node.parentId,
    order: node.order,
    title: node.title,
    anchorTimelinePointId: node.anchorTimelinePointId,
    workspaceId: workspace.id,
    body: node.body,
    nextSiblingId: null,
  };
}

export function deleteContentNode(input: { workspaceId: string; nodeId: string }) {
  const workspace = getWorkspace(input.workspaceId);
  const state = readWorktreeState(workspace.worktreePath);
  removeManuscriptNode(workspace.worktreePath, state, input.nodeId);
  writeWorktreeStateSync(workspace.worktreePath, state);
  touchWorkspace(workspace.id);
}

export function updateContentNode(input: {
  workspaceId: string;
  nodeId: string;
  anchorPointId?: TimelinePointRef;
  title?: string | null;
  body?: string | null;
}) {
  const workspace = getWorkspace(input.workspaceId);
  const state = readWorktreeState(workspace.worktreePath);
  const node = findManuscriptNode(state, input.nodeId);
  if (input.anchorPointId !== undefined) {
    node.anchorTimelinePointId = assertTimelinePoint(state, input.anchorPointId);
  }
  if (input.title !== undefined) {
    node.title = input.title;
  }
  if (input.body !== undefined) {
    node.body = input.body ?? "";
  }
  writeWorktreeStateSync(workspace.worktreePath, state);
  touchWorkspace(workspace.id);
  return {
    id: node.id,
    parentId: node.parentId,
    order: node.order,
    title: node.title,
    anchorTimelinePointId: node.anchorTimelinePointId,
    workspaceId: workspace.id,
    body: node.body,
    nextSiblingId: null,
  };
}

export function exportContentSubtree(
  workspaceId: string,
  rootNodeId?: string,
): ExportedContentSubtree {
  const workspace = getWorkspace(workspaceId);
  const state = readWorktreeState(workspace.worktreePath);
  const roots = rootNodeId
    ? [findManuscriptNode(state, rootNodeId)]
    : listManuscriptChildren(state, null);
  return {
    nodes: roots.map((node) => toExportedNode(node)),
  };
}

export function listManuscriptNodes(
  workspaceId: string,
  rootNodeId?: string,
  options: { depth?: number } = {},
): ManuscriptNodeList {
  const workspace = getWorkspace(workspaceId);
  const state = readWorktreeState(workspace.worktreePath);
  const roots = rootNodeId
    ? [findManuscriptNode(state, rootNodeId)]
    : listManuscriptChildren(state, null);

  let truncated = false;
  const nodes = roots.map((node) => {
    const listed = toListNode(node, Math.max(1, options.depth ?? 2));
    truncated ||= listed.truncated;
    return listed.node;
  });

  return {
    nodes,
    truncated,
  };
}

export function readManuscriptNode(workspaceId: string, nodeId: string): ManuscriptNodeRead {
  const workspace = getWorkspace(workspaceId);
  const state = readWorktreeState(workspace.worktreePath);
  const node = findManuscriptNode(state, nodeId);
  return {
    id: node.id,
    anchorTimelinePointId: pointIdOrOrigin(node.anchorTimelinePointId),
    title: node.title,
    body: node.body,
    children: node.children
      .slice()
      .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
      .map((child) => toListNode(child, 1).node),
  };
}

export function listAnchoredTimelinePointIds(workspaceId: string) {
  const workspace = getWorkspace(workspaceId);
  const state = readWorktreeState(workspace.worktreePath);
  return new Set(
    flattenManuscriptNodes(state)
      .map((node) => node.anchorTimelinePointId)
      .filter((pointId): pointId is string => Boolean(pointId)),
  );
}
