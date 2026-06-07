import { db } from "@/db";

import { getContentNodeOrThrow, getWorkspaceOrThrow } from "../internal/access";
import { buildReachableAuxSnapshot } from "../internal/aux-snapshot";
import { exportContentNode } from "../internal/content-chain";
import { normalizeTimelinePointId, pointIdOrOrigin } from "../internal/timeline-point";
import type { WritingContext } from "../types";

export function composeWritingContext(workspaceId: string, contentNodeId: string): WritingContext {
  const workspace = getWorkspaceOrThrow(db, workspaceId);
  const contentNode = getContentNodeOrThrow(db, workspace.id, contentNodeId);
  const exported = exportContentNode(db, workspace.id, contentNode);
  const timelinePointId = normalizeTimelinePointId(contentNode.anchorTimelinePointId);
  const snapshot = buildReachableAuxSnapshot(db, workspace, timelinePointId);

  return {
    contentNode: exported,
    timelinePointId: pointIdOrOrigin(timelinePointId),
    auxSnapshot: [...snapshot.values()]
      .filter((node) => node.nodeType !== "root")
      .sort((left, right) => left.path.localeCompare(right.path)),
  };
}
