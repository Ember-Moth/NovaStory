import fs from "node:fs";

import git from "isomorphic-git";

import { ORIGIN_TIMELINE_POINT_ID } from "./constants";
import { getBranch, getBranchHeadCommitId } from "./branches";
import { branchRef, ensureProjectRepo, readFilesAtCommit } from "./git-storage/git-store";
import {
  flattenManuscriptNodes,
  pointIdOrOrigin,
  readWorktreeState,
  readWorktreeStateFromFiles,
} from "./git-storage/worktree-state";
import { getProjectWorktreeDir } from "./git-storage/paths";
import { getWorkspaceForBranchId } from "./lifecycle";
import type {
  ContentChangeAspect,
  WorkingTreeContentChangeItem,
  WorkingTreePathChangeItem,
  WorkingTreeStatus,
} from "./types";

type FlatContentNode = ReturnType<typeof flattenManuscriptNodes>[number];

type TimelinePointLike = {
  id: string;
  label: string;
};

function kindFromMatrix(head: number, workdir: number): WorkingTreePathChangeItem["kind"] | null {
  if (head === 0 && workdir !== 0) return "added";
  if (head !== 0 && workdir === 0) return "deleted";
  if (head !== workdir) return "modified";
  return null;
}

function areaForPath(
  filepath: string,
): keyof Omit<WorkingTreeStatus["areas"], "content"> | "content" {
  if (filepath === "timeline.jsonl") return "timeline";
  if (filepath.startsWith("aux/") || filepath.startsWith("novel-evolver/aux")) return "aux";
  return "content";
}

function buildNodeMap(nodes: FlatContentNode[]) {
  return new Map(nodes.map((node) => [node.id, node] as const));
}

function buildTimelineLabelMap(points: TimelinePointLike[]) {
  return new Map(points.map((point) => [point.id, point.label] as const));
}

function buildSiblingIndexMap(nodes: FlatContentNode[]) {
  const order = new Map<string, number>();
  const siblingBuckets = new Map<string | null, FlatContentNode[]>();

  for (const node of nodes) {
    const bucket = siblingBuckets.get(node.parentId) ?? [];
    bucket.push(node);
    siblingBuckets.set(node.parentId, bucket);
  }

  for (const bucket of siblingBuckets.values()) {
    bucket.forEach((node, index) => {
      order.set(node.id, index);
    });
  }

  return order;
}

function summarizeBodyChange(previousBody: string, nextBody: string) {
  return previousBody !== nextBody;
}

function buildContentLabel(node: {
  title: string | null;
  id: string;
  parentId: string | null;
  anchorTimelinePointId: string | typeof ORIGIN_TIMELINE_POINT_ID;
}) {
  const title = node.title?.trim();
  if (title) {
    return title;
  }
  return `未命名节点 ${node.id.slice(0, 8)}`;
}

function resolveParentLabel(
  nodeMap: Map<string, FlatContentNode>,
  parentId: string | null,
): string | null {
  if (!parentId) {
    return null;
  }
  const parent = nodeMap.get(parentId);
  if (!parent) {
    return parentId;
  }
  return buildContentLabel({
    id: parent.id,
    title: parent.title,
    parentId: parent.parentId,
    anchorTimelinePointId: pointIdOrOrigin(parent.anchorTimelinePointId),
  });
}

function resolveTimelinePointLabel(
  labelMap: Map<string, string>,
  pointId: string | typeof ORIGIN_TIMELINE_POINT_ID | null,
): string | null {
  if (pointId == null || pointId === ORIGIN_TIMELINE_POINT_ID) {
    return "原点";
  }
  return labelMap.get(pointId) ?? pointId;
}

