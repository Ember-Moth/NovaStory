import { type DatabaseExecutor, db } from "@/db";
import { ORIGIN_TIMELINE_POINT_ID } from "@/modules/workspace/domain/constants";
import { invariant } from "@/shared/lib/domain";

import { getBranchOrThrow, getCommitOrThrow, getWorkspaceForBranch } from "./internal/access";
import { getTreeObject } from "./internal/object-store";
import { snapshotWorkspaceState } from "./snapshot";
import type { WorkingTreeAreaSummary, WorkingTreeChangeItem, WorkingTreeStatus } from "./types";

interface ContentTreePayload {
  nodeId: string;
  title: string | null;
  anchorTimelinePointId: string | null;
  bodyBlobId: string | null;
  children: string[];
}

interface TimelinePayload {
  points: Array<{
    id: string;
    label: string;
    description: string | null;
  }>;
}

interface AuxLayerPayload {
  timelinePointId: string | null;
  isDeleted: boolean;
  parentAuxNodeId: string | null;
  name: string | null;
  contentBlobId: string | null;
  symlinkTargetAuxNodeId: string | null;
}

interface AuxNodePayload {
  auxNodeId: string;
  nodeType: string;
  layers: AuxLayerPayload[];
}

interface AuxCollectionPayload {
  rootAuxNodeId: string;
  nodes: string[];
}

interface RootTreePayload {
  contentTreeId: string;
  auxTreeId: string;
  timelineTreeId: string;
}

interface FlatContentNode {
  nodeId: string;
  title: string | null;
  anchorTimelinePointId: string | null;
  bodyBlobId: string | null;
  childNodeIds: string[];
}

interface AuxLayerEntry {
  auxNodeId: string;
  timelinePointId: string | null;
  isDeleted: boolean;
  parentAuxNodeId: string | null;
  name: string | null;
  contentBlobId: string | null;
  symlinkTargetAuxNodeId: string | null;
}

function loadTreePayload<T>(executor: DatabaseExecutor, treeId: string): T {
  const object = getTreeObject<T>(executor, treeId);
  invariant(object, `Tree object not found: ${treeId}`);
  return object.payload;
}

function emptyArea(): WorkingTreeAreaSummary {
  return { changed: false, changes: [] };
}

function areaWithChanges(changes: WorkingTreeChangeItem[]): WorkingTreeAreaSummary {
  return { changed: changes.length > 0, changes };
}

function flattenContentTree(
  executor: DatabaseExecutor,
  treeId: string,
): Map<string, FlatContentNode> {
  const result = new Map<string, FlatContentNode>();

  const walk = (id: string) => {
    const payload = loadTreePayload<ContentTreePayload>(executor, id);
    const childNodeIds = payload.children.map((childTreeId) => {
      const child = loadTreePayload<ContentTreePayload>(executor, childTreeId);
      return child.nodeId;
    });
    result.set(payload.nodeId, {
      nodeId: payload.nodeId,
      title: payload.title,
      anchorTimelinePointId: payload.anchorTimelinePointId,
      bodyBlobId: payload.bodyBlobId,
      childNodeIds,
    });
    for (const childTreeId of payload.children) {
      walk(childTreeId);
    }
  };

  walk(treeId);
  return result;
}

function contentFingerprint(node: FlatContentNode): string {
  return JSON.stringify({
    title: node.title,
    anchor: node.anchorTimelinePointId,
    body: node.bodyBlobId,
    children: node.childNodeIds,
  });
}

function contentLabel(node: FlatContentNode): string {
  return node.title ?? node.nodeId;
}

