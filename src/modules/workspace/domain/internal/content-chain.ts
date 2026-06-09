import type { InferSelectModel } from "drizzle-orm";
import { and, eq } from "drizzle-orm";

import { type DatabaseExecutor, schema } from "@/db";

import type { ExportedContentNode } from "../types";
import { invariant } from "@/shared/lib/domain";
import { pointIdOrOrigin } from "./timeline-point";

type ContentNodeRow = InferSelectModel<typeof schema.contentNodes>;

export function listContentChildren(
  executor: DatabaseExecutor,
  workspaceId: string,
  parentId: string,
) {
  return executor
    .select()
    .from(schema.contentNodes)
    .where(
      and(
        eq(schema.contentNodes.workspaceId, workspaceId),
        eq(schema.contentNodes.parentId, parentId),
      ),
    )
    .all();
}

export function orderContentChildren(children: ContentNodeRow[]) {
  const nextIds = new Set(
    children.map((child) => child.nextSiblingId).filter((id): id is string => id != null),
  );
  const heads = children.filter((child) => !nextIds.has(child.id));
  invariant(heads.length <= 1, "Content chain is invalid: multiple child heads detected");
  if (children.length === 0) {
    return [] as ContentNodeRow[];
  }

  const head = heads[0];
  invariant(head, "Content chain is invalid: missing child head");

  const byId = new Map(children.map((child) => [child.id, child]));
  const ordered: ContentNodeRow[] = [];
  let current: ContentNodeRow | undefined = head;
  while (current) {
    ordered.push(current);
    current = current.nextSiblingId ? byId.get(current.nextSiblingId) : undefined;
  }

  invariant(
    ordered.length === children.length,
    "Content chain is invalid: cycle or dangling sibling detected",
  );
  return ordered;
}

export function getContentPrevSibling(
  executor: DatabaseExecutor,
  workspaceId: string,
  nodeId: string,
) {
  return executor
    .select()
    .from(schema.contentNodes)
    .where(
      and(
        eq(schema.contentNodes.workspaceId, workspaceId),
        eq(schema.contentNodes.nextSiblingId, nodeId),
      ),
    )
    .get();
}

export function collectContentSubtreeIds(
  executor: DatabaseExecutor,
  workspaceId: string,
  rootNodeId: string,
) {
  const collected = new Set<string>();
  const queue = [rootNodeId];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    if (collected.has(currentId)) {
      continue;
    }
    collected.add(currentId);
    for (const child of listContentChildren(executor, workspaceId, currentId)) {
      queue.push(child.id);
    }
  }

  return collected;
}

export function buildContentNodeTitlePath(
  executor: DatabaseExecutor,
  workspaceId: string,
  nodeId: string,
  contentRootId: string,
) {
  const segments: string[] = [];
  let currentId: string | null = nodeId;

  while (currentId && currentId !== contentRootId) {
    const node = executor
      .select()
      .from(schema.contentNodes)
      .where(
        and(
          eq(schema.contentNodes.workspaceId, workspaceId),
          eq(schema.contentNodes.id, currentId),
        ),
      )
      .get();
    if (!node) {
      break;
    }
    segments.unshift(node.title?.trim() || "未命名节点");
    currentId = node.parentId;
  }

  return segments.join(" / ");
}

export function exportContentNode(
  executor: DatabaseExecutor,
  workspaceId: string,
  node: ContentNodeRow,
): ExportedContentNode {
  return {
    id: node.id,
    anchorTimelinePointId: pointIdOrOrigin(node.anchorTimelinePointId),
    kind: node.kind,
    title: node.title,
    body: node.body,
    children: orderContentChildren(listContentChildren(executor, workspaceId, node.id)).map(
      (child) => exportContentNode(executor, workspaceId, child),
    ),
  };
}
