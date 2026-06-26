import { ORIGIN_TIMELINE_POINT_ID } from "./constants";
import type { DiffEntry } from "nano-git";
import type { SHA1 } from "nano-git";
import type { VirtualWorkdir } from "nano-git/workdir/core";

import { getBranch, getBranchHeadCommitId } from "./branches";
import { readFilesAtCommit, readWorkdirDiff, getBranchMapping } from "./git-storage/git-store";
import { getWorkdirForBranch } from "./git-storage/git-store";
import {
  flattenManuscriptNodes,
  orderTimelineRows,
  pointIdOrOrigin,
  readWorktreeStateFromFiles,
  readWorktreeStateFromWorkdir,
} from "./git-storage/worktree-state";
import { getWorkspaceForBranchId } from "./lifecycle";
import type {
  ContentChangeAspect,
  TimelineChangeAspect,
  WorkingTreeContentChangeItem,
  WorkingTreePathChangeItem,
  WorkingTreeStatus,
  WorkingTreeTimelineChangeItem,
} from "./types";

type FlatContentNode = ReturnType<typeof flattenManuscriptNodes>[number];

type TimelinePointLike = {
  id: string;
  label: string;
  description?: string | null;
  prevPointId?: string | null;
};

export function areaForPath(
  filepath: string,
): keyof Omit<WorkingTreeStatus["areas"], "content"> | "content" {
  if (filepath === "timeline.jsonl") return "timeline";
  if (filepath.startsWith("aux/") || filepath.startsWith("novel-evolver/aux")) return "aux";
  return "content";
}

function normalizeAuxStoragePath(filepath: string) {
  return filepath.startsWith("novel-evolver/") ? filepath.slice("novel-evolver/".length) : filepath;
}

export function shouldIgnoreAuxDiffPath(filepath: string) {
  const normalizedPath = normalizeAuxStoragePath(filepath);
  return normalizedPath === "aux/origin/.gitkeep" || normalizedPath.endsWith("/.gitkeep");
}

export function buildStructuredAuxChange(
  filepath: string,
): Omit<WorkingTreePathChangeItem, "kind"> {
  const normalizedPath = normalizeAuxStoragePath(filepath);
  const originMatch = normalizedPath.match(/^aux\/origin(?:\/(.*))?$/);
  if (originMatch) {
    const path = originMatch[1] ?? "";
    const basename = path.split("/").at(-1) ?? "";
    return {
      label: filepath,
      path,
      timelinePointId: ORIGIN_TIMELINE_POINT_ID,
      timelinePointLabel: "原点",
      isWhiteout: basename.startsWith(".wh."),
      revertable: true,
    };
  }

  const timelineMatch = normalizedPath.match(/^aux\/timeline\/([^/]+)(?:\/(.*))?$/);
  if (timelineMatch) {
    const path = timelineMatch[2] ?? "";
    const basename = path.split("/").at(-1) ?? "";
    return {
      label: filepath,
      path,
      timelinePointId: timelineMatch[1]!,
      timelinePointLabel: timelineMatch[1]!,
      isWhiteout: basename.startsWith(".wh."),
      revertable: true,
    };
  }

  const basename = normalizedPath.split("/").at(-1) ?? "";
  return {
    label: filepath,
    path: normalizedPath,
    timelinePointId: null,
    timelinePointLabel: null,
    isWhiteout: basename.startsWith(".wh."),
    revertable: true,
  };
}

export function diffEntryPathKind(entry: DiffEntry): WorkingTreePathChangeItem["kind"] | null {
  if (entry.kind === "create") return "added";
  if (entry.kind === "remove") return "deleted";
  if (entry.kind === "update") return "modified";
  return null;
}

export function didTimelinePathChange(diff: DiffEntry[]) {
  return diff.some((entry) => entry.path === "timeline.jsonl");
}

export function didContentPathsChange(diff: DiffEntry[]) {
  return diff.some(
    (entry) =>
      entry.path === "index.jsonl" ||
      entry.path === "manuscript" ||
      entry.path.startsWith("manuscript/"),
  );
}

export function isFileLikeDiffEntry(entry: DiffEntry) {
  if (entry.kind === "create") return entry.current.kind !== "tree";
  if (entry.kind === "remove") return entry.previous.kind !== "tree";
  return entry.current.kind !== "tree" || entry.previous.kind !== "tree";
}

function buildTimelinePointNameMap(points: TimelinePointLike[]) {
  const map = new Map<string, string>();
  for (const point of points) {
    map.set(point.id, point.label);
  }
  return map;
}