function diffContentTrees(
  executor: DatabaseExecutor,
  currentTreeId: string,
  headTreeId: string | null,
  contentRootId: string,
): WorkingTreeChangeItem[] {
  const current = flattenContentTree(executor, currentTreeId);
  const head = headTreeId
    ? flattenContentTree(executor, headTreeId)
    : new Map<string, FlatContentNode>();
  const changes: WorkingTreeChangeItem[] = [];
  const allIds = new Set([...current.keys(), ...head.keys()]);

  for (const nodeId of allIds) {
    if (nodeId === contentRootId) {
      continue;
    }

    const currentNode = current.get(nodeId);
    const headNode = head.get(nodeId);

    if (currentNode && !headNode) {
      changes.push({ label: contentLabel(currentNode), kind: "added" });
    } else if (!currentNode && headNode) {
      changes.push({ label: contentLabel(headNode), kind: "deleted" });
    } else if (
      currentNode &&
      headNode &&
      contentFingerprint(currentNode) !== contentFingerprint(headNode)
    ) {
      changes.push({ label: contentLabel(currentNode), kind: "modified" });
    }
  }

  return changes.sort((left, right) => left.label.localeCompare(right.label));
}

function timelineFingerprint(point: TimelinePayload["points"][number]): string {
  return JSON.stringify(point);
}

function diffTimelineTrees(
  executor: DatabaseExecutor,
  currentTreeId: string,
  headTreeId: string | null,
): WorkingTreeChangeItem[] {
  const currentPoints = loadTreePayload<TimelinePayload>(executor, currentTreeId).points;
  const headPoints = headTreeId
    ? loadTreePayload<TimelinePayload>(executor, headTreeId).points
    : [];
  const currentMap = new Map(currentPoints.map((point) => [point.id, point]));
  const headMap = new Map(headPoints.map((point) => [point.id, point]));
  const changes: WorkingTreeChangeItem[] = [];

  for (const [pointId, point] of currentMap) {
    const headPoint = headMap.get(pointId);
    if (!headPoint) {
      changes.push({ label: point.label, kind: "added" });
    } else if (timelineFingerprint(point) !== timelineFingerprint(headPoint)) {
      changes.push({ label: point.label, kind: "modified" });
    }
  }

  for (const [pointId, point] of headMap) {
    if (!currentMap.has(pointId)) {
      changes.push({ label: point.label, kind: "deleted" });
    }
  }

  return changes.sort((left, right) => left.label.localeCompare(right.label));
}

function pickAuxLayer(
  node: AuxNodePayload,
  timelinePointId: string | null,
): AuxLayerPayload | undefined {
  return (
    node.layers.find((layer) => layer.timelinePointId === timelinePointId) ??
    node.layers.find((layer) => layer.timelinePointId === null)
  );
}

function resolveAuxLayerPath(
  nodesById: Map<string, AuxNodePayload>,
  rootAuxNodeId: string,
  auxNodeId: string,
  timelinePointId: string | null,
): string {
  if (auxNodeId === rootAuxNodeId) {
    return "/";
  }

  const node = nodesById.get(auxNodeId);
  if (!node) {
    return auxNodeId;
  }

  const layer = pickAuxLayer(node, timelinePointId);
  if (!layer?.name) {
    return auxNodeId;
  }

  const parentId = layer.parentAuxNodeId ?? rootAuxNodeId;
  const parentPath = resolveAuxLayerPath(nodesById, rootAuxNodeId, parentId, timelinePointId);
  return parentPath === "/" ? `/${layer.name}` : `${parentPath}/${layer.name}`;
}

function flattenAuxTree(executor: DatabaseExecutor, auxTreeId: string) {
  const collection = loadTreePayload<AuxCollectionPayload>(executor, auxTreeId);
  const nodesById = new Map<string, AuxNodePayload>();
  const layers: AuxLayerEntry[] = [];

  for (const nodeTreeId of collection.nodes) {
    const node = loadTreePayload<AuxNodePayload>(executor, nodeTreeId);
    nodesById.set(node.auxNodeId, node);
    for (const layer of node.layers) {
      layers.push({
        auxNodeId: node.auxNodeId,
        timelinePointId: layer.timelinePointId,
        isDeleted: layer.isDeleted,
        parentAuxNodeId: layer.parentAuxNodeId,
        name: layer.name,
        contentBlobId: layer.contentBlobId,
        symlinkTargetAuxNodeId: layer.symlinkTargetAuxNodeId,
      });
    }
  }

  return { rootAuxNodeId: collection.rootAuxNodeId, nodesById, layers };
}

function auxLayerKey(entry: AuxLayerEntry): string {
  return `${entry.auxNodeId}:${entry.timelinePointId ?? "origin"}`;
}

