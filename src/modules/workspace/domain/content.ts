import { createId, invariant } from "@/shared/lib/domain";

import { getBranch, getBranchHeadCommitId } from "./branches";
import { getWorkspace, getWorkspaceForBranchId, touchWorkspaceMeta } from "./lifecycle";
import { readFilesAtCommit } from "./git-storage/git-store";
import { getWorkdirForBranch } from "./git-storage/nano-git-store";
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
  removeManuscriptNode,
  readWorktreeStateFromFiles,
  readWorktreeStateFromWorkdir,
  removeNodeFromTree,
  writeWorktreeStateToWorkdir,
} from "./git-storage/worktree-state";
import type { ManuscriptNodeDiskState } from "./git-storage/types";
import type { WorktreeState } from "./git-storage/worktree-state";

async function touchWorkspace(projectId: string, workspaceId: string) {
  await touchWorkspaceMeta(projectId, workspaceId);
}

/** 从 VirtualWorkdir 读取状态 */
function readWorkdirState(projectId: string, workspaceId: string): WorktreeState {
  const wd = getWorkdirForBranch(projectId, workspaceId);
  invariant(wd, "工作目录未初始化");
  return readWorktreeStateFromWorkdir(wd);
}

/** 写回 VirtualWorkdir */
function writeWorkdirState(projectId: string, workspaceId: string, state: WorktreeState) {
  const wd = getWorkdirForBranch(projectId, workspaceId);
  invariant(wd, "工作目录未初始化");
  writeWorktreeStateToWorkdir(wd, state);
}

function toExportedNode(node: ManuscriptNodeDiskState): ExportedContentNode {
  return {
    id: node.id,
    anchorTimelinePointId: pointIdOrOrigin(node.anchorTimelinePointId),
    title: node.title,
    body: node.body,
    children: node.children.map((child) => toExportedNode(child)),
  };
}

