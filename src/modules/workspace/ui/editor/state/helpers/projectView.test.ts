import { expect, test } from "vitest";

import type { AuxTreeNodeVM, ContentTreeNodeVM } from "@/modules/workspace/ui/editor/model/types";

import {
  buildProjectAssistantEditorContext,
  deriveProjectEditorState,
  deriveProjectSelectionState,
} from "./projectView";

test("deriveProjectSelectionState resolves active nodes and timeline labels", () => {
  const contentNode: ContentTreeNodeVM = {
    id: "content_1",
    title: "Chapter 1",
    body: "Text",
    anchorTimelinePointId: "point_a",
    children: [],
  };
  const auxNode: AuxTreeNodeVM = {
    id: "/notes.md",
    nodeType: "file",
    name: "notes.md",
    content: "Notes",
    path: "/notes.md",
    symlinkTargetPath: null,
    hasTimelineChange: false,
    children: [],
  };

  const selection = deriveProjectSelectionState({
    activeContentNodeId: "content_1",
    activeAuxPath: "/notes.md",
    activeTimelinePointId: "point_b",
    contentNodeMap: new Map([[contentNode.id, contentNode]]),
    auxNodeMap: new Map([[auxNode.id, auxNode]]),
    timelineLabelMap: new Map([
      ["point_a", "Point A"],
      ["point_b", "Point B"],
    ]),
  });

  expect(selection.activeContentNode?.id).toBe("content_1");
  expect(selection.activeAuxNode?.id).toBe("/notes.md");
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
    id: "/notes.md",
    nodeType: "file",
    name: "notes.md",
    content: "Committed aux",
    path: "/notes.md",
    symlinkTargetPath: null,
    hasTimelineChange: true,
    children: [],
  };

  const editor = deriveProjectEditorState({
    activeContentNode,
    activeAuxNode,
    shouldShowContent: true,
    drafts: {
      content_1: "Draft body",
      "/notes.md": "Draft aux",
    },
    committedBodies: {
      "/notes.md": "Committed aux",
    },
    pendingSaveCounts: {
      "/notes.md": 1,
    },
    saveErrors: {
      "/notes.md": "Save failed",
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

test("buildProjectAssistantEditorContext keeps content and aux references mutually exclusive", () => {
  const activeContentNode: ContentTreeNodeVM = {
    id: "content_1",
    title: "Chapter 1",
    body: "Hidden body",
    anchorTimelinePointId: "point_a",
    children: [],
  };
  const activeAuxNode: AuxTreeNodeVM = {
    id: "/notes.md",
    nodeType: "file",
    name: "notes.md",
    content: "Hidden notes",
    path: "/notes.md",
    symlinkTargetPath: null,
    hasTimelineChange: false,
    children: [],
  };

  expect(
    buildProjectAssistantEditorContext({
      workspaceId: "workspace_1",
      editorTarget: "content",
      activeContentNode,
      activeAuxNode,
      activeTimelinePointId: "point_b",
      activeTimelineLabel: "Point B",
    }),
  ).toEqual({
    workspaceId: "workspace_1",
    activeContentNodeId: "content_1",
    activeContentTitle: null,
    activeAuxPath: null,
    activeTimelinePointId: "point_b",
    activeTimelineLabel: "Point B",
  });

  expect(
    buildProjectAssistantEditorContext({
      workspaceId: "workspace_1",
      editorTarget: "aux",
      activeContentNode,
      activeAuxNode,
      activeTimelinePointId: "point_b",
      activeTimelineLabel: "Point B",
    }),
  ).toEqual({
    workspaceId: "workspace_1",
    activeContentNodeId: null,
    activeContentTitle: null,
    activeAuxPath: "/notes.md",
    activeTimelinePointId: "point_b",
    activeTimelineLabel: "Point B",
  });
});
