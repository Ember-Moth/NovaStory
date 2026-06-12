import { eq } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";

import { type DatabaseExecutor, schema } from "@/db";

import { getContentNodeOrThrow, getWorkspaceOrThrow } from "./internal/access";
import { listContentChildren, orderContentChildren } from "./internal/content-chain";
import { getBlob, getTreeObject, putBlob, putTreeObject } from "./internal/object-store";
import { listTimelineRows, orderTimelineRows } from "./internal/timeline-chain";
import { invariant, now } from "@/shared/lib/domain";

type ContentNodeRow = InferSelectModel<typeof schema.contentNodes>;

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
    key: string;
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

function snapshotContentNode(
  executor: DatabaseExecutor,
  projectId: string,
  workspaceId: string,
  node: ContentNodeRow,
): string {
  const orderedChildren = orderContentChildren(listContentChildren(executor, workspaceId, node.id));
  const childTreeIds = orderedChildren.map((child) =>
    snapshotContentNode(executor, projectId, workspaceId, child),
  );
  const payload: ContentTreePayload = {
    nodeId: node.id,
    title: node.title,
    anchorTimelinePointId: node.anchorTimelinePointId,
    bodyBlobId: node.body == null ? null : putBlob(executor, node.body),
    children: childTreeIds,
  };
  return putTreeObject(executor, { projectId, kind: "content", payload });
}

function snapshotTimeline(
  executor: DatabaseExecutor,
  projectId: string,
  workspaceId: string,
): string {
  const ordered = orderTimelineRows(listTimelineRows(executor, workspaceId));
  const payload: TimelinePayload = {
    points: ordered.map((row) => ({
      id: row.id,
      key: row.key,
      label: row.label,
      description: row.description,
    })),
  };
  return putTreeObject(executor, { projectId, kind: "timeline", payload });
}

function snapshotAux(
  executor: DatabaseExecutor,
  projectId: string,
  workspace: { id: string; auxRootId: string | null },
): string {
  invariant(workspace.auxRootId, `Workspace ${workspace.id} has no aux root`);
  const auxNodes = executor
    .select()
    .from(schema.auxNodes)
    .where(eq(schema.auxNodes.workspaceId, workspace.id))
    .all();
  const layers = executor
    .select()
    .from(schema.auxNodeLayers)
    .where(eq(schema.auxNodeLayers.workspaceId, workspace.id))
    .all();

  const layersByAuxNodeId = new Map<string, AuxLayerPayload[]>();
  for (const layer of layers) {
    const list = layersByAuxNodeId.get(layer.auxNodeId) ?? [];
    list.push({
      timelinePointId: layer.timelinePointId,
      isDeleted: layer.isDeleted,
      parentAuxNodeId: layer.parentAuxNodeId,
      name: layer.name,
      contentBlobId: layer.content == null ? null : putBlob(executor, layer.content),
      symlinkTargetAuxNodeId: layer.symlinkTargetAuxNodeId,
    });
    layersByAuxNodeId.set(layer.auxNodeId, list);
  }

  const nodeTreeIds = [...auxNodes]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((auxNode) => {
      const nodeLayers = (layersByAuxNodeId.get(auxNode.id) ?? []).sort((left, right) =>
        (left.timelinePointId ?? "").localeCompare(right.timelinePointId ?? ""),
      );
      const payload: AuxNodePayload = {
        auxNodeId: auxNode.id,
        nodeType: auxNode.nodeType,
        layers: nodeLayers,
      };
      return putTreeObject(executor, { projectId, kind: "aux", payload });
    });

  const collection: AuxCollectionPayload = {
    rootAuxNodeId: workspace.auxRootId,
    nodes: nodeTreeIds,
  };
  return putTreeObject(executor, { projectId, kind: "aux", payload: collection });
}

export function snapshotWorkspaceState(executor: DatabaseExecutor, workspaceId: string): string {
  const workspace = getWorkspaceOrThrow(executor, workspaceId);
  invariant(workspace.contentRootId, `Workspace ${workspace.id} has no content root`);
  const projectId = workspace.projectId;
  const contentRoot = getContentNodeOrThrow(executor, workspace.id, workspace.contentRootId);

  const contentTreeId = snapshotContentNode(executor, projectId, workspace.id, contentRoot);
  const timelineTreeId = snapshotTimeline(executor, projectId, workspace.id);
  const auxTreeId = snapshotAux(executor, projectId, workspace);

  const payload: RootTreePayload = { contentTreeId, auxTreeId, timelineTreeId };
  return putTreeObject(executor, { projectId, kind: "root", payload });
}

function loadTreeOrThrow<T>(executor: DatabaseExecutor, treeId: string) {
  const object = getTreeObject<T>(executor, treeId);
  invariant(object, `Tree object not found: ${treeId}`);
  return object.payload;
}