function compareContentStates(
  previousNodes: FlatContentNode[],
  nextNodes: FlatContentNode[],
  previousTimeline: TimelinePointLike[],
  nextTimeline: TimelinePointLike[],
): WorkingTreeContentChangeItem[] {
  const previousById = buildNodeMap(previousNodes);
  const nextById = buildNodeMap(nextNodes);
  const previousOrder = buildSiblingIndexMap(previousNodes);
  const nextOrder = buildSiblingIndexMap(nextNodes);
  const previousTimelineLabels = buildTimelineLabelMap(previousTimeline);
  const nextTimelineLabels = buildTimelineLabelMap(nextTimeline);

  const allIds = [...new Set([...previousById.keys(), ...nextById.keys()])].sort((a, b) =>
    a.localeCompare(b),
  );
  const changes: WorkingTreeContentChangeItem[] = [];

  for (const nodeId of allIds) {
    const previousNode = previousById.get(nodeId);
    const nextNode = nextById.get(nodeId);

    if (!previousNode && nextNode) {
      changes.push({
        nodeId,
        label: buildContentLabel({
          id: nextNode.id,
          title: nextNode.title,
          parentId: nextNode.parentId,
          anchorTimelinePointId: pointIdOrOrigin(nextNode.anchorTimelinePointId),
        }),
        kind: "added",
        title: nextNode.title,
        parentId: nextNode.parentId,
        parentLabel: resolveParentLabel(nextById, nextNode.parentId),
        anchorTimelinePointId: pointIdOrOrigin(nextNode.anchorTimelinePointId),
        anchorTimelinePointLabel: resolveTimelinePointLabel(
          nextTimelineLabels,
          pointIdOrOrigin(nextNode.anchorTimelinePointId),
        ),
        changedAspects: ["title", "body", "parent", "order", "anchor"],
        previousTitle: null,
        previousParentId: null,
        previousParentLabel: null,
        previousAnchorTimelinePointId: null,
        previousAnchorTimelinePointLabel: null,
      });
      continue;
    }

    if (previousNode && !nextNode) {
      changes.push({
        nodeId,
        label: buildContentLabel({
          id: previousNode.id,
          title: previousNode.title,
          parentId: previousNode.parentId,
          anchorTimelinePointId: pointIdOrOrigin(previousNode.anchorTimelinePointId),
        }),
        kind: "deleted",
        title: previousNode.title,
        parentId: previousNode.parentId,
        parentLabel: resolveParentLabel(previousById, previousNode.parentId),
        anchorTimelinePointId: pointIdOrOrigin(previousNode.anchorTimelinePointId),
        anchorTimelinePointLabel: resolveTimelinePointLabel(
          previousTimelineLabels,
          pointIdOrOrigin(previousNode.anchorTimelinePointId),
        ),
        changedAspects: ["title", "body", "parent", "order", "anchor"],
        previousTitle: previousNode.title,
        previousParentId: previousNode.parentId,
        previousParentLabel: resolveParentLabel(previousById, previousNode.parentId),
        previousAnchorTimelinePointId: pointIdOrOrigin(previousNode.anchorTimelinePointId),
        previousAnchorTimelinePointLabel: resolveTimelinePointLabel(
          previousTimelineLabels,
          pointIdOrOrigin(previousNode.anchorTimelinePointId),
        ),
      });
      continue;
    }

    if (!previousNode || !nextNode) {
      continue;
    }

    const changedAspects: ContentChangeAspect[] = [];
    if (previousNode.title !== nextNode.title) {
      changedAspects.push("title");
    }
    if (summarizeBodyChange(previousNode.body, nextNode.body)) {
      changedAspects.push("body");
    }
    if (previousNode.parentId !== nextNode.parentId) {
      changedAspects.push("parent");
    }
    if ((previousOrder.get(nodeId) ?? -1) !== (nextOrder.get(nodeId) ?? -1)) {
      changedAspects.push("order");
    }
    if (
      pointIdOrOrigin(previousNode.anchorTimelinePointId) !==
      pointIdOrOrigin(nextNode.anchorTimelinePointId)
    ) {
      changedAspects.push("anchor");
    }

    if (changedAspects.length === 0) {
      continue;
    }

    changes.push({
      nodeId,
      label: buildContentLabel({
        id: nextNode.id,
        title: nextNode.title,
        parentId: nextNode.parentId,
        anchorTimelinePointId: pointIdOrOrigin(nextNode.anchorTimelinePointId),
      }),
      kind: "modified",
      title: nextNode.title,
      parentId: nextNode.parentId,
      parentLabel: resolveParentLabel(nextById, nextNode.parentId),
      anchorTimelinePointId: pointIdOrOrigin(nextNode.anchorTimelinePointId),
      anchorTimelinePointLabel: resolveTimelinePointLabel(
        nextTimelineLabels,
        pointIdOrOrigin(nextNode.anchorTimelinePointId),
      ),
      changedAspects,
      previousTitle: previousNode.title,
      previousParentId: previousNode.parentId,
      previousParentLabel: resolveParentLabel(previousById, previousNode.parentId),
      previousAnchorTimelinePointId: pointIdOrOrigin(previousNode.anchorTimelinePointId),
      previousAnchorTimelinePointLabel: resolveTimelinePointLabel(
        previousTimelineLabels,
        pointIdOrOrigin(previousNode.anchorTimelinePointId),
      ),
    });
  }

  return changes.sort((a, b) => {
    if (a.kind !== b.kind) {
      const rank = { modified: 0, added: 1, deleted: 2 } as const;
      return rank[a.kind] - rank[b.kind];
    }
    return a.label.localeCompare(b.label);
  });
}

