import { eq } from "drizzle-orm";

import { db, schema } from "@/db";

import {
  assertContentRoot,
  getContentNodeOrThrow,
  getWorkspaceOrThrow,
  touchWorkspace,
} from "../internal/access";
import {
  collectContentSubtreeIds,
  exportContentNode,
  getContentPrevSibling,
  listContentChildren,
  orderContentChildren,
} from "../internal/content-chain";
import { createId, invariant, now } from "../internal/ids";
import { validateTimelinePointRef } from "../internal/timeline-point";
import type { ExportedContentSubtree, TimelinePointRef } from "../types";

export function createContentNode(input: {
  workspaceId: string;
  parentId: string;
  afterSiblingId?: string | null;
  anchorPointId?: TimelinePointRef;
  kind?: string | null;
  title?: string | null;
  body?: string | null;
}) {
  return db.transaction((tx) => {
    const workspace = getWorkspaceOrThrow(tx, input.workspaceId);
    getContentNodeOrThrow(tx, workspace.id, input.parentId);
    const anchorTimelinePointId = validateTimelinePointRef(tx, workspace.id, input.anchorPointId);
    const timestamp = now();
    const nodeId = createId("content");

    if (input.afterSiblingId) {
      const previousSibling = getContentNodeOrThrow(tx, workspace.id, input.afterSiblingId);
      invariant(
        previousSibling.parentId === input.parentId,
        "afterSiblingId must belong to the same parent",
      );

      tx.insert(schema.contentNodes)
        .values({
          id: nodeId,
          workspaceId: workspace.id,
          parentId: input.parentId,
          nextSiblingId: null,
          anchorTimelinePointId,
          kind: input.kind ?? null,
          title: input.title ?? null,
          body: input.body ?? null,
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .run();

      tx.update(schema.contentNodes)
        .set({ nextSiblingId: nodeId, updatedAt: timestamp })
        .where(eq(schema.contentNodes.id, previousSibling.id))
        .run();

      tx.update(schema.contentNodes)
        .set({ nextSiblingId: previousSibling.nextSiblingId, updatedAt: timestamp })
        .where(eq(schema.contentNodes.id, nodeId))
        .run();
    } else {
      const head = orderContentChildren(listContentChildren(tx, workspace.id, input.parentId))[0];
      tx.insert(schema.contentNodes)
        .values({
          id: nodeId,
          workspaceId: workspace.id,
          parentId: input.parentId,
          nextSiblingId: head?.id ?? null,
          anchorTimelinePointId,
          kind: input.kind ?? null,
          title: input.title ?? null,
          body: input.body ?? null,
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .run();
    }

    touchWorkspace(tx, workspace.id);
    return getContentNodeOrThrow(tx, workspace.id, nodeId);
  });
}

export function moveContentNode(input: {
  workspaceId: string;
  nodeId: string;
  newParentId: string;
  afterSiblingId?: string | null;
}) {
  return db.transaction((tx) => {
    const workspace = getWorkspaceOrThrow(tx, input.workspaceId);
    const contentRootId = assertContentRoot(workspace);
    const node = getContentNodeOrThrow(tx, workspace.id, input.nodeId);
    invariant(node.id !== contentRootId, "Cannot move the hidden content root");
    const newParent = getContentNodeOrThrow(tx, workspace.id, input.newParentId);
    const subtreeIds = collectContentSubtreeIds(tx, workspace.id, node.id);
    invariant(!subtreeIds.has(newParent.id), "Cannot move a content node under its own descendant");
    if (input.afterSiblingId) {
      const previousSibling = getContentNodeOrThrow(tx, workspace.id, input.afterSiblingId);
      invariant(
        previousSibling.parentId === newParent.id,
        "afterSiblingId must belong to the destination parent",
      );
      invariant(previousSibling.id !== node.id, "afterSiblingId cannot be the moved node");
    }

    const oldPrev = getContentPrevSibling(tx, workspace.id, node.id);
    const timestamp = now();

    tx.update(schema.contentNodes)
      .set({ nextSiblingId: null, updatedAt: timestamp })
      .where(eq(schema.contentNodes.id, node.id))
      .run();

    if (oldPrev) {
      tx.update(schema.contentNodes)
        .set({ nextSiblingId: node.nextSiblingId, updatedAt: timestamp })
        .where(eq(schema.contentNodes.id, oldPrev.id))
        .run();
    }

    if (input.afterSiblingId) {
      const previousSibling = getContentNodeOrThrow(tx, workspace.id, input.afterSiblingId);
      const afterNext = previousSibling.nextSiblingId;
      tx.update(schema.contentNodes)
        .set({ nextSiblingId: node.id, updatedAt: timestamp })
        .where(eq(schema.contentNodes.id, previousSibling.id))
        .run();

      tx.update(schema.contentNodes)
        .set({ parentId: newParent.id, nextSiblingId: afterNext, updatedAt: timestamp })
        .where(eq(schema.contentNodes.id, node.id))
        .run();
    } else {
      const head = orderContentChildren(listContentChildren(tx, workspace.id, newParent.id))[0];
      tx.update(schema.contentNodes)
        .set({ parentId: newParent.id, nextSiblingId: head?.id ?? null, updatedAt: timestamp })
        .where(eq(schema.contentNodes.id, node.id))
        .run();
    }

    touchWorkspace(tx, workspace.id);
    return getContentNodeOrThrow(tx, workspace.id, node.id);
  });
}

export function deleteContentNode(input: { workspaceId: string; nodeId: string }) {
  return db.transaction((tx) => {
    const workspace = getWorkspaceOrThrow(tx, input.workspaceId);
    const contentRootId = assertContentRoot(workspace);
    const node = getContentNodeOrThrow(tx, workspace.id, input.nodeId);
    invariant(node.id !== contentRootId, "Cannot delete the hidden content root");

    const oldPrev = getContentPrevSibling(tx, workspace.id, node.id);
    const timestamp = now();

    if (oldPrev) {
      tx.update(schema.contentNodes)
        .set({ nextSiblingId: node.nextSiblingId, updatedAt: timestamp })
        .where(eq(schema.contentNodes.id, oldPrev.id))
        .run();
    }

    tx.delete(schema.contentNodes).where(eq(schema.contentNodes.id, node.id)).run();
    touchWorkspace(tx, workspace.id);
  });
}

export function updateContentNode(input: {
  workspaceId: string;
  nodeId: string;
  anchorPointId?: TimelinePointRef;
  kind?: string | null;
  title?: string | null;
  body?: string | null;
}) {
  return db.transaction((tx) => {
    const workspace = getWorkspaceOrThrow(tx, input.workspaceId);
    const node = getContentNodeOrThrow(tx, workspace.id, input.nodeId);
    const anchorTimelinePointId =
      input.anchorPointId === undefined
        ? node.anchorTimelinePointId
        : validateTimelinePointRef(tx, workspace.id, input.anchorPointId);

    tx.update(schema.contentNodes)
      .set({
        anchorTimelinePointId,
        kind: input.kind === undefined ? node.kind : input.kind,
        title: input.title === undefined ? node.title : input.title,
        body: input.body === undefined ? node.body : input.body,
        updatedAt: now(),
      })
      .where(eq(schema.contentNodes.id, node.id))
      .run();

    touchWorkspace(tx, workspace.id);
    return getContentNodeOrThrow(tx, workspace.id, node.id);
  });
}

export function exportContentSubtree(workspaceId: string, rootNodeId?: string) {
  const workspace = getWorkspaceOrThrow(db, workspaceId);
  const contentRootId = assertContentRoot(workspace);
  const targetRootId = rootNodeId ?? contentRootId;
  const targetNode = getContentNodeOrThrow(db, workspace.id, targetRootId);
  if (targetRootId === contentRootId) {
    return {
      rootNodeId: targetRootId,
      isWorkspaceRoot: true,
      nodes: orderContentChildren(listContentChildren(db, workspace.id, targetRootId)).map(
        (child) => exportContentNode(db, workspace.id, child),
      ),
    } satisfies ExportedContentSubtree;
  }

  return {
    rootNodeId: targetRootId,
    isWorkspaceRoot: false,
    nodes: [exportContentNode(db, workspace.id, targetNode)],
  } satisfies ExportedContentSubtree;
}
