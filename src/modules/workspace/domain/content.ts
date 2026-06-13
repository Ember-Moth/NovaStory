import { eq } from "drizzle-orm";

import { db, schema } from "@/db";
import { createId, invariant, now } from "@/shared/lib/domain";

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
  pointIdOrOrigin,
  readContentBody,
  readWorktreeState,
  writeContentBody,
  writeWorktreeStateSync,
} from "./git-storage/worktree-state";
import type { ContentMetaRow } from "./git-storage/types";

function touchWorkspace(workspaceId: string) {
  db.update(schema.workspaces)
    .set({ updatedAt: now() })
    .where(eq(schema.workspaces.id, workspaceId))
    .run();
}

function childrenOf(state: { content: ContentMetaRow[] }, parentId: string | null) {
  return state.content
    .filter((node) => node.parentId === parentId)
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
}

function getNode(state: { content: ContentMetaRow[] }, nodeId: string) {
  const node = state.content.find((item) => item.id === nodeId);
  invariant(node, "未找到章节。");
  return node;
}

function reindexSiblings(state: { content: ContentMetaRow[] }, parentId: string | null) {
  childrenOf(state, parentId).forEach((child, index) => {
    child.order = index;
  });
}

export function createContentNode(input: {
  workspaceId: string;
  parentId: string;
  afterSiblingId?: string | null;
  anchorPointId?: TimelinePointRef;
  title?: string | null;
  body?: string | null;
}) {
  const workspace = getWorkspace(input.workspaceId);
  const state = readWorktreeState(workspace.worktreePath);
  getNode(state, input.parentId);
  const anchorTimelinePointId = assertTimelinePoint(state, input.anchorPointId);
  const siblings = childrenOf(state, input.parentId);
  const node: ContentMetaRow = {
    id: createId("content"),
    parentId: input.parentId,
    order: input.afterSiblingId
      ? siblings.findIndex((sibling) => sibling.id === input.afterSiblingId) + 1
      : 0,
    title: input.title ?? null,
    bodyPath: null,
    anchorTimelinePointId,
  };
  if (input.afterSiblingId) {
    invariant(node.order > 0, "无法创建章节：目标位置不在同一个父级下。");
  }
  for (const sibling of siblings) {
    if (sibling.order >= node.order) sibling.order += 1;
  }
  writeContentBody(workspace.worktreePath, node, input.body ?? null);
  state.content.push(node);
  reindexSiblings(state, input.parentId);
  writeWorktreeStateSync(workspace.worktreePath, state);
  touchWorkspace(workspace.id);
  return {
    ...node,
    workspaceId: workspace.id,
    body: readContentBody(workspace.worktreePath, node),
    nextSiblingId: null,
  };
}

export function moveContentNode(input: {
  workspaceId: string;
  nodeId: string;
  newParentId: string;
  afterSiblingId?: string | null;
}) {
  const workspace = getWorkspace(input.workspaceId);
  const state = readWorktreeState(workspace.worktreePath);
  const node = getNode(state, input.nodeId);
  invariant(node.id !== workspace.contentRootId, "无法移动隐藏的正文根节点。");
  getNode(state, input.newParentId);
  const descendants = new Set<string>();
  const collect = (id: string) => {
    for (const child of childrenOf(state, id)) {
      descendants.add(child.id);
      collect(child.id);
    }
  };
  collect(node.id);
  invariant(!descendants.has(input.newParentId), "无法移动：不能把章节移动到自己的子章节下。");
  const oldParentId = node.parentId;
  node.parentId = input.newParentId;
  const siblings = childrenOf(state, input.newParentId).filter((sibling) => sibling.id !== node.id);
  node.order = input.afterSiblingId
    ? siblings.findIndex((sibling) => sibling.id === input.afterSiblingId) + 1
    : 0;
  if (input.afterSiblingId) invariant(node.order > 0, "无法移动：目标位置不在目标父级下。");
  for (const sibling of siblings) {
    if (sibling.order >= node.order) sibling.order += 1;
  }
  reindexSiblings(state, oldParentId);
  reindexSiblings(state, input.newParentId);
  writeWorktreeStateSync(workspace.worktreePath, state);
  touchWorkspace(workspace.id);
  return {
    ...node,
    workspaceId: workspace.id,
    body: readContentBody(workspace.worktreePath, node),
    nextSiblingId: null,
  };
}

