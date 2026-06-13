import type { InferSelectModel } from "drizzle-orm";

import type { schema } from "@/db";
import type { ORIGIN_TIMELINE_POINT_ID } from "@/modules/workspace/domain/constants";

type AuxNodeRow = InferSelectModel<typeof schema.auxNodes>;

export type TimelinePointRef = string | null | undefined | typeof ORIGIN_TIMELINE_POINT_ID;
export type AuxNodeType = AuxNodeRow["nodeType"];

export interface TimelinePointView {
  id: string | typeof ORIGIN_TIMELINE_POINT_ID;
  label: string;
  description: string | null;
  prevPointId: string | typeof ORIGIN_TIMELINE_POINT_ID | null;
  isImplicitOrigin: boolean;
}

export interface ExportedContentNode {
  id: string;
  anchorTimelinePointId: string | typeof ORIGIN_TIMELINE_POINT_ID;
  title: string | null;
  body: string | null;
  children: ExportedContentNode[];
}

export interface ExportedContentSubtree {
  rootNodeId: string;
  isWorkspaceRoot: boolean;
  nodes: ExportedContentNode[];
}

export interface ManuscriptListNode {
  id: string;
  anchorTimelinePointId: string | typeof ORIGIN_TIMELINE_POINT_ID;
  title: string | null;
  children: ManuscriptListNode[];
  hiddenChildrenCount?: number;
}

export interface ManuscriptNodeRead {
  id: string;
  anchorTimelinePointId: string | typeof ORIGIN_TIMELINE_POINT_ID;
  title: string | null;
  body: string | null;
  children: ManuscriptListNode[];
}

export interface ManuscriptNodeList {
  rootNodeId: string;
  isWorkspaceRoot: boolean;
  nodes: ManuscriptListNode[];
  truncated: boolean;
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
  hasTimelineChange: boolean;
  isDeleted: boolean;
  children: ExportedAuxNode[];
}

export interface ExportedAuxSnapshotTree {
  rootNodeId: string;
  timelinePointId: string | typeof ORIGIN_TIMELINE_POINT_ID;
  nodes: ExportedAuxNode[];
}

export interface AuxLayerChangeView {
  path: string;
  isDeleted: boolean;
}

export type AuxTimelineChangeKind = "added" | "modified" | "deleted";
export type AuxTimelineModifiedAspect = "content" | "path" | "symlink_target" | "node_type";

export interface AuxTimelineChangeSummary {
  hasChanges: boolean;
  added: number;
  modified: number;
  deleted: number;
  total: number;
}

export interface AuxTimelineChangeView {
  kind: AuxTimelineChangeKind;
  nodeId: string;
  nodeType: AuxNodeType;
  path: string;
  previousPath: string | null;
  symlinkTargetPath: string | null;
  previousSymlinkTargetPath: string | null;
  changedAspects: AuxTimelineModifiedAspect[];
  isDeleted?: boolean;
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

export interface AuxDirListTreeNode {
  id?: string;
  nodeType: AuxNodeType;
  parentAuxNodeId?: string | null;
  name: string | null;
  content?: string | null;
  symlinkTargetAuxNodeId?: string | null;
  timelinePointId?: string | typeof ORIGIN_TIMELINE_POINT_ID;
  path: string;
  symlinkTargetPath?: string;
  children: AuxDirListTreeNode[];
  hiddenChildrenCount?: number;
}

export interface WritingContext {
  contentNode: ExportedContentNode;
  timelinePointId: string | typeof ORIGIN_TIMELINE_POINT_ID;
  auxSnapshot: ResolvedAuxNode[];
}

export interface ResolvedAuxSnapshotNode extends ResolvedAuxNode {
  reachable: boolean;
}

export type WorkingTreeChangeKind = "added" | "modified" | "deleted";

export interface WorkingTreeChangeItem {
  label: string;
  kind: WorkingTreeChangeKind;
}

export interface WorkingTreeAreaSummary {
  changed: boolean;
  changes: WorkingTreeChangeItem[];
}

export interface WorkingTreeStatus {
  hasChanges: boolean;
  headCommitId: string | null;
  areas: {
    content: WorkingTreeAreaSummary;
    timeline: WorkingTreeAreaSummary;
    aux: WorkingTreeAreaSummary;
  };
}
