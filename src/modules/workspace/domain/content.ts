import { createId, now } from "@/shared/lib/domain";

import { getWorkspace, touchWorkspaceMeta } from "./lifecycle";
import { getProjectWorktreeDir } from "./git-storage/paths";
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

async function touchWorkspace(projectId: string, workspaceId: string) {
  await touchWorkspaceMeta(projectId, workspaceId, now());
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

export async function createContentNode(input: {
  projectId: string;
  workspaceId: string;
  parentId: string | null;
  afterSiblingId?: string | null;
  anchorPointId?: TimelinePointRef;
  title?: string | null;
  body?: string | null;
}) {
  const workspace = await getWorkspace(input.projectId, input.workspaceId);
  const worktreePath = getProjectWorktreeDir(workspace.projectId, workspace.id);
  const state = readWorktreeState(worktreePath);
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

  insertManuscriptNode(worktreePath, state, {
    node,
    parentId: input.parentId,
    afterSiblingId: input.afterSiblingId,
  });
  writeWorktreeStateSync(worktreePath, state);
  await touchWorkspace(workspace.projectId, workspace.id);
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

export async function moveContentNode(input: {
  projectId: string;
  workspaceId: string;
  nodeId: string;
  newParentId: string | null;
  afterSiblingId?: string | null;
}) {
  const workspace = await getWorkspace(input.projectId, input.workspaceId);
  const worktreePath = getProjectWorktreeDir(workspace.projectId, workspace.id);
  const state = readWorktreeState(worktreePath);
  if (input.newParentId) {
    findManuscriptNode(state, input.newParentId);
  }
  const moved = moveManuscriptNode(worktreePath, state, {
    nodeId: input.nodeId,
    newParentId: input.newParentId,
    afterSiblingId: input.afterSiblingId,
  });
  writeWorktreeStateSync(worktreePath, state);
  await touchWorkspace(workspace.projectId, workspace.id);
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

export async function deleteContentNode(input: {
  projectId: string;
  workspaceId: string;
  nodeId: string;
}) {
  const workspace = await getWorkspace(input.projectId, input.workspaceId);
  const worktreePath = getProjectWorktreeDir(workspace.projectId, workspace.id);
  const state = readWorktreeState(worktreePath);
  removeManuscriptNode(worktreePath, state, input.nodeId);
  writeWorktreeStateSync(worktreePath, state);
  await touchWorkspace(workspace.projectId, workspace.id);
}

export async function updateContentNode(input: {
  projectId: string;
  workspaceId: string;
  nodeId: string;
  anchorPointId?: TimelinePointRef;
  title?: string | null;
  body?: string | null;
}) {
  const workspace = await getWorkspace(input.projectId, input.workspaceId);
  const worktreePath = getProjectWorktreeDir(workspace.projectId, workspace.id);
  const state = readWorktreeState(worktreePath);
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
  writeWorktreeStateSync(worktreePath, state);
  await touchWorkspace(workspace.projectId, workspace.id);
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

export async function exportContentSubtree(
  projectId: string,
  workspaceId: string,
  rootNodeId?: string,
): Promise<ExportedContentSubtree> {
  const workspace = await getWorkspace(projectId, workspaceId);
  const state = readWorktreeState(getProjectWorktreeDir(workspace.projectId, workspace.id));
  const roots = rootNodeId
    ? [findManuscriptNode(state, rootNodeId)]
    : listManuscriptChildren(state, null);
  return {
    nodes: roots.map((node) => toExportedNode(node)),
  };
}

export async function listManuscriptNodes(
  projectId: string,
  workspaceId: string,
  rootNodeId?: string,
  options: { depth?: number } = {},
): Promise<ManuscriptNodeList> {
  const workspace = await getWorkspace(projectId, workspaceId);
  const state = readWorktreeState(getProjectWorktreeDir(workspace.projectId, workspace.id));
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

export async function readManuscriptNode(
  projectId: string,
  workspaceId: string,
  nodeId: string,
): Promise<ManuscriptNodeRead> {
  const workspace = await getWorkspace(projectId, workspaceId);
  const state = readWorktreeState(getProjectWorktreeDir(workspace.projectId, workspace.id));
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

export async function listAnchoredTimelinePointIds(projectId: string, workspaceId: string) {
  const workspace = await getWorkspace(projectId, workspaceId);
  const state = readWorktreeState(getProjectWorktreeDir(workspace.projectId, workspace.id));
  return new Set(
    flattenManuscriptNodes(state)
      .map((node) => node.anchorTimelinePointId)
      .filter((pointId): pointId is string => Boolean(pointId)),
  );
}
