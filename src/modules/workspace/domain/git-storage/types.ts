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
  createdAt: number;
  updatedAt: number;
}

export interface ManuscriptNodeDiskState {
  id: string;
  parentId: string | null;
  order: number;
  title: string | null;
  anchorTimelinePointId: string | null;
  body: string;
  dirPath: string;
  children: ManuscriptNodeDiskState[];
}

export interface TimelineMetaRow {
  id: string;
  label: string;
  description: string | null;
  prevPointId: string | null;
}

export interface ProjectMetaPayload {
  project: ProjectIndexRow;
  branches: BranchIndexRow[];
  workspaces: WorkspaceIndexRow[];
}
