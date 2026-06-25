export interface ProjectIndexRow {
  id: string;
  name: string;
  description: string | null;
  updatedAt: number;
}

export interface ManuscriptNodeDiskState {
  id: string;
  parentId: string | null;
  title: string | null;
  anchorTimelinePointId: string | null;
  body: string;
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
}
