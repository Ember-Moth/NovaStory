import { expect, test } from "bun:test";

import type { WorkspaceRefreshRequestedEvent } from "@/modules/ai/domain/types";
import type { AuxTreeNodeVM } from "@/modules/workspace/ui/editor/model/types";

import {
  shouldClearActiveAuxDraftForRefresh,
  shouldClearActiveContentDraftForRefresh,
  shouldHandleWorkspaceRefreshRequested,
} from "./WorkspaceEditorPage";

function createWorkspaceRefreshRequestedEvent(
  overrides: Partial<WorkspaceRefreshRequestedEvent> = {},
): WorkspaceRefreshRequestedEvent {
  return {
    type: "workspace-refresh-requested",
    workspaceId: "workspace_1",
    areas: ["aux"],
    auxNodeId: "aux_1",
    ...overrides,
  };
}

function createAuxFileNode(overrides: Partial<AuxTreeNodeVM> = {}): AuxTreeNodeVM {
  return {
    id: "aux_1",
    nodeType: "file",
    name: "角色.md",
    content: "",
    path: "/设定/角色.md",
    symlinkTargetAuxNodeId: null,
    symlinkTargetPath: null,
    hasTimelineChange: false,
    isDeleted: false,
    children: [],
    ...overrides,
  };
}

test("shouldHandleWorkspaceRefreshRequested only returns true for the active workspace", () => {
  const event = createWorkspaceRefreshRequestedEvent();

  expect(
    shouldHandleWorkspaceRefreshRequested({
      event,
      workspaceId: "workspace_1",
    }),
  ).toBe(true);
  expect(
    shouldHandleWorkspaceRefreshRequested({
      event,
      workspaceId: "workspace_2",
    }),
  ).toBe(false);
  expect(
    shouldHandleWorkspaceRefreshRequested({
      event,
      workspaceId: null,
    }),
  ).toBe(false);
});

test("shouldClearActiveContentDraftForRefresh only clears the active content target", () => {
  expect(
    shouldClearActiveContentDraftForRefresh({
      event: createWorkspaceRefreshRequestedEvent({
        areas: ["content"],
        contentNodeId: "content_1",
      }),
      activeContentNodeId: "content_1",
    }),
  ).toBe(true);
  expect(
    shouldClearActiveContentDraftForRefresh({
      event: createWorkspaceRefreshRequestedEvent({
        areas: ["content"],
        contentNodeId: "content_2",
      }),
      activeContentNodeId: "content_1",
    }),
  ).toBe(false);
  expect(
    shouldClearActiveContentDraftForRefresh({
      event: createWorkspaceRefreshRequestedEvent({
        areas: ["timeline"],
        contentNodeId: "content_1",
      }),
      activeContentNodeId: "content_1",
    }),
  ).toBe(false);
  expect(
    shouldClearActiveContentDraftForRefresh({
      event: createWorkspaceRefreshRequestedEvent({
        areas: ["content"],
      }),
      activeContentNodeId: null,
    }),
  ).toBe(false);
});

test("shouldClearActiveAuxDraftForRefresh only clears the active aux file target", () => {
  expect(
    shouldClearActiveAuxDraftForRefresh({
      event: createWorkspaceRefreshRequestedEvent({
        areas: ["aux"],
        auxNodeId: "aux_1",
      }),
      activeAuxNode: createAuxFileNode(),
    }),
  ).toBe(true);
  expect(
    shouldClearActiveAuxDraftForRefresh({
      event: createWorkspaceRefreshRequestedEvent({
        areas: ["aux"],
        auxNodeId: "aux_2",
      }),
      activeAuxNode: createAuxFileNode(),
    }),
  ).toBe(false);
  expect(
    shouldClearActiveAuxDraftForRefresh({
      event: createWorkspaceRefreshRequestedEvent({
        areas: ["timeline", "aux"],
        auxNodeId: undefined,
      }),
      activeAuxNode: createAuxFileNode(),
    }),
  ).toBe(false);
  expect(
    shouldClearActiveAuxDraftForRefresh({
      event: createWorkspaceRefreshRequestedEvent({
        areas: ["aux"],
        auxNodeId: "aux_1",
      }),
      activeAuxNode: createAuxFileNode({ nodeType: "dir" }),
    }),
  ).toBe(false);
});