function toListNode(
  node: ManuscriptNodeDiskState,
  depth: number,
): { node: ManuscriptListNode; truncated: boolean } {
  const children = node.children;

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
  const state = readWorkdirState(workspace.projectId, workspace.id);
  if (input.parentId) {
    findManuscriptNode(state, input.parentId);
  }
  const anchorTimelinePointId = assertTimelinePoint(state, input.anchorPointId);
  const node: ManuscriptNodeDiskState = {
    id: createId("content"),
    parentId: input.parentId,
    title: input.title?.trim() || null,
    anchorTimelinePointId,
    body: input.body ?? "",
    children: [],
  };

  insertManuscriptNode(workspace.id, state, {
    node,
    parentId: input.parentId,
    afterSiblingId: input.afterSiblingId,
  });
  writeWorkdirState(workspace.projectId, workspace.id, state);
  await touchWorkspace(workspace.projectId, workspace.id);
  const created = findManuscriptNode(state, node.id);
  return {
    id: created.id,
    parentId: created.parentId,
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
  const state = readWorkdirState(workspace.projectId, workspace.id);
  if (input.newParentId) {
    findManuscriptNode(state, input.newParentId);
  }
  const moved = moveManuscriptNode(workspace.id, state, {
    nodeId: input.nodeId,
    newParentId: input.newParentId,
    afterSiblingId: input.afterSiblingId,
  });
  writeWorkdirState(workspace.projectId, workspace.id, state);
  await touchWorkspace(workspace.projectId, workspace.id);
  const node = findManuscriptNode(state, moved.id);
  return {
    id: node.id,
    parentId: node.parentId,
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
  const state = readWorkdirState(workspace.projectId, workspace.id);
  removeManuscriptNode(workspace.id, state, input.nodeId);
  writeWorkdirState(workspace.projectId, workspace.id, state);
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
  const state = readWorkdirState(workspace.projectId, workspace.id);
  const node = findManuscriptNode(state, input.nodeId);
  if (input.anchorPointId !== undefined) {
    node.anchorTimelinePointId = assertTimelinePoint(state, input.anchorPointId);
  }
  if (input.title !== undefined) {
    node.title = input.title?.trim() || null;
  }
  if (input.body !== undefined) {
    node.body = input.body ?? "";
  }
  writeWorkdirState(workspace.projectId, workspace.id, state);
  await touchWorkspace(workspace.projectId, workspace.id);
  return {
    id: node.id,
    parentId: node.parentId,
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
  const state = readWorkdirState(workspace.projectId, workspace.id);
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
  const state = readWorkdirState(workspace.projectId, workspace.id);
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
  const state = readWorkdirState(workspace.projectId, workspace.id);
  const node = findManuscriptNode(state, nodeId);
  return {
    id: node.id,
    anchorTimelinePointId: pointIdOrOrigin(node.anchorTimelinePointId),
    title: node.title,
    body: node.body,
    children: node.children.map((child) => toListNode(child, 1).node),
  };
}

export async function listAnchoredTimelinePointIds(projectId: string, workspaceId: string) {
  const workspace = await getWorkspace(projectId, workspaceId);
  const state = readWorkdirState(workspace.projectId, workspace.id);
  return new Set(
    flattenManuscriptNodes(state)
      .map((node) => node.anchorTimelinePointId)
      .filter((pointId): pointId is string => Boolean(pointId)),
  );
}

function cloneNode(node: ManuscriptNodeDiskState): ManuscriptNodeDiskState {
  return {
    id: node.id,
    parentId: node.parentId,
    title: node.title,
    anchorTimelinePointId: node.anchorTimelinePointId,
    body: node.body,
    children: node.children.map((child) => cloneNode(child)),
  };
}

/**
 * 撤回一条正文修改（新增 / 删除 / 修改），将工作树中的该变更恢复至 HEAD 状态。
 *
 * - "added"：从工作树中删除该节点及所有子节点。
 * - "deleted"：从 HEAD 中恢复该节点及其子树，插入至 HEAD 中记录的原始位置。
 * - "modified"：将节点的 title / body / anchorTimelinePointId / parent / order 恢复为 HEAD 的值，
 *   子节点不受影响（子节点变更视为独立变更项）。
 *
 * 对于 "deleted" 类型，如果父节点也在工作树中被删除（即 `revertable` 为 false），
 * 调用方应禁用交互，不传入此类型。
 */
export async function revertContentChange(input: {
  projectId: string;
  branchId: string;
  nodeId: string;
  kind: "added" | "deleted" | "modified";
}) {
  const branch = await getBranch(input.projectId, input.branchId);
  const headCommitId = await getBranchHeadCommitId(input.projectId, branch.id);
  const workspace = await getWorkspaceForBranchId(input.projectId, branch.id);
  invariant(workspace, "该分支没有关联的工作区。");

  const state = readWorkdirState(workspace.projectId, workspace.id);

  // 读取 HEAD 状态作为撤回基线。无 HEAD（空仓库）时previousState为空。
  const previousFiles = headCommitId
    ? await readFilesAtCommit({ projectId: input.projectId, commitId: headCommitId })
    : {};
  const previousState = readWorktreeStateFromFiles(previousFiles);

  if (input.kind === "added") {
    // 新增→删除：直接删除该节点及所有子节点
    removeManuscriptNode(workspace.id, state, input.nodeId);
  } else if (input.kind === "deleted") {
    // 删除→恢复：从 HEAD 中取出节点及其完整子树，插入回 HEAD 中的位置
    const previousNode = findManuscriptNode(previousState, input.nodeId);
    const restored = cloneNode(previousNode);

    const flatCurrent = flattenManuscriptNodes(state);
    invariant(
      restored.parentId === null || flatCurrent.some((n) => n.id === restored.parentId),
      "无法恢复章节：父节点已被删除。",
    );

    const afterSiblingId = findHeadSiblingId(previousState, input.nodeId, flatCurrent);
    insertManuscriptNode(workspace.id, state, {
      node: restored,
      parentId: restored.parentId,
      afterSiblingId,
    });
  } else if (input.kind === "modified") {
    // 修改→恢复：将节点属性覆盖回 HEAD 值。若 parent/order 变了则需先移除再重新插入。
    const previousNode = findManuscriptNode(previousState, input.nodeId);
    const currentNode = findManuscriptNode(state, input.nodeId);

    const parentChanged = currentNode.parentId !== previousNode.parentId;
    const headOrder = siblingIndexInState(previousState, input.nodeId);
    const currentOrder = siblingIndexInState(state, input.nodeId);
    const orderChanged = currentOrder !== headOrder;
    const needsReinsert = parentChanged || orderChanged;

    if (needsReinsert) {
      const removed = removeNodeFromTree(state.content, input.nodeId);
      invariant(removed, "未找到章节。");

      // 还原字段
      removed.title = previousNode.title;
      removed.body = previousNode.body;
      removed.anchorTimelinePointId = previousNode.anchorTimelinePointId;

      // 若 HEAD 中的父节点在当前工作树中已不存在，则保留当前父级
      const flatCurrent = flattenManuscriptNodes(state);
      const headParentExists =
        previousNode.parentId === null || flatCurrent.some((n) => n.id === previousNode.parentId);
      removed.parentId = headParentExists ? previousNode.parentId : currentNode.parentId;

      const afterSiblingId = headParentExists
        ? findHeadSiblingId(previousState, input.nodeId, flatCurrent)
        : null;

      insertManuscriptNode(workspace.id, state, {
        node: removed,
        parentId: removed.parentId,
        afterSiblingId,
      });
    } else {
      // 原地覆盖 title/body/anchor
      currentNode.title = previousNode.title;
      currentNode.body = previousNode.body;
      currentNode.anchorTimelinePointId = previousNode.anchorTimelinePointId;
    }
  }

  writeWorkdirState(workspace.projectId, workspace.id, state);
  await touchWorkspace(workspace.projectId, workspace.id);
}

/** 在 state 中查找 nodeId 在同级中的索引。 */
function siblingIndexInState(state: WorktreeState, nodeId: string): number {
  const node = findManuscriptNode(state, nodeId);
  const siblings =
    node.parentId === null ? state.content : findManuscriptNode(state, node.parentId).children;
  return siblings.findIndex((s) => s.id === nodeId);
}

/**
 * 在 HEAD 快照中查找 nodeId 的前序兄弟，取其中最接近的、且当前工作树仍存在的节点作为插入锚点。
 * 若无合适锚点则返回 null（插入到开头）。
 */
function findHeadSiblingId(
  headState: WorktreeState,
  nodeId: string,
  flatCurrent: ManuscriptNodeDiskState[],
): string | null {
  const node = findManuscriptNode(headState, nodeId);
  const flatPrevious = flattenManuscriptNodes(headState);
  const siblings = flatPrevious.filter((n) => n.parentId === node.parentId);
  const headIndex = siblings.findIndex((n) => n.id === nodeId);

  for (let i = headIndex - 1; i >= 0; i--) {
    const candidate = siblings[i]!;
    if (flatCurrent.some((n) => n.id === candidate.id)) {
      return candidate.id;
    }
  }
  return null;
}