export function deleteContentNode(input: { workspaceId: string; nodeId: string }) {
  const workspace = getWorkspace(input.workspaceId);
  const state = readWorktreeState(workspace.worktreePath);
  const node = getNode(state, input.nodeId);
  invariant(node.id !== workspace.contentRootId, "无法删除隐藏的正文根节点。");
  const deleteIds = new Set<string>();
  const collect = (id: string) => {
    deleteIds.add(id);
    for (const child of childrenOf(state, id)) collect(child.id);
  };
  collect(node.id);
  state.content = state.content.filter((item) => !deleteIds.has(item.id));
  reindexSiblings(state, node.parentId);
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
  const node = getNode(state, input.nodeId);
  if (input.anchorPointId !== undefined) {
    node.anchorTimelinePointId = assertTimelinePoint(state, input.anchorPointId);
  }
  if (input.title !== undefined) node.title = input.title;
  if (input.body !== undefined) writeContentBody(workspace.worktreePath, node, input.body);
  writeWorktreeStateSync(workspace.worktreePath, state);
  touchWorkspace(workspace.id);
  return {
    ...node,
    workspaceId: workspace.id,
    body: readContentBody(workspace.worktreePath, node),
    nextSiblingId: null,
  };
}

function exportNode(
  worktreePath: string,
  state: { content: ContentMetaRow[] },
  node: ContentMetaRow,
): ExportedContentNode {
  return {
    id: node.id,
    anchorTimelinePointId: pointIdOrOrigin(node.anchorTimelinePointId),
    title: node.title,
    body: readContentBody(worktreePath, node),
    children: childrenOf(state, node.id).map((child) => exportNode(worktreePath, state, child)),
  };
}

export function exportContentSubtree(
  workspaceId: string,
  rootNodeId?: string,
): ExportedContentSubtree {
  const workspace = getWorkspace(workspaceId);
  const state = readWorktreeState(workspace.worktreePath);
  const targetRootId = rootNodeId ?? workspace.contentRootId;
  const targetNode = getNode(state, targetRootId);
  return {
    rootNodeId: targetRootId,
    isWorkspaceRoot: targetRootId === workspace.contentRootId,
    nodes:
      targetRootId === workspace.contentRootId
        ? childrenOf(state, targetRootId).map((child) =>
            exportNode(workspace.worktreePath, state, child),
          )
        : [exportNode(workspace.worktreePath, state, targetNode)],
  };
}

function listNode(
  state: { content: ContentMetaRow[] },
  node: ContentMetaRow,
  depth: number,
): { node: ManuscriptListNode; truncated: boolean } {
  const children = childrenOf(state, node.id);
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
  const listed = children.map((child) => {
    const result = listNode(state, child, depth - 1);
    truncated ||= result.truncated;
    return result.node;
  });
  return {
    node: {
      id: node.id,
      anchorTimelinePointId: pointIdOrOrigin(node.anchorTimelinePointId),
      title: node.title,
      children: listed,
    },
    truncated,
  };
}

export function listManuscriptNodes(
  workspaceId: string,
  rootNodeId?: string,
  options: { depth?: number } = {},
): ManuscriptNodeList {
  const workspace = getWorkspace(workspaceId);
  const state = readWorktreeState(workspace.worktreePath);
  const targetRootId = rootNodeId ?? workspace.contentRootId;
  const targetNode = getNode(state, targetRootId);
  const roots =
    targetRootId === workspace.contentRootId ? childrenOf(state, targetRootId) : [targetNode];
  let truncated = false;
  const nodes = roots.map((node) => {
    const listed = listNode(state, node, Math.max(1, options.depth ?? 2));
    truncated ||= listed.truncated;
    return listed.node;
  });
  return {
    rootNodeId: targetRootId,
    isWorkspaceRoot: targetRootId === workspace.contentRootId,
    nodes,
    truncated,
  };
}

export function readManuscriptNode(workspaceId: string, nodeId: string): ManuscriptNodeRead {
  const workspace = getWorkspace(workspaceId);
  const state = readWorktreeState(workspace.worktreePath);
  const node = getNode(state, nodeId);
  return {
    id: node.id,
    anchorTimelinePointId: pointIdOrOrigin(node.anchorTimelinePointId),
    title: node.title,
    body: readContentBody(workspace.worktreePath, node),
    children: childrenOf(state, node.id).map((child) => listNode(state, child, 1).node),
  };
}