function clearWorkspaceState(executor: DatabaseExecutor, workspaceId: string) {
  executor
    .delete(schema.contentNodes)
    .where(eq(schema.contentNodes.workspaceId, workspaceId))
    .run();
  executor
    .delete(schema.auxNodeLayers)
    .where(eq(schema.auxNodeLayers.workspaceId, workspaceId))
    .run();
  executor.delete(schema.auxNodes).where(eq(schema.auxNodes.workspaceId, workspaceId)).run();
  executor
    .delete(schema.timelinePoints)
    .where(eq(schema.timelinePoints.workspaceId, workspaceId))
    .run();
}

function restoreTimeline(
  executor: DatabaseExecutor,
  workspaceId: string,
  timelineTreeId: string,
  timestamp: number,
) {
  const payload = loadTreeOrThrow<TimelinePayload>(executor, timelineTreeId);
  let prevPointId: string | null = null;
  for (const point of payload.points) {
    executor
      .insert(schema.timelinePoints)
      .values({
        id: point.id,
        workspaceId,
        key: point.key,
        label: point.label,
        description: point.description,
        prevPointId,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();
    prevPointId = point.id;
  }
}

function restoreAux(
  executor: DatabaseExecutor,
  workspaceId: string,
  auxTreeId: string,
  timestamp: number,
): string {
  const collection = loadTreeOrThrow<AuxCollectionPayload>(executor, auxTreeId);
  const nodePayloads = collection.nodes.map((nodeTreeId) =>
    loadTreeOrThrow<AuxNodePayload>(executor, nodeTreeId),
  );

  for (const node of nodePayloads) {
    executor
      .insert(schema.auxNodes)
      .values({
        id: node.auxNodeId,
        workspaceId,
        nodeType: node.nodeType as InferSelectModel<typeof schema.auxNodes>["nodeType"],
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();
  }

  for (const node of nodePayloads) {
    for (const layer of node.layers) {
      executor
        .insert(schema.auxNodeLayers)
        .values({
          id: `aux_layer_${node.auxNodeId}_${layer.timelinePointId ?? "origin"}`,
          workspaceId,
          timelinePointId: layer.timelinePointId,
          auxNodeId: node.auxNodeId,
          isDeleted: layer.isDeleted,
          parentAuxNodeId: layer.parentAuxNodeId,
          name: layer.name,
          content: layer.contentBlobId == null ? null : getBlob(executor, layer.contentBlobId),
          symlinkTargetAuxNodeId: layer.symlinkTargetAuxNodeId,
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .run();
    }
  }

  return collection.rootAuxNodeId;
}

function restoreContentNode(
  executor: DatabaseExecutor,
  workspaceId: string,
  treeId: string,
  parentId: string | null,
  timestamp: number,
) {
  const payload = loadTreeOrThrow<ContentTreePayload>(executor, treeId);
  const orderedChildIds = payload.children.map((childTreeId) => {
    const child = loadTreeOrThrow<ContentTreePayload>(executor, childTreeId);
    return { treeId: childTreeId, nodeId: child.nodeId };
  });

  executor
    .insert(schema.contentNodes)
    .values({
      id: payload.nodeId,
      workspaceId,
      parentId,
      nextSiblingId: null,
      anchorTimelinePointId: payload.anchorTimelinePointId,
      title: payload.title,
      body: payload.bodyBlobId == null ? null : getBlob(executor, payload.bodyBlobId),
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();

  orderedChildIds.forEach((child) => {
    restoreContentNode(executor, workspaceId, child.treeId, payload.nodeId, timestamp);
  });

  orderedChildIds.forEach((child, index) => {
    const nextSiblingId = orderedChildIds[index + 1]?.nodeId ?? null;
    executor
      .update(schema.contentNodes)
      .set({ nextSiblingId })
      .where(eq(schema.contentNodes.id, child.nodeId))
      .run();
  });
}

export function restoreWorkspaceFromTree(
  executor: DatabaseExecutor,
  workspaceId: string,
  rootTreeId: string,
) {
  const workspace = getWorkspaceOrThrow(executor, workspaceId);
  const root = loadTreeOrThrow<RootTreePayload>(executor, rootTreeId);
  const timestamp = now();

  clearWorkspaceState(executor, workspace.id);
  restoreTimeline(executor, workspace.id, root.timelineTreeId, timestamp);
  const auxRootId = restoreAux(executor, workspace.id, root.auxTreeId, timestamp);
  restoreContentNode(executor, workspace.id, root.contentTreeId, null, timestamp);

  const contentRoot = loadTreeOrThrow<ContentTreePayload>(executor, root.contentTreeId);
  executor
    .update(schema.workspaces)
    .set({ contentRootId: contentRoot.nodeId, auxRootId, updatedAt: timestamp })
    .where(eq(schema.workspaces.id, workspace.id))
    .run();
}
