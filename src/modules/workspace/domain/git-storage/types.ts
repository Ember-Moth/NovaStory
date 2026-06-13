export interface ProjectIndexRow {
  id: string;
  name: string;
  description: string | null;
  defaultBranchId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface BranchIndexRow {
  id: string;
  projectId: string;
  name: string;
  ref: string;
  headCommitId: string | null;
  forkedFromCommitId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface WorkspaceIndexRow {
  id: string;
  projectId: string;
  branchId: string;
  name: string;
  worktreePath: string;
  contentRootId: string;
  auxRootId: string;
  createdAt: number;
  updatedAt: number;
}

export interface ContentMetaRow {
  id: string;
  parentId: string | null;
  order: number;
  title: string | null;
  bodyPath: string | null;
  anchorTimelinePointId: string | null;
}

export interface TimelineMetaRow {
  id: string;
  label: string;
  description: string | null;
  prevPointId: string | null;
}

export interface AuxLayerMetaRow {
  id: string;
  auxNodeId: string;
  nodeType: "root" | "dir" | "file" | "symlink";
  timelinePointId: string | null;
  isDeleted: boolean;
  parentAuxNodeId: string | null;
  name: string | null;
  contentPath: string | null;
  symlinkTargetAuxNodeId: string | null;
}

export interface ProjectMetaPayload {
  project: ProjectIndexRow;
  branches: BranchIndexRow[];
  workspaces: WorkspaceIndexRow[];
}
