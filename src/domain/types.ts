import type { InferSelectModel } from "drizzle-orm";

import type { schema } from "@/db";
import type { ORIGIN_TIMELINE_POINT_ID } from "@/shared/constants";

type AuxNodeRow = InferSelectModel<typeof schema.auxNodes>;

export type TimelinePointRef = string | null | undefined | typeof ORIGIN_TIMELINE_POINT_ID;
export type AuxNodeType = AuxNodeRow["nodeType"];

export interface TimelinePointView {
  id: string | typeof ORIGIN_TIMELINE_POINT_ID;
  key: string;
  label: string;
  description: string | null;
  prevPointId: string | typeof ORIGIN_TIMELINE_POINT_ID | null;
  isImplicitOrigin: boolean;
}

export interface ExportedContentNode {
  id: string;
  anchorTimelinePointId: string | typeof ORIGIN_TIMELINE_POINT_ID;
  kind: string | null;
  title: string | null;
  body: string | null;
  children: ExportedContentNode[];
}

export interface ExportedContentSubtree {
  rootNodeId: string;
  isWorkspaceRoot: boolean;
  nodes: ExportedContentNode[];
}

export interface ExportedAuxNode {
  id: string;
  nodeType: AuxNodeType;
  parentAuxNodeId: string | null;
  name: string | null;
  content: string | null;
  symlinkTargetAuxNodeId: string | null;
  symlinkTargetPath: string | null;
  timelinePointId: string | typeof ORIGIN_TIMELINE_POINT_ID;
  path: string;
  children: ExportedAuxNode[];
}

export interface ExportedAuxSnapshotTree {
  rootNodeId: string;
  timelinePointId: string | typeof ORIGIN_TIMELINE_POINT_ID;
  nodes: ExportedAuxNode[];
}

export interface ResolvedAuxNode {
  id: string;
  nodeType: AuxNodeType;
  parentAuxNodeId: string | null;
  name: string | null;
  content: string | null;
  symlinkTargetAuxNodeId: string | null;
  timelinePointId: string | typeof ORIGIN_TIMELINE_POINT_ID;
  path: string;
}

export interface WritingContext {
  contentNode: ExportedContentNode;
  timelinePointId: string | typeof ORIGIN_TIMELINE_POINT_ID;
  auxSnapshot: ResolvedAuxNode[];
}

export interface ResolvedAuxSnapshotNode extends ResolvedAuxNode {
  reachable: boolean;
}