export async function getWorkingTreeStatus(
  projectId: string,
  branchId: string,
): Promise<WorkingTreeStatus> {
  const branch = await getBranch(projectId, branchId);
  const headCommitId = await getBranchHeadCommitId(projectId, branch.id);
  const workspace = await getWorkspaceForBranchId(projectId, branch.id);
  if (!workspace) {
    return {
      hasChanges: false,
      headCommitId,
      areas: {
        content: { changed: false, changes: [] },
        timeline: { changed: false, changes: [] },
        aux: { changed: false, changes: [] },
      },
    };
  }

  const worktreePath = getProjectWorktreeDir(workspace.projectId, workspace.id);
  const gitdir = await ensureProjectRepo(branch.projectId);
  const matrix = await git.statusMatrix({
    fs,
    dir: worktreePath,
    gitdir,
    ref: branchRef(branch.id),
  });
  const state = readWorktreeState(worktreePath);
  if (!headCommitId && state.content.length === 0 && state.timeline.length === 0) {
    return {
      hasChanges: false,
      headCommitId: null,
      areas: {
        content: { changed: false, changes: [] },
        timeline: { changed: false, changes: [] },
        aux: { changed: false, changes: [] },
      },
    };
  }

  const contentFileChanges = matrix.filter(([filepath, head, workdir]) => {
    const kind = kindFromMatrix(head, workdir);
    return kind != null && areaForPath(filepath) === "content";
  });

  const areas: WorkingTreeStatus["areas"] = {
    content: { changed: false, changes: [] },
    timeline: { changed: false, changes: [] },
    aux: { changed: false, changes: [] },
  };

  if (contentFileChanges.length > 0) {
    const previousState = headCommitId
      ? readWorktreeStateFromFiles(await readFilesAtCommit({ projectId, commitId: headCommitId }))
      : { content: [], timeline: [] };
    areas.content.changes = compareContentStates(
      flattenManuscriptNodes(previousState),
      flattenManuscriptNodes(state),
      previousState.timeline,
      state.timeline,
    );
  }

  for (const [filepath, head, workdir] of matrix) {
    const kind = kindFromMatrix(head, workdir);
    if (!kind) continue;
    const areaKey = areaForPath(filepath);
    if (areaKey === "content") {
      continue;
    }
    areas[areaKey].changes.push({ label: filepath, kind });
  }

  for (const area of Object.values(areas)) {
    area.changes.sort((a, b) => a.label.localeCompare(b.label));
    area.changed = area.changes.length > 0;
  }

  return {
    hasChanges: Object.values(areas).some((area) => area.changed),
    headCommitId,
    areas,
  };
}
