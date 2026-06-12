import { expect, mock, test } from "bun:test";

import type { WorkspaceMutationEvent } from "@/modules/ai/domain/types";
import type { AuxTreeNodeVM } from "@/modules/workspace/ui/editor/model/types";

import {
  handleAuxWorkspaceMutationForEditor,
  isActiveAuxFileMutationTarget,
  shouldRefetchAuxForWorkspaceMutation,
} from "./WorkspaceEditorPage";

function createWorkspaceMutationEvent(
  overrides: Partial<WorkspaceMutationEvent> = {},
): WorkspaceMutationEvent {
  return {
    type: "workspace-mutated",
    workspaceId: "workspace_1",
    area: "aux",
    timelinePointId: "timeline_1",
    toolName: "write_reference_overlay_file",
    action: "updated",
    path: "/设定/角色.md",
    nodeId: "aux_1",
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

test("shouldRefetchAuxForWorkspaceMutation only returns true for the active workspace timeline", () => {
  const event = createWorkspaceMutationEvent();

  expect(
    shouldRefetchAuxForWorkspaceMutation({
      event,
      workspaceId: "workspace_1",
      activeTimelinePointId: "timeline_1",
    }),
  ).toBe(true);
  expect(
    shouldRefetchAuxForWorkspaceMutation({
      event,
      workspaceId: "workspace_2",
      activeTimelinePointId: "timeline_1",
    }),
  ).toBe(false);
  expect(
    shouldRefetchAuxForWorkspaceMutation({
      event,
      workspaceId: "workspace_1",
      activeTimelinePointId: "timeline_2",
    }),
  ).toBe(false);
  expect(
    shouldRefetchAuxForWorkspaceMutation({
      event: createWorkspaceMutationEvent({ area: "aux" }),
      workspaceId: null,
      activeTimelinePointId: "timeline_1",
    }),
  ).toBe(false);
});

test("isActiveAuxFileMutationTarget matches the active file by node id before falling back to path", () => {
  const activeAuxNode = createAuxFileNode();

  expect(
    isActiveAuxFileMutationTarget({
      event: createWorkspaceMutationEvent({ nodeId: "aux_1", path: "/其他/资料.md" }),
      activeAuxNode,
    }),
  ).toBe(true);
  expect(
    isActiveAuxFileMutationTarget({
      event: createWorkspaceMutationEvent({ nodeId: null, path: "/设定/角色.md" }),
      activeAuxNode,
    }),
  ).toBe(true);
  expect(
    isActiveAuxFileMutationTarget({
      event: createWorkspaceMutationEvent({ nodeId: "aux_2", path: "/其他/资料.md" }),
      activeAuxNode,
    }),
  ).toBe(false);
  expect(
    isActiveAuxFileMutationTarget({
      event: createWorkspaceMutationEvent({
        toolName: "move_reference_overlay_node",
        action: "moved",
        nodeId: "aux_1",
        path: "/资料库/主角.md",
        previousPath: "/设定/角色.md",
      }),
      activeAuxNode,
    }),
  ).toBe(true);
  expect(
    isActiveAuxFileMutationTarget({
      event: createWorkspaceMutationEvent(),
      activeAuxNode: createAuxFileNode({ nodeType: "dir" }),
    }),
  ).toBe(false);
});

test("handleAuxWorkspaceMutationForEditor refetches aux data and clears active drafts for the mutated file", () => {
  const refetchAux = mock(() => {});
  const clearActiveAuxDraftState = mock(() => {});

  const handled = handleAuxWorkspaceMutationForEditor({
    event: createWorkspaceMutationEvent(),
    workspaceId: "workspace_1",
    activeTimelinePointId: "timeline_1",
    activeAuxNode: createAuxFileNode(),
    refetchAux,
    clearActiveAuxDraftState,
  });

  expect(handled).toBe(true);
  expect(refetchAux).toHaveBeenCalledTimes(1);
  expect(clearActiveAuxDraftState).toHaveBeenCalledTimes(1);
  expect(clearActiveAuxDraftState).toHaveBeenCalledWith("aux_1");
});

test("handleAuxWorkspaceMutationForEditor ignores unrelated workspace mutations", () => {
  const refetchAux = mock(() => {});
  const clearActiveAuxDraftState = mock(() => {});

  const handled = handleAuxWorkspaceMutationForEditor({
    event: createWorkspaceMutationEvent({ workspaceId: "workspace_2" }),
    workspaceId: "workspace_1",
    activeTimelinePointId: "timeline_1",
    activeAuxNode: createAuxFileNode(),
    refetchAux,
    clearActiveAuxDraftState,
  });

  expect(handled).toBe(false);
  expect(refetchAux).not.toHaveBeenCalled();
  expect(clearActiveAuxDraftState).not.toHaveBeenCalled();
});

test("handleAuxWorkspaceMutationForEditor refetches without clearing unrelated drafts", () => {
  const refetchAux = mock(() => {});
  const clearActiveAuxDraftState = mock(() => {});

  const handled = handleAuxWorkspaceMutationForEditor({
    event: createWorkspaceMutationEvent({ nodeId: "aux_2", path: "/其他/资料.md" }),
    workspaceId: "workspace_1",
    activeTimelinePointId: "timeline_1",
    activeAuxNode: createAuxFileNode(),
    refetchAux,
    clearActiveAuxDraftState,
  });

  expect(handled).toBe(true);
  expect(refetchAux).toHaveBeenCalledTimes(1);
  expect(clearActiveAuxDraftState).not.toHaveBeenCalled();
});

test("handleAuxWorkspaceMutationForEditor clears active drafts for move_reference_overlay_node matched by node id", () => {
  const refetchAux = mock(() => {});
  const clearActiveAuxDraftState = mock(() => {});

  const handled = handleAuxWorkspaceMutationForEditor({
    event: createWorkspaceMutationEvent({
      toolName: "move_reference_overlay_node",
      action: "moved",
      path: "/资料库/主角.md",
      previousPath: "/设定/角色.md",
      nodeId: "aux_1",
    }),
    workspaceId: "workspace_1",
    activeTimelinePointId: "timeline_1",
    activeAuxNode: createAuxFileNode(),
    refetchAux,
    clearActiveAuxDraftState,
  });

  expect(handled).toBe(true);
  expect(refetchAux).toHaveBeenCalledTimes(1);
  expect(clearActiveAuxDraftState).toHaveBeenCalledWith("aux_1");
});

test("handleAuxWorkspaceMutationForEditor refetches for create_reference_overlay_link without clearing unrelated drafts", () => {
  const refetchAux = mock(() => {});
  const clearActiveAuxDraftState = mock(() => {});

  const handled = handleAuxWorkspaceMutationForEditor({
    event: createWorkspaceMutationEvent({
      toolName: "create_reference_overlay_link",
      action: "created",
      path: "/索引/角色.md",
      targetPath: "/设定/角色.md",
      nodeId: "aux_link_1",
    }),
    workspaceId: "workspace_1",
    activeTimelinePointId: "timeline_1",
    activeAuxNode: createAuxFileNode(),
    refetchAux,
    clearActiveAuxDraftState,
  });

  expect(handled).toBe(true);
  expect(refetchAux).toHaveBeenCalledTimes(1);
  expect(clearActiveAuxDraftState).not.toHaveBeenCalled();
});