function auxLayerFingerprint(entry: AuxLayerEntry): string {
  return JSON.stringify({
    isDeleted: entry.isDeleted,
    parentAuxNodeId: entry.parentAuxNodeId,
    name: entry.name,
    contentBlobId: entry.contentBlobId,
    symlinkTargetAuxNodeId: entry.symlinkTargetAuxNodeId,
  });
}

function auxLayerLabel(
  nodesById: Map<string, AuxNodePayload>,
  rootAuxNodeId: string,
  entry: AuxLayerEntry,
): string {
  return resolveAuxLayerPath(nodesById, rootAuxNodeId, entry.auxNodeId, entry.timelinePointId);
}

function buildTimelinePointLabelMap(
  executor: DatabaseExecutor,
  timelineTreeIds: string[],
): Map<string | null, string> {
  const labels = new Map<string | null, string>([[null, "原点"]]);

  for (const timelineTreeId of timelineTreeIds) {
    const payload = loadTreePayload<TimelinePayload>(executor, timelineTreeId);
    for (const point of payload.points) {
      labels.set(point.id, point.label);
    }
  }

  return labels;
}

function resolveTimelinePointLabel(
  timelinePointId: string | null,
  timelineLabels: Map<string | null, string>,
): string {
  if (timelinePointId == null || timelinePointId === ORIGIN_TIMELINE_POINT_ID) {
    return timelineLabels.get(null) ?? "原点";
  }

  return timelineLabels.get(timelinePointId) ?? timelinePointId;
}

function formatAuxChangeLabel(
  path: string,
  timelinePointId: string | null,
  timelineLabels: Map<string | null, string>,
): string {
  const timelineLabel = resolveTimelinePointLabel(timelinePointId, timelineLabels);
  return `${path}@${timelineLabel}`;
}

function diffAuxTrees(
  executor: DatabaseExecutor,
  currentTreeId: string,
  headTreeId: string | null,
  currentTimelineTreeId: string,
  headTimelineTreeId: string | null,
): WorkingTreeChangeItem[] {
  const current = flattenAuxTree(executor, currentTreeId);
  const head = headTreeId
    ? flattenAuxTree(executor, headTreeId)
    : {
        rootAuxNodeId: current.rootAuxNodeId,
        nodesById: new Map<string, AuxNodePayload>(),
        layers: [] as AuxLayerEntry[],
      };
  const currentMap = new Map(
    current.layers
      .filter((entry) => entry.auxNodeId !== current.rootAuxNodeId)
      .map((entry) => [auxLayerKey(entry), entry]),
  );
  const headMap = new Map(
    head.layers
      .filter((entry) => entry.auxNodeId !== head.rootAuxNodeId)
      .map((entry) => [auxLayerKey(entry), entry]),
  );
  const changes: WorkingTreeChangeItem[] = [];
  const allKeys = new Set([...currentMap.keys(), ...headMap.keys()]);
  const timelineLabels = buildTimelinePointLabelMap(
    executor,
    headTimelineTreeId ? [currentTimelineTreeId, headTimelineTreeId] : [currentTimelineTreeId],
  );

  const labelForAuxChange = (
    currentEntry: AuxLayerEntry | undefined,
    headEntry: AuxLayerEntry | undefined,
    preferHead: boolean,
  ) => {
    const primary = preferHead && headEntry ? head : current;
    const primaryEntry = preferHead && headEntry ? headEntry : (currentEntry ?? headEntry);
    if (!primaryEntry) {
      return "unknown";
    }

    const primaryLabel = auxLayerLabel(primary.nodesById, primary.rootAuxNodeId, primaryEntry);
    const resolvedPath =
      primaryLabel !== primaryEntry.auxNodeId
        ? primaryLabel
        : (() => {
            const fallback = preferHead ? current : head;
            const fallbackEntry = preferHead ? currentEntry : headEntry;
            if (!fallbackEntry) {
              return primaryLabel;
            }

            const fallbackLabel = auxLayerLabel(
              fallback.nodesById,
              fallback.rootAuxNodeId,
              fallbackEntry,
            );
            return fallbackLabel !== fallbackEntry.auxNodeId ? fallbackLabel : primaryLabel;
          })();

    return formatAuxChangeLabel(resolvedPath, primaryEntry.timelinePointId, timelineLabels);
  };

  for (const key of allKeys) {
    const currentEntry = currentMap.get(key);
    const headEntry = headMap.get(key);

    if (currentEntry && !headEntry) {
      changes.push({
        label: labelForAuxChange(currentEntry, headEntry, false),
        kind: currentEntry.isDeleted ? "deleted" : "added",
      });
      continue;
    }

    if (!currentEntry && headEntry) {
      changes.push({
        label: labelForAuxChange(currentEntry, headEntry, true),
        kind: "deleted",
      });
      continue;
    }

    if (
      currentEntry &&
      headEntry &&
      auxLayerFingerprint(currentEntry) !== auxLayerFingerprint(headEntry)
    ) {
      changes.push({
        label: labelForAuxChange(currentEntry, headEntry, currentEntry.isDeleted),
        kind: currentEntry.isDeleted ? "deleted" : "modified",
      });
    }
  }

  return changes.sort((left, right) => left.label.localeCompare(right.label));
}

