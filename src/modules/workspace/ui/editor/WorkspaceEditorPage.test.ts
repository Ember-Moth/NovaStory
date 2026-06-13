import { expect, test } from "bun:test";

import type { WorkspaceRefreshRequestedEvent } from "@/modules/ai/domain/types";
import type { AuxTreeNodeVM } from "@/modules/workspace/ui/editor/model/types";

import {
  getAuxRefreshTargetTimelinePointId,
  getContentRefreshTargetNodeId,
  getContentRefreshTargetTimelinePointId,
  shouldClearActiveAuxDraftForRefresh,
  shouldClearActiveContentDraftForRefresh,
  shouldHandleWorkspaceRefreshRequested,
  shouldRefetchActiveAuxForRefresh,
} from "./workspaceEditorPageModel";

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
      activeTimelinePointId: "point_active",
    }),
  ).toBe(true);
  expect(
    shouldClearActiveAuxDraftForRefresh({
      event: createWorkspaceRefreshRequestedEvent({
        areas: ["aux"],
        auxNodeId: "aux_2",
      }),
      activeAuxNode: createAuxFileNode(),
      activeTimelinePointId: "point_active",
    }),
  ).toBe(false);
  expect(
    shouldClearActiveAuxDraftForRefresh({
      event: createWorkspaceRefreshRequestedEvent({
        areas: ["timeline", "aux"],
        auxNodeId: undefined,
      }),
      activeAuxNode: createAuxFileNode(),
      activeTimelinePointId: "point_active",
    }),
  ).toBe(false);
  expect(
    shouldClearActiveAuxDraftForRefresh({
      event: createWorkspaceRefreshRequestedEvent({
        areas: ["aux"],
        auxNodeId: "aux_1",
      }),
      activeAuxNode: createAuxFileNode({ nodeType: "dir" }),
      activeTimelinePointId: "point_active",
    }),
  ).toBe(false);
});

test("shouldClearActiveAuxDraftForRefresh only clears matching timeline target", () => {
  expect(
    shouldClearActiveAuxDraftForRefresh({
      event: createWorkspaceRefreshRequestedEvent({
        areas: ["aux"],
        auxNodeId: "aux_1",
        timelinePointId: "point_active",
      }),
      activeAuxNode: createAuxFileNode(),
      activeTimelinePointId: "point_active",
    }),
  ).toBe(true);
  expect(
    shouldClearActiveAuxDraftForRefresh({
      event: createWorkspaceRefreshRequestedEvent({
        areas: ["aux"],
        auxNodeId: "aux_1",
        timelinePointId: "point_other",
      }),
      activeAuxNode: createAuxFileNode(),
      activeTimelinePointId: "point_active",
    }),
  ).toBe(false);
});

test("getAuxRefreshTargetTimelinePointId returns the aux refresh target when present", () => {
  expect(
    getAuxRefreshTargetTimelinePointId(
      createWorkspaceRefreshRequestedEvent({
        areas: ["aux"],
        timelinePointId: "point_target",
      }),
    ),
  ).toBe("point_target");
  expect(
    getAuxRefreshTargetTimelinePointId(
      createWorkspaceRefreshRequestedEvent({
        areas: ["content"],
        timelinePointId: "point_target",
      }),
    ),
  ).toBeNull();
  expect(
    getAuxRefreshTargetTimelinePointId(
      createWorkspaceRefreshRequestedEvent({
        areas: ["aux"],
        timelinePointId: "",
      }),
    ),
  ).toBeNull();
});

test("getContentRefreshTarget helpers return content auto-open targets when present", () => {
  const event = createWorkspaceRefreshRequestedEvent({
    areas: ["content"],
    contentNodeId: "content_target",
    timelinePointId: "point_target",
  });

  expect(getContentRefreshTargetNodeId(event)).toBe("content_target");
  expect(getContentRefreshTargetTimelinePointId(event)).toBe("point_target");
  expect(
    getContentRefreshTargetNodeId(
      createWorkspaceRefreshRequestedEvent({
        areas: ["aux"],
        contentNodeId: "content_target",
      }),
    ),
  ).toBeNull();
  expect(
    getContentRefreshTargetTimelinePointId(
      createWorkspaceRefreshRequestedEvent({
        areas: ["content"],
        timelinePointId: "",
      }),
    ),
  ).toBeNull();
});

test("shouldRefetchActiveAuxForRefresh skips old aux query when refresh targets another timeline point", () => {
  expect(
    shouldRefetchActiveAuxForRefresh({
      event: createWorkspaceRefreshRequestedEvent({
        areas: ["aux"],
        timelinePointId: "point_active",
      }),
      activeTimelinePointId: "point_active",
    }),
  ).toBe(true);
  expect(
    shouldRefetchActiveAuxForRefresh({
      event: createWorkspaceRefreshRequestedEvent({
        areas: ["aux"],
        timelinePointId: "point_other",
      }),
      activeTimelinePointId: "point_active",
    }),
  ).toBe(false);
  expect(
    shouldRefetchActiveAuxForRefresh({
      event: createWorkspaceRefreshRequestedEvent({
        areas: ["aux"],
      }),
      activeTimelinePointId: "point_active",
    }),
  ).toBe(true);
  expect(
    shouldRefetchActiveAuxForRefresh({
      event: createWorkspaceRefreshRequestedEvent({
        areas: ["content"],
      }),
      activeTimelinePointId: "point_active",
    }),
  ).toBe(false);
});
