import type { ORIGIN_TIMELINE_POINT_ID } from "@/modules/workspace/domain/constants";

export type TimelinePointRef = string | null | undefined | typeof ORIGIN_TIMELINE_POINT_ID;
export interface ProjectBranchRef {
  projectId: string;
  branchId: string;
}

export interface ProjectWorkspaceRef {
  projectId: string;
  workspaceId: string;
}

export interface ProjectThreadRef {
  projectId: string;
  threadId: string;
}

export interface ProjectNodeRef {
  projectId: string;
  nodeId: string;
}

export interface ProjectRunRef {
  projectId: string;
  runId: string;
}

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
export type WorkingTreePathSourceKind = "move" | "copy";

export type ContentChangeAspect = "title" | "body" | "parent" | "order" | "anchor";
export type TimelineChangeAspect = "label" | "description" | "order";

export interface WorkingTreePathChangeItem {
  label: string;
  path: string;
  kind: WorkingTreeChangeKind;
  timelinePointId?: string | typeof ORIGIN_TIMELINE_POINT_ID | null;
  timelinePointLabel?: string | null;
  sourceKind?: WorkingTreePathSourceKind;
  sourcePath?: string | null;
  sourceTimelinePointId?: string | typeof ORIGIN_TIMELINE_POINT_ID | null;
  sourceTimelinePointLabel?: string | null;
  isWhiteout?: boolean;
  revertable?: boolean;
}

export interface WorkingTreeContentChangeItem {
  label: string;
  kind: WorkingTreeChangeKind;
  nodeId: string;
  title: string | null;
  parentId: string | null;
  parentLabel: string | null;
  parentPathLabel: string;
  anchorTimelinePointId: string | typeof ORIGIN_TIMELINE_POINT_ID;
  anchorTimelinePointLabel: string | null;
  changedAspects: ContentChangeAspect[];
  bodyCharDelta: {
    added: number;
    removed: number;
  } | null;
  previousTitle: string | null;
  previousParentId: string | null;
  previousParentLabel: string | null;
  previousParentPathLabel: string | null;
  previousAnchorTimelinePointId: string | typeof ORIGIN_TIMELINE_POINT_ID | null;
  previousAnchorTimelinePointLabel: string | null;
  /** 该变更项是否可单独撤回。对于「删除」变更，若父节点一并被删除则为 false。 */
  revertable: boolean;
}

export interface WorkingTreeTimelineChangeItem {
  label: string;
  kind: WorkingTreeChangeKind;
  pointId: string;
  description: string | null;
  prevPointId: string | typeof ORIGIN_TIMELINE_POINT_ID | null;
  prevPointLabel: string | null;
  changedAspects: TimelineChangeAspect[];
  previousLabel: string | null;
  previousDescription: string | null;
  previousPrevPointId: string | typeof ORIGIN_TIMELINE_POINT_ID | null;
  previousPrevPointLabel: string | null;
  revertable: boolean;
}

export interface WorkingTreeAreaSummary<TChange = WorkingTreePathChangeItem> {
  changed: boolean;
  changes: TChange[];
}

export interface WorkingTreeStatus {
  hasChanges: boolean;
  headCommitId: string | null;
  areas: {
    content: WorkingTreeAreaSummary<WorkingTreeContentChangeItem>;
    timeline: WorkingTreeAreaSummary<WorkingTreeTimelineChangeItem>;
    aux: WorkingTreeAreaSummary<WorkingTreePathChangeItem>;
  };
}

export interface CommitDiff {
  commitId: string;
  /** 用于对比的基线父提交（首个父提交），根提交时为 null。 */
  baseCommitId: string | null;
  /** 是否为根提交（无父提交，与空树对比）。 */
  isRoot: boolean;
  hasChanges: boolean;
  areas: {
    content: WorkingTreeAreaSummary<WorkingTreeContentChangeItem>;
    timeline: WorkingTreeAreaSummary<WorkingTreeTimelineChangeItem>;
    aux: WorkingTreeAreaSummary<WorkingTreePathChangeItem>;
  };
}
