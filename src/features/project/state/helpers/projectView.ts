import type { AuxTreeNodeVM, ContentTreeNodeVM, SaveState } from "@/features/project/model/types";

export function deriveProjectSelectionState(input: {
  activeContentNodeId: string | null;
  activeAuxNodeId: string | null;
  activeTimelinePointId: string | null;
  contentNodeMap: ReadonlyMap<string, ContentTreeNodeVM>;
  auxNodeMap: ReadonlyMap<string, AuxTreeNodeVM>;
  timelineLabelMap: ReadonlyMap<string, string>;
}) {
  const activeContentNode = input.activeContentNodeId
    ? (input.contentNodeMap.get(input.activeContentNodeId) ?? null)
    : null;
  const activeAuxNode = input.activeAuxNodeId
    ? (input.auxNodeMap.get(input.activeAuxNodeId) ?? null)
    : null;
  const activeTimelineLabel =
    (activeContentNode && input.timelineLabelMap.get(activeContentNode.anchorTimelinePointId)) ||
    (input.activeTimelinePointId
      ? input.timelineLabelMap.get(input.activeTimelinePointId)
      : undefined) ||
    "原点";
  const browsingTimelineLabel =
    (input.activeTimelinePointId && input.timelineLabelMap.get(input.activeTimelinePointId)) ||
    "原点";

  return {
    activeContentNode,
    activeAuxNode,
    activeTimelineLabel,
    browsingTimelineLabel,
  };
}

export function deriveProjectEditorState(input: {
  activeContentNode: ContentTreeNodeVM | null;
  activeAuxNode: AuxTreeNodeVM | null;
  shouldShowContent: boolean;
  drafts: Record<string, string>;
  committedBodies: Record<string, string>;
  pendingSaveCounts: Record<string, number>;
  saveErrors: Record<string, string>;
}) {
  const editorBody = input.activeContentNode
    ? (input.drafts[input.activeContentNode.id] ?? input.activeContentNode.body)
    : "";
  const editorContent =
    input.activeAuxNode?.nodeType === "file"
      ? (input.drafts[input.activeAuxNode.id] ?? input.activeAuxNode.content)
      : "";
  const activeSaveBaseline = input.activeContentNode
    ? (input.committedBodies[input.activeContentNode.id] ?? input.activeContentNode.body)
    : "";
  const activeSaveState: SaveState = {
    isSaving: input.activeContentNode
      ? (input.pendingSaveCounts[input.activeContentNode.id] ?? 0) > 0
      : false,
    isDirty: input.activeContentNode ? editorBody !== activeSaveBaseline : false,
    error: input.activeContentNode ? (input.saveErrors[input.activeContentNode.id] ?? null) : null,
  };
  const auxSaveBaseline =
    input.activeAuxNode?.nodeType === "file"
      ? (input.committedBodies[input.activeAuxNode.id] ?? input.activeAuxNode.content)
      : "";
  const auxSaveState: SaveState = {
    isSaving:
      input.activeAuxNode?.nodeType === "file"
        ? (input.pendingSaveCounts[input.activeAuxNode.id] ?? 0) > 0
        : false,
    isDirty: input.activeAuxNode?.nodeType === "file" ? editorContent !== auxSaveBaseline : false,
    error:
      input.activeAuxNode?.nodeType === "file"
        ? (input.saveErrors[input.activeAuxNode.id] ?? null)
        : null,
  };
  const editorTarget: "content" | "aux" | null = input.activeAuxNode
    ? "aux"
    : input.shouldShowContent && input.activeContentNode
      ? "content"
      : null;

  return {
    editorBody,
    editorContent,
    activeSaveState,
    auxSaveState,
    editorTarget,
  };
}
