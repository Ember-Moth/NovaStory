export interface ContentTreeNodeVM {
  id: string;
  title: string;
  body: string;
  anchorTimelinePointId: string;
  children: ContentTreeNodeVM[];
}

export interface TimelinePointVM {
  id: string;
  key: string;
  label: string;
  description: string;
  isImplicitOrigin: boolean;
}

export interface AuxTreeNodeVM {
  id: string;
  nodeType: "dir" | "file" | "symlink";
  name: string;
  content: string;
  path: string;
  symlinkTargetPath: string | null;
  hasTimelineChange: boolean;
  isDeleted: boolean;
  children: AuxTreeNodeVM[];
}

export interface RawContentTreeNode {
  id: string;
  title: string | null;
  body: string | null;
  anchorTimelinePointId: string;
  children: RawContentTreeNode[];
}

export interface RawTimelinePoint {
  id: string;
  key: string;
  label: string;
  description: string | null;
  isImplicitOrigin: boolean;
}

export interface RawAuxTreeNode {
  id: string;
  nodeType: string;
  name: string | null;
  content: string | null;
  path: string;
  symlinkTargetPath: string | null;
  hasTimelineChange: boolean;
  isDeleted: boolean;
  children: RawAuxTreeNode[];
}

export interface SaveState {
  isSaving: boolean;
  isDirty: boolean;
  error: string | null;
}
