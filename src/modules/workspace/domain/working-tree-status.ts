import { ORIGIN_TIMELINE_POINT_ID } from "./constants";
import { getBranch, getBranchHeadCommitId } from "./branches";
import { readFilesAtCommit } from "./git-storage/git-store";
import { getWorkdirForBranch } from "./git-storage/git-store";
import {
  flattenManuscriptNodes,
  pointIdOrOrigin,
  readWorktreeStateFromFiles,
  readWorktreeStateFromWorkdir,
} from "./git-storage/worktree-state";
import { getWorkspaceForBranchId } from "./lifecycle";
import type { VirtualWorkdir } from "nano-git/workdir/core";
import type { ContentChangeAspect, WorkingTreeContentChangeItem, WorkingTreeStatus } from "./types";

type FlatContentNode = ReturnType<typeof flattenManuscriptNodes>[number];

type TimelinePointLike = {
  id: string;
  label: string;
};

export function areaForPath(
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

/**
 * 构建「共同节点」在同级中的相对顺序索引。
 * 对每个 parent 组，仅保留在 previous 和 next 中都存在的节点，然后分配位置索引。
 * 用于判断真正的相对顺序是否发生了变化，而非因新增/删除节点导致的绝对索引偏移。
 */
function buildRelativeOrderMap(
  nodes: FlatContentNode[],
  commonIds: Set<string>,
): Map<string, number> {
  const order = new Map<string, number>();
  const siblingBuckets = new Map<string | null, FlatContentNode[]>();

  for (const node of nodes) {
    if (!commonIds.has(node.id)) continue;
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

function summarizeBodyCharDelta(previousBody: string, nextBody: string) {
  if (previousBody === nextBody) {
    return { added: 0, removed: 0 };
  }

  const a = Array.from(previousBody);
  const b = Array.from(nextBody);
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp = Array.from({ length: rows }, () => Array<number>(cols).fill(0));

  for (let i = 1; i < rows; i++) {
    dp[i]![0] = i;
  }
  for (let j = 1; j < cols; j++) {
    dp[0]![j] = j;
  }

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i]![j] = dp[i - 1]![j - 1]!;
        continue;
      }
      dp[i]![j] = Math.min(dp[i - 1]![j]!, dp[i]![j - 1]!) + 1;
    }
  }

  let i = a.length;
  let j = b.length;
  let added = 0;
  let removed = 0;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      i -= 1;
      j -= 1;
      continue;
    }

    const deleteCost =
      i > 0 ? (dp[i - 1]![j] ?? Number.POSITIVE_INFINITY) : Number.POSITIVE_INFINITY;
    const insertCost =
      j > 0 ? (dp[i]![j - 1] ?? Number.POSITIVE_INFINITY) : Number.POSITIVE_INFINITY;

    if (deleteCost <= insertCost) {
      removed += 1;
      i -= 1;
    } else {
      added += 1;
      j -= 1;
    }
  }

  return { added, removed };
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