export function getWorkingTreeStatus(branchId: string): WorkingTreeStatus {
  return db.transaction((tx) => {
    const branch = getBranchOrThrow(tx, branchId);
    const workspace = getWorkspaceForBranch(tx, branchId);
    invariant(workspace, "该分支没有关联的工作区。");
    invariant(workspace.contentRootId, `Workspace ${workspace.id} has no content root`);

    const currentRootId = snapshotWorkspaceState(tx, workspace.id);
    const emptyAreas = {
      content: emptyArea(),
      timeline: emptyArea(),
      aux: emptyArea(),
    };

    if (!branch.headCommitId) {
      const currentRoot = loadTreePayload<RootTreePayload>(tx, currentRootId);
      const contentChanges = diffContentTrees(
        tx,
        currentRoot.contentTreeId,
        null,
        workspace.contentRootId,
      );
      const timelineChanges = diffTimelineTrees(tx, currentRoot.timelineTreeId, null);
      const auxChanges = diffAuxTrees(
        tx,
        currentRoot.auxTreeId,
        null,
        currentRoot.timelineTreeId,
        null,
      );
      const areas = {
        content: areaWithChanges(contentChanges),
        timeline: areaWithChanges(timelineChanges),
        aux: areaWithChanges(auxChanges),
      };

      return {
        hasChanges: areas.content.changed || areas.timeline.changed || areas.aux.changed,
        headCommitId: null,
        areas,
      };
    }

    const headCommit = getCommitOrThrow(tx, branch.projectId, branch.headCommitId);
    if (currentRootId === headCommit.treeId) {
      return {
        hasChanges: false,
        headCommitId: branch.headCommitId,
        areas: emptyAreas,
      };
    }

    const currentRoot = loadTreePayload<RootTreePayload>(tx, currentRootId);
    const headRoot = loadTreePayload<RootTreePayload>(tx, headCommit.treeId);

    const contentChanges =
      currentRoot.contentTreeId !== headRoot.contentTreeId
        ? diffContentTrees(
            tx,
            currentRoot.contentTreeId,
            headRoot.contentTreeId,
            workspace.contentRootId,
          )
        : [];
    const timelineChanges =
      currentRoot.timelineTreeId !== headRoot.timelineTreeId
        ? diffTimelineTrees(tx, currentRoot.timelineTreeId, headRoot.timelineTreeId)
        : [];
    const auxChanges =
      currentRoot.auxTreeId !== headRoot.auxTreeId
        ? diffAuxTrees(
            tx,
            currentRoot.auxTreeId,
            headRoot.auxTreeId,
            currentRoot.timelineTreeId,
            headRoot.timelineTreeId,
          )
        : [];

    return {
      hasChanges: true,
      headCommitId: branch.headCommitId,
      areas: {
        content: areaWithChanges(contentChanges),
        timeline: areaWithChanges(timelineChanges),
        aux: areaWithChanges(auxChanges),
      },
    };
  });
}
