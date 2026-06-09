import type { InferSelectModel } from "drizzle-orm";
import { and, eq, isNull } from "drizzle-orm";

import { type DatabaseExecutor, schema } from "@/db";

import { invariant } from "@/shared/lib/domain";

type TimelinePointRow = InferSelectModel<typeof schema.timelinePoints>;

export function listTimelineRows(executor: DatabaseExecutor, workspaceId: string) {
  return executor
    .select()
    .from(schema.timelinePoints)
    .where(eq(schema.timelinePoints.workspaceId, workspaceId))
    .all();
}

export function orderTimelineRows(rows: TimelinePointRow[]) {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const successorByPrev = new Map<string | null, TimelinePointRow>();

  for (const row of rows) {
    if (successorByPrev.has(row.prevPointId)) {
      throw new Error("Timeline chain is invalid: multiple successors share the same prev point");
    }
    successorByPrev.set(row.prevPointId, row);
  }

  const ordered: TimelinePointRow[] = [];
  let current = successorByPrev.get(null);
  while (current) {
    ordered.push(current);
    successorByPrev.delete(current.prevPointId);
    current = successorByPrev.get(current.id);
  }

  invariant(
    ordered.length === rows.length,
    "Timeline chain is invalid: cycle or dangling predecessor detected",
  );
  for (const row of ordered) {
    invariant(
      !row.prevPointId || byId.has(row.prevPointId),
      `Timeline point ${row.id} has a missing predecessor`,
    );
  }

  return ordered;
}

export function resolveTimelineChainIds(
  executor: DatabaseExecutor,
  workspaceId: string,
  pointId: string | null,
) {
  const ordered = orderTimelineRows(listTimelineRows(executor, workspaceId));
  if (pointId == null) {
    return [] as string[];
  }

  const pointIds = new Set(ordered.map((row) => row.id));
  invariant(pointIds.has(pointId), `Timeline point not found: ${pointId}`);

  const byId = new Map(ordered.map((row) => [row.id, row]));
  const chain: string[] = [];
  let currentId: string | null = pointId;

  while (currentId) {
    const row = byId.get(currentId);
    invariant(row, `Timeline point not found in chain: ${currentId}`);
    chain.push(row.id);
    currentId = row.prevPointId;
  }

  return chain;
}

export function listOrderedTimelinePointIds(executor: DatabaseExecutor, workspaceId: string) {
  return orderTimelineRows(listTimelineRows(executor, workspaceId)).map((row) => row.id);
}

export function listAffectedTimelinePointIdsForInsert(
  executor: DatabaseExecutor,
  workspaceId: string,
  afterPointId: string | null,
  newPointId: string,
) {
  const orderedIds = listOrderedTimelinePointIds(executor, workspaceId);
  const startIndex = afterPointId == null ? 0 : Math.max(orderedIds.indexOf(afterPointId) + 1, 0);
  return [...new Set([newPointId, ...orderedIds.slice(startIndex)])];
}

export function listAffectedTimelinePointIdsForDelete(
  executor: DatabaseExecutor,
  workspaceId: string,
  pointId: string,
) {
  const orderedIds = listOrderedTimelinePointIds(executor, workspaceId);
  const startIndex = orderedIds.indexOf(pointId);
  invariant(startIndex >= 0, `Timeline point not found: ${pointId}`);
  return orderedIds.slice(startIndex);
}

export function listAffectedTimelinePointIdsForMove(
  executor: DatabaseExecutor,
  workspaceId: string,
  pointId: string,
  afterPointId: string | null,
) {
  const orderedIds = listOrderedTimelinePointIds(executor, workspaceId);
  const fromIndex = orderedIds.indexOf(pointId);
  invariant(fromIndex >= 0, `Timeline point not found: ${pointId}`);

  const reorderedIds = [...orderedIds];
  reorderedIds.splice(fromIndex, 1);
  const insertIndex =
    afterPointId == null ? 0 : Math.max(reorderedIds.indexOf(afterPointId) + 1, 0);
  reorderedIds.splice(insertIndex, 0, pointId);

  const affectedStart = Math.min(fromIndex, insertIndex);
  return orderedIds.slice(affectedStart);
}

export function getTimelineSuccessor(
  executor: DatabaseExecutor,
  workspaceId: string,
  pointId: string | null,
) {
  const condition =
    pointId == null
      ? and(
          eq(schema.timelinePoints.workspaceId, workspaceId),
          isNull(schema.timelinePoints.prevPointId),
        )
      : and(
          eq(schema.timelinePoints.workspaceId, workspaceId),
          eq(schema.timelinePoints.prevPointId, pointId),
        );
  return executor.select().from(schema.timelinePoints).where(condition).get();
}