function resolveNodePathLabel(
  nodeMap: Map<string, FlatContentNode>,
  parentId: string | null,
): string {
  if (!parentId) {
    return "顶层";
  }

  const segments: string[] = [];
  let currentId: string | null = parentId;
  const seen = new Set<string>();

  while (currentId && !seen.has(currentId)) {
    seen.add(currentId);
    const current = nodeMap.get(currentId);
    if (!current) {
      segments.unshift(currentId);
      break;
    }
    segments.unshift(
      buildContentLabel({
        id: current.id,
        title: current.title,
        parentId: current.parentId,
        anchorTimelinePointId: pointIdOrOrigin(current.anchorTimelinePointId),
      }),
    );
    currentId = current.parentId;
  }

  return segments.length > 0 ? segments.join(" / ") : "顶层";
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

export function compareContentStates(
  previousNodes: FlatContentNode[],
  nextNodes: FlatContentNode[],
  previousTimeline: TimelinePointLike[],
  nextTimeline: TimelinePointLike[],
): WorkingTreeContentChangeItem[] {
  const previousById = buildNodeMap(previousNodes);
  const nextById = buildNodeMap(nextNodes);

  // 对「修改」节点，仅比较共同节点的相对顺序变化，忽略新增/删除导致的绝对索引偏移
  const commonIds = new Set<string>();
  for (const id of previousById.keys()) {
    if (nextById.has(id)) {
      commonIds.add(id);
    }
  }
  const previousRelativeOrder = buildRelativeOrderMap(previousNodes, commonIds);
  const nextRelativeOrder = buildRelativeOrderMap(nextNodes, commonIds);
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
        parentPathLabel: resolveNodePathLabel(nextById, nextNode.parentId),
        anchorTimelinePointId: pointIdOrOrigin(nextNode.anchorTimelinePointId),
        anchorTimelinePointLabel: resolveTimelinePointLabel(
          nextTimelineLabels,
          pointIdOrOrigin(nextNode.anchorTimelinePointId),
        ),
        changedAspects: ["title", "body", "parent", "order", "anchor"],
        bodyCharDelta: { added: Array.from(nextNode.body).length, removed: 0 },
        previousTitle: null,
        previousParentId: null,
        previousParentLabel: null,
        previousParentPathLabel: null,
        previousAnchorTimelinePointId: null,
        previousAnchorTimelinePointLabel: null,
        revertable: true,
      });
      continue;
    }

    if (previousNode && !nextNode) {
      const revertable = previousNode.parentId === null || nextById.has(previousNode.parentId);
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
        parentPathLabel: resolveNodePathLabel(previousById, previousNode.parentId),
        anchorTimelinePointId: pointIdOrOrigin(previousNode.anchorTimelinePointId),
        anchorTimelinePointLabel: resolveTimelinePointLabel(
          previousTimelineLabels,
          pointIdOrOrigin(previousNode.anchorTimelinePointId),
        ),
        changedAspects: ["title", "body", "parent", "order", "anchor"],
        bodyCharDelta: { added: 0, removed: Array.from(previousNode.body).length },
        previousTitle: previousNode.title,
        previousParentId: previousNode.parentId,
        previousParentLabel: resolveParentLabel(previousById, previousNode.parentId),
        previousParentPathLabel: resolveNodePathLabel(previousById, previousNode.parentId),
        previousAnchorTimelinePointId: pointIdOrOrigin(previousNode.anchorTimelinePointId),
        previousAnchorTimelinePointLabel: resolveTimelinePointLabel(
          previousTimelineLabels,
          pointIdOrOrigin(previousNode.anchorTimelinePointId),
        ),
        revertable,
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
    if ((previousRelativeOrder.get(nodeId) ?? -1) !== (nextRelativeOrder.get(nodeId) ?? -1)) {
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
      parentPathLabel: resolveNodePathLabel(nextById, nextNode.parentId),
      anchorTimelinePointId: pointIdOrOrigin(nextNode.anchorTimelinePointId),
      anchorTimelinePointLabel: resolveTimelinePointLabel(
        nextTimelineLabels,
        pointIdOrOrigin(nextNode.anchorTimelinePointId),
      ),
      changedAspects,
      bodyCharDelta: changedAspects.includes("body")
        ? summarizeBodyCharDelta(previousNode.body, nextNode.body)
        : null,
      previousTitle: previousNode.title,
      previousParentId: previousNode.parentId,
      previousParentLabel: resolveParentLabel(previousById, previousNode.parentId),
      previousParentPathLabel: resolveNodePathLabel(previousById, previousNode.parentId),
      previousAnchorTimelinePointId: pointIdOrOrigin(previousNode.anchorTimelinePointId),
      previousAnchorTimelinePointLabel: resolveTimelinePointLabel(
        previousTimelineLabels,
        pointIdOrOrigin(previousNode.anchorTimelinePointId),
      ),
      revertable: true,
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
    return emptyStatus(headCommitId);
  }

  // Phase 3: VirtualWorkdir-based status (content + timeline + aux all synced)
  const wd = getWorkdirForBranch(branch.projectId, branch.id);
  if (!wd) return emptyStatus(headCommitId);
  return getWorkingTreeStatusFromWorkdir(projectId, branch.id, headCommitId, wd);
}

function emptyStatus(headCommitId: string | null): WorkingTreeStatus {
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

/** VirtualWorkdir-based status: compare workdir state against HEAD commit */
async function getWorkingTreeStatusFromWorkdir(
  projectId: string,
  _branchId: string,
  headCommitId: string | null,
  workdir: VirtualWorkdir,
): Promise<WorkingTreeStatus> {
  const state = readWorktreeStateFromWorkdir(workdir);
  if (!headCommitId && state.content.length === 0 && state.timeline.length === 0) {
    return emptyStatus(null);
  }
  const headFiles = headCommitId
    ? await readFilesAtCommit({ projectId, commitId: headCommitId })
    : {};
  const headState = headCommitId
    ? readWorktreeStateFromFiles(headFiles)
    : { content: [], timeline: [] };

  const areas: WorkingTreeStatus["areas"] = {
    content: { changed: false, changes: [] },
    timeline: { changed: false, changes: [] },
    aux: { changed: false, changes: [] },
  };

  // Content: semantic diff
  areas.content.changes = compareContentStates(
    flattenManuscriptNodes(headState),
    flattenManuscriptNodes(state),
    headState.timeline,
    state.timeline,
  );

  // Timeline & aux: compare workdir files against HEAD files
  const workdirFiles = collectWorkdirFiles(workdir);
  const allPaths = [...new Set([...Object.keys(headFiles), ...Object.keys(workdirFiles)])];
  for (const filepath of allPaths) {
    const areaKey = areaForPath(filepath);
    if (areaKey === "content") continue;
    const headContent = headFiles[filepath];
    const wdContent = workdirFiles[filepath];
    if (headContent === undefined && wdContent !== undefined) {
      areas[areaKey].changes.push({ label: filepath, kind: "added" });
    } else if (headContent !== undefined && wdContent === undefined) {
      areas[areaKey].changes.push({ label: filepath, kind: "deleted" });
    } else if (headContent !== wdContent) {
      areas[areaKey].changes.push({ label: filepath, kind: "modified" });
    }
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

/** Collect all blob paths and their content from a VirtualWorkdir. */
function collectWorkdirFiles(workdir: VirtualWorkdir): Record<string, string> {
  const files: Record<string, string> = {};
  function walk(dirPath: string) {
    for (const entry of workdir.readdir(dirPath)) {
      const fullPath = dirPath ? `${dirPath}/${entry.name}` : entry.name;
      if (entry.kind === "blob") {
        files[fullPath] = workdir.readFile(fullPath).toString("utf8");
      } else if (entry.kind === "tree") {
        walk(fullPath);
      }
    }
  }
  try {
    walk("");
  } catch {
    // empty workdir
  }
  return files;
}