export function resolveAuxChangeTimelineLabel(
  change: Omit<WorkingTreePathChangeItem, "kind">,
  timelineLabelMap: Map<string, string>,
): Omit<WorkingTreePathChangeItem, "kind"> {
  if (!change.timelinePointId || change.timelinePointId === ORIGIN_TIMELINE_POINT_ID) {
    return change;
  }
  return {
    ...change,
    timelinePointLabel: timelineLabelMap.get(change.timelinePointId) ?? change.timelinePointId,
  };
}

function buildNodeMap(nodes: FlatContentNode[]) {
  return new Map(nodes.map((node) => [node.id, node] as const));
}

function buildTimelineLabelMap(points: TimelinePointLike[]) {
  return new Map(points.map((point) => [point.id, point.label] as const));
}

function buildTimelineRelativeOrderMap(points: TimelinePointLike[], commonIds: Set<string>) {
  const order = new Map<string, number>();
  orderTimelineRows(
    points.map((point) => ({
      id: point.id,
      label: point.label,
      description: point.description ?? null,
      prevPointId: point.prevPointId ?? null,
    })),
  )
    .filter((point) => commonIds.has(point.id))
    .forEach((point, index) => {
      order.set(point.id, index);
    });
  return order;
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

function resolveTimelinePrevLabel(
  labelMap: Map<string, string>,
  pointId: string | typeof ORIGIN_TIMELINE_POINT_ID | null,
) {
  return resolveTimelinePointLabel(labelMap, pointId);
}

export function compareTimelineStates(
  previousTimeline: TimelinePointLike[],
  nextTimeline: TimelinePointLike[],
  nextNodes: FlatContentNode[],
  nextAuxPaths: string[] = [],
): WorkingTreeTimelineChangeItem[] {
  const previousOrdered = orderTimelineRows(
    previousTimeline.map((point) => ({
      id: point.id,
      label: point.label,
      description: point.description ?? null,
      prevPointId: point.prevPointId ?? null,
    })),
  );
  const nextOrdered = orderTimelineRows(
    nextTimeline.map((point) => ({
      id: point.id,
      label: point.label,
      description: point.description ?? null,
      prevPointId: point.prevPointId ?? null,
    })),
  );
  const previousById = new Map(previousOrdered.map((point) => [point.id, point] as const));
  const nextById = new Map(nextOrdered.map((point) => [point.id, point] as const));
  const previousLabels = buildTimelineLabelMap(previousOrdered);
  const nextLabels = buildTimelineLabelMap(nextOrdered);
  const anchoredPointIds = new Set(
    nextNodes
      .map((node) => pointIdOrOrigin(node.anchorTimelinePointId))
      .filter((pointId) => pointId !== ORIGIN_TIMELINE_POINT_ID),
  );
  const auxPointIds = new Set(
    nextAuxPaths.flatMap((path) => {
      const match = path.match(/^aux\/timeline\/([^/]+)(?:\/|$)/);
      return match?.[1] ? [match[1]] : [];
    }),
  );

  const commonIds = new Set<string>();
  for (const id of previousById.keys()) {
    if (nextById.has(id)) {
      commonIds.add(id);
    }
  }
  const previousRelativeOrder = buildTimelineRelativeOrderMap(previousOrdered, commonIds);
  const nextRelativeOrder = buildTimelineRelativeOrderMap(nextOrdered, commonIds);
  const allIds = [...new Set([...previousById.keys(), ...nextById.keys()])].sort((a, b) =>
    a.localeCompare(b),
  );
  const changes: WorkingTreeTimelineChangeItem[] = [];

  for (const pointId of allIds) {
    const previousPoint = previousById.get(pointId);
    const nextPoint = nextById.get(pointId);

    if (!previousPoint && nextPoint) {
      const normalizedPrevPointId = pointIdOrOrigin(nextPoint.prevPointId);
      changes.push({
        pointId,
        label: nextPoint.label,
        kind: "added",
        description: nextPoint.description ?? null,
        prevPointId: normalizedPrevPointId,
        prevPointLabel: resolveTimelinePrevLabel(nextLabels, normalizedPrevPointId),
        changedAspects: ["label", "description", "order"],
        previousLabel: null,
        previousDescription: null,
        previousPrevPointId: null,
        previousPrevPointLabel: null,
        revertable: !anchoredPointIds.has(pointId) && !auxPointIds.has(pointId),
      });
      continue;
    }

    if (previousPoint && !nextPoint) {
      const normalizedPrevPointId = pointIdOrOrigin(previousPoint.prevPointId);
      changes.push({
        pointId,
        label: previousPoint.label,
        kind: "deleted",
        description: previousPoint.description ?? null,
        prevPointId: normalizedPrevPointId,
        prevPointLabel: resolveTimelinePrevLabel(previousLabels, normalizedPrevPointId),
        changedAspects: ["label", "description", "order"],
        previousLabel: previousPoint.label,
        previousDescription: previousPoint.description ?? null,
        previousPrevPointId: normalizedPrevPointId,
        previousPrevPointLabel: resolveTimelinePrevLabel(previousLabels, normalizedPrevPointId),
        revertable: true,
      });
      continue;
    }

    if (!previousPoint || !nextPoint) {
      continue;
    }

    const changedAspects: TimelineChangeAspect[] = [];
    if (previousPoint.label !== nextPoint.label) {
      changedAspects.push("label");
    }
    if ((previousPoint.description ?? null) !== (nextPoint.description ?? null)) {
      changedAspects.push("description");
    }
    if ((previousRelativeOrder.get(pointId) ?? -1) !== (nextRelativeOrder.get(pointId) ?? -1)) {
      changedAspects.push("order");
    }
    if (changedAspects.length === 0) {
      continue;
    }

    const normalizedPrevPointId = pointIdOrOrigin(nextPoint.prevPointId);
    const normalizedPreviousPrevPointId = pointIdOrOrigin(previousPoint.prevPointId);
    changes.push({
      pointId,
      label: nextPoint.label,
      kind: "modified",
      description: nextPoint.description ?? null,
      prevPointId: normalizedPrevPointId,
      prevPointLabel: resolveTimelinePrevLabel(nextLabels, normalizedPrevPointId),
      changedAspects,
      previousLabel: previousPoint.label,
      previousDescription: previousPoint.description ?? null,
      previousPrevPointId: normalizedPreviousPrevPointId,
      previousPrevPointLabel: resolveTimelinePrevLabel(
        previousLabels,
        normalizedPreviousPrevPointId,
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
  const branch = getBranch(projectId, branchId);
  const headCommitId = getBranchHeadCommitId(projectId, branch.name);
  const workspace = getWorkspaceForBranchId(projectId, branch.name);
  if (!workspace) {
    return emptyStatus(headCommitId);
  }

  // 通过 branch-map.json 解析 workdir key
  const workdirKey = getBranchMapping(projectId, branch.name);
  if (!workdirKey) return emptyStatus(headCommitId);
  const wd = getWorkdirForBranch(projectId, workdirKey);
  if (!wd) return emptyStatus(headCommitId);
  return getWorkingTreeStatusFromWorkdir(projectId, branch.name, headCommitId, wd);
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
  const pathDiff = readWorkdirDiff(workdir);
  const state = readWorktreeStateFromWorkdir(workdir);
  const headFiles = headCommitId
    ? readFilesAtCommit({ projectId, commitId: headCommitId as SHA1 })
    : {};
  const headState = headCommitId
    ? readWorktreeStateFromFiles(headFiles)
    : { content: [], timeline: [] };

  const areas: WorkingTreeStatus["areas"] = {
    content: { changed: false, changes: [] },
    timeline: { changed: false, changes: [] },
    aux: { changed: false, changes: [] },
  };

  if (didContentPathsChange(pathDiff)) {
    areas.content.changes = compareContentStates(
      flattenManuscriptNodes(headState),
      flattenManuscriptNodes(state),
      headState.timeline,
      state.timeline,
    );
  }
  const workdirFiles = collectWorkdirFiles(workdir);
  if (didTimelinePathChange(pathDiff)) {
    areas.timeline.changes = compareTimelineStates(
      headState.timeline,
      state.timeline,
      flattenManuscriptNodes(state),
      Object.keys(workdirFiles),
    );
  }
  const timelinePointNameMap = buildTimelinePointNameMap(state.timeline);

  for (const entry of pathDiff) {
    const filepath = entry.path;
    if (!isFileLikeDiffEntry(entry)) continue;
    const areaKey = areaForPath(filepath);
    if (areaKey === "content") continue;
    if (areaKey === "timeline") continue;
    if (shouldIgnoreAuxDiffPath(filepath)) continue;
    const kind = diffEntryPathKind(entry);
    if (!kind) continue;
    areas[areaKey].changes.push({
      ...resolveAuxChangeTimelineLabel(buildStructuredAuxChange(filepath), timelinePointNameMap),
      kind,
    });
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
