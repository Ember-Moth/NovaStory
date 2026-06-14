import type { ORIGIN_TIMELINE_POINT_ID } from "@/modules/workspace/domain/constants";

export type TimelinePointRef = string | null | undefined | typeof ORIGIN_TIMELINE_POINT_ID;
export type AuxNodeType = "dir" | "file" | "symlink";
export type AuxOverlayStatus = "visible" | "deleted";

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
  nodes: ManuscriptListNode[];
  truncated: boolean;
}

export interface ExportedAuxNode {
  nodeType: AuxNodeType;
  name: string | null;
  content: string | null;
  symlinkTargetPath: string | null;
  timelinePointId: string | typeof ORIGIN_TIMELINE_POINT_ID;
  path: string;
  hasTimelineChange: boolean;
  overlayStatus: AuxOverlayStatus;
  children: ExportedAuxNode[];
}

export interface ExportedAuxSnapshotTree {
  rootPath: string;
  timelinePointId: string | typeof ORIGIN_TIMELINE_POINT_ID;
  nodes: ExportedAuxNode[];
}

export interface AuxPathChangeView {
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
  nodeType: AuxNodeType;
  path: string;
  previousPath: string | null;
  symlinkTargetPath: string | null;
  previousSymlinkTargetPath: string | null;
  changedAspects: AuxTimelineModifiedAspect[];
}

export interface ResolvedAuxNode {
  nodeType: AuxNodeType;
  name: string | null;
  content: string | null;
  timelinePointId: string | typeof ORIGIN_TIMELINE_POINT_ID;
  path: string;
  symlinkTargetPath: string | null;
}

export interface AuxDirListTreeNode {
  nodeType: AuxNodeType;
  name: string | null;
  content?: string | null;
  timelinePointId?: string | typeof ORIGIN_TIMELINE_POINT_ID;
  path: string;
  symlinkTargetPath?: string;
  overlayStatus?: AuxOverlayStatus;
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
