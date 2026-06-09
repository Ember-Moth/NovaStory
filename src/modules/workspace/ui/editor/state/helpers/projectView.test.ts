import { expect, test } from "bun:test";

import type { AuxTreeNodeVM, ContentTreeNodeVM } from "@/modules/workspace/ui/editor/model/types";

import { deriveProjectEditorState, deriveProjectSelectionState } from "./projectView";

test("deriveProjectSelectionState resolves active nodes and timeline labels", () => {
  const contentNode: ContentTreeNodeVM = {
    id: "content_1",
    title: "Chapter 1",
    body: "Text",
    anchorTimelinePointId: "point_a",
    children: [],
  };
  const auxNode: AuxTreeNodeVM = {
    id: "aux_1",
    nodeType: "file",
    name: "notes.md",
    content: "Notes",
    path: "/notes.md",
    symlinkTargetPath: null,
    hasTimelineChange: false,
    isDeleted: false,
    children: [],
  };

  const selection = deriveProjectSelectionState({
    activeContentNodeId: "content_1",
    activeAuxNodeId: "aux_1",
    activeTimelinePointId: "point_b",
    contentNodeMap: new Map([[contentNode.id, contentNode]]),
    auxNodeMap: new Map([[auxNode.id, auxNode]]),
    timelineLabelMap: new Map([
      ["point_a", "Point A"],
      ["point_b", "Point B"],
    ]),
  });

  expect(selection.activeContentNode?.id).toBe("content_1");
  expect(selection.activeAuxNode?.id).toBe("aux_1");
  expect(selection.activeTimelineLabel).toBe("Point A");
  expect(selection.browsingTimelineLabel).toBe("Point B");
});

test("deriveProjectEditorState computes content and aux save state independently", () => {
  const activeContentNode: ContentTreeNodeVM = {
    id: "content_1",
    title: "Chapter 1",
    body: "Committed body",
    anchorTimelinePointId: "point_a",
    children: [],
  };
  const activeAuxNode: AuxTreeNodeVM = {
    id: "aux_1",
    nodeType: "file",
    name: "notes.md",
    content: "Committed aux",
    path: "/notes.md",
    symlinkTargetPath: null,
    hasTimelineChange: true,
    isDeleted: false,
    children: [],
  };

  const editor = deriveProjectEditorState({
    activeContentNode,
    activeAuxNode,
    shouldShowContent: true,
    drafts: {
      content_1: "Draft body",
      aux_1: "Draft aux",
    },
    committedBodies: {
      aux_1: "Committed aux",
    },
    pendingSaveCounts: {
      aux_1: 1,
    },
    saveErrors: {
      aux_1: "Save failed",
    },
  });

  expect(editor.editorTarget).toBe("aux");
  expect(editor.editorBody).toBe("Draft body");
  expect(editor.editorContent).toBe("Draft aux");
  expect(editor.activeSaveState).toEqual({
    isSaving: false,
    isDirty: true,
    error: null,
  });
  expect(editor.auxSaveState).toEqual({
    isSaving: true,
    isDirty: true,
    error: "Save failed",
  });
});

test("deriveProjectEditorState can keep the editor empty after aux selection is cleared", () => {
  const activeContentNode: ContentTreeNodeVM = {
    id: "content_1",
    title: "Chapter 1",
    body: "Committed body",
    anchorTimelinePointId: "point_a",
    children: [],
  };

  const editor = deriveProjectEditorState({
    activeContentNode,
    activeAuxNode: null,
    shouldShowContent: false,
    drafts: {},
    committedBodies: {},
    pendingSaveCounts: {},
    saveErrors: {},
  });

  expect(editor.editorTarget).toBe(null);
  expect(editor.editorBody).toBe("Committed body");
});
