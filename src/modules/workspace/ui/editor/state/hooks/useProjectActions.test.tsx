import { ScopeProvider } from "bunshi/react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

import { ORIGIN_TIMELINE_POINT_ID } from "@/modules/workspace/domain/constants";
import type { AuxTreeNodeVM, TimelinePointVM } from "@/modules/workspace/ui/editor/model/types";
import { useWorkspaceStoreApi, type WorkspaceStore } from "../molecules/workspaceStore";
import { ProjectScope } from "../scopes";
import { useProjectActions } from "./useProjectActions";
import type { ProjectWorkspaceState } from "./useProjectWorkspace";

function createAuxNode(overrides: Partial<AuxTreeNodeVM> & Pick<AuxTreeNodeVM, "id" | "name">) {
  const { id, name, ...rest } = overrides;
  return {
    id,
    nodeType: "file",
    name,
    content: "",
    path: id,
    symlinkTargetPath: null,
    hasTimelineChange: false,
    children: [],
    ...rest,
  } satisfies AuxTreeNodeVM;
}

function buildAuxMaps(nodes: AuxTreeNodeVM[], parentId: string | null = null) {
  const nodeMap = new Map<string, AuxTreeNodeVM>();
  const parentMap = new Map<string, string | null>();

  const visit = (currentNodes: AuxTreeNodeVM[], currentParentId: string | null) => {
    for (const node of currentNodes) {
      nodeMap.set(node.id, node);
      parentMap.set(node.id, currentParentId);
      visit(node.children, node.id);
    }
  };

  visit(nodes, parentId);
  return { nodeMap, parentMap };
}

function createWorkspaceState(input: {
  auxTree: AuxTreeNodeVM[];
  auxRootPath?: string;
  timelinePoints?: TimelinePointVM[];
  timelineMoveMutate?: (_input: {
    workspaceId: string;
    pointId: string;
    afterPointId: string;
  }) => Promise<void>;
  moveMutate?: (_input: {
    workspaceId: string;
    timelinePointId: string;
    path: string;
    newPath: string;
  }) => Promise<{ path: string }>;
  linkMutate?: (_input: {
    workspaceId: string;
    timelinePointId: string;
    path: string;
    targetPath: string;
  }) => Promise<{ path: string }>;
  writeFileMutate?: (_input: {
    workspaceId: string;
    timelinePointId: string;
    path: string;
    content: string;
  }) => Promise<{ path: string }>;
  retargetMutate?: (_input: {
    workspaceId: string;
    timelinePointId: string;
    path: string;
    targetPath: string;
  }) => Promise<{ path: string }>;
  restoreDeletedMutate?: (_input: {
    workspaceId: string;
    timelinePointId: string;
    path: string;
  }) => Promise<{ path: string }>;
}) {
  const auxRootPath = input.auxRootPath ?? "/";
  const { nodeMap, parentMap } = buildAuxMaps(input.auxTree, auxRootPath);

  return {
    identity: {
      workspaceId: "workspace_1",
    },
    content: {
      tree: [],
      flatNodes: [],
      nodeMap: new Map(),
      parentMap: new Map(),
      createContent: { isPending: false, mutate: vi.fn(async () => ({ id: "content_new" })) },
      deleteContent: { isPending: false, mutate: vi.fn(async () => undefined) },
      moveContent: { isPending: false, mutate: vi.fn(async () => undefined) },
      updateContent: { isPending: false, mutate: vi.fn(async () => ({ id: "content_1" })) },
    },
    timeline: {
      points: input.timelinePoints ?? [],
      createTimeline: { isPending: false, mutate: mock(async () => ({ id: "point_new" })) },
      moveTimeline: {
        isPending: false,
        mutate: input.timelineMoveMutate ?? mock(async () => undefined),
      },
      deleteTimeline: { isPending: false, mutate: mock(async () => undefined) },
      updateTimeline: { isPending: false, mutate: mock(async () => undefined) },
    },
    aux: {
      tree: input.auxTree,
      rootId: auxRootPath,
      nodeMap,
      parentMap,
      mkdirAux: { isPending: false, mutate: mock(async () => ({ path: "/aux_dir_new" })) },
      writeFileAux: {
        isPending: false,
        mutate: input.writeFileMutate ?? mock(async () => ({ path: "/aux_file_new" })),
      },
      linkAux: {
        isPending: false,
        mutate:
          input.linkMutate ??
          mock(async () => ({
            path: "/aux_link_new",
          })),
      },
      moveAux: {
        isPending: false,
        mutate:
          input.moveMutate ??
          mock(async () => ({
            path: "/aux_moved",
          })),
      },
      retargetSymlinkAux: {
        isPending: false,
        mutate:
          input.retargetMutate ??
          mock(async () => ({
            path: "/aux_retargeted",
          })),
      },
      deleteAux: { isPending: false, mutate: mock(async () => undefined) },
      restoreDeletedAux: {
        isPending: false,
        mutate: input.restoreDeletedMutate ?? mock(async () => ({ path: "/aux_restored" })),
      },
    },
    selection: {
      activeContentNode: null,
    },
    editor: {},
  } as unknown as ProjectWorkspaceState;
}

function renderActions(workspace: ProjectWorkspaceState): {
  actions: ReturnType<typeof useProjectActions>;
  store: WorkspaceStore;
} {
  let capturedActions: ReturnType<typeof useProjectActions> | null = null;
  let capturedStore: WorkspaceStore | null = null;

  function Harness() {
    capturedActions = useProjectActions(workspace);
    capturedStore = useWorkspaceStoreApi();
    return null;
  }

  renderToStaticMarkup(
    <ScopeProvider scope={ProjectScope} value="project_actions_test">
      <Harness />
    </ScopeProvider>,
  );

  const actions = capturedActions;
  const store = capturedStore;

  if (!actions || !store) {
    throw new Error("failed to capture hook state");
  }

  return { actions, store };
}

function createTimelinePoint(
  overrides: Partial<TimelinePointVM> & Pick<TimelinePointVM, "id" | "label">,
) {
  const { id, label, ...rest } = overrides;
  return {
    id,
    label,
    description: "",
    isImplicitOrigin: false,
    ...rest,
  } satisfies TimelinePointVM;
}

test("handleAuxCreateSymlink creates a same-directory symlink with a unique generated name", async () => {
  const target = createAuxNode({ id: "/notes.md", name: "notes.md" });
  const workspace = createWorkspaceState({
    auxTree: [
      target,
      createAuxNode({ id: "/notes.md - 链接 1", name: "notes.md - 链接 1" }),
      createAuxNode({ id: "/notes.md - 链接 2", name: "notes.md - 链接 2" }),
    ],
    linkMutate: mock(async () => ({ path: "/notes.md - 链接 3" })),
  });
  const { actions, store } = renderActions(workspace);

  store.getState().setActiveTimelinePointId("timeline_1");
  store.getState().setShouldAutoSelectContent(true);
  await actions.handleAuxCreateSymlink(target, "aux:create-symlink:/notes.md");

  expect(workspace.aux.linkAux.mutate).toHaveBeenCalledWith({
    workspaceId: "workspace_1",
    timelinePointId: "timeline_1",
    path: "/notes.md - 链接 3",
    targetPath: "/notes.md",
  });
  expect(store.getState().activeAuxPath).toBe("/notes.md - 链接 3");
  expect(store.getState().pendingAuxPath).toBe("/notes.md - 链接 3");
  expect(store.getState().shouldAutoSelectContent).toBe(false);
  expect(store.getState().expandedAuxPaths.has("/")).toBe(true);
});

test("handleAuxCreateSymlink reports action errors without changing selection on failure", async () => {
  const target = createAuxNode({ id: "/notes.md", name: "notes.md" });
  const workspace = createWorkspaceState({
    auxTree: [target],
    linkMutate: mock(async () => {
      throw new Error("创建失败");
    }),
  });
  const { actions, store } = renderActions(workspace);

  store.getState().setActiveTimelinePointId("timeline_1");
  await actions.handleAuxCreateSymlink(target, "aux:create-symlink:/notes.md");

  expect(store.getState().activeAuxPath).toBeNull();
  expect(store.getState().auxError).toEqual({
    message: "创建失败",
    anchorId: "aux:create-symlink:/notes.md",
  });
});

test("handleAuxCreateSymlink links to the symlink node itself when invoked on a symlink row", async () => {
  const symlink = createAuxNode({
    id: "/角色入口",
    nodeType: "symlink",
    name: "角色入口",
    symlinkTargetPath: "/设定/角色.md",
  });
  const workspace = createWorkspaceState({
    auxTree: [symlink],
    linkMutate: mock(async () => ({ path: "/角色入口 - 链接 1" })),
  });
  const { actions, store } = renderActions(workspace);

  store.getState().setActiveTimelinePointId("timeline_1");
  await actions.handleAuxCreateSymlink(symlink, "aux:create-symlink:/角色入口");

  expect(workspace.aux.linkAux.mutate).toHaveBeenCalledWith({
    workspaceId: "workspace_1",
    timelinePointId: "timeline_1",
    path: "/角色入口 - 链接 1",
    targetPath: "/角色入口",
  });
});

test("handleAuxCreateSiblingFile creates markdown files by default", async () => {
  const workspace = createWorkspaceState({
    auxTree: [
      createAuxNode({ id: "/新文件 1.md", name: "新文件 1.md" }),
      createAuxNode({ id: "/新文件 2.md", name: "新文件 2.md" }),
    ],
    writeFileMutate: mock(async () => ({ path: "/新文件 3.md" })),
  });
  const { actions, store } = renderActions(workspace);

  store.getState().setActiveTimelinePointId("timeline_1");
  await actions.handleAuxCreateSiblingFile("aux:add-file:root");

  expect(workspace.aux.writeFileAux.mutate).toHaveBeenCalledWith({
    workspaceId: "workspace_1",
    timelinePointId: "timeline_1",
    path: "/新文件 3.md",
    content: "",
  });
  expect(store.getState().activeAuxPath).toBe("/新文件 3.md");
  expect(store.getState().pendingAuxPath).toBe("/新文件 3.md");
});

test("handleAuxMove moves a node into a directory and keeps its current name", async () => {
  const workspace = createWorkspaceState({
    auxTree: [
      createAuxNode({ id: "/设定", name: "设定", nodeType: "dir", path: "/设定" }),
      createAuxNode({ id: "/notes.md", name: "notes.md", path: "/notes.md" }),
    ],
  });
  const { actions, store } = renderActions(workspace);

  store.getState().setActiveTimelinePointId("timeline_1");
  await actions.handleAuxMove({ nodeId: "/notes.md", targetId: "/设定" });

  expect(workspace.aux.moveAux.mutate).toHaveBeenCalledWith({
    workspaceId: "workspace_1",
    timelinePointId: "timeline_1",
    path: "/notes.md",
    newPath: "/设定/notes.md",
  });
  expect(store.getState().expandedAuxPaths.has("/设定")).toBe(true);
});

test("handleAuxMove reports server errors on the source row anchor", async () => {
  const workspace = createWorkspaceState({
    auxTree: [
      createAuxNode({ id: "/设定", name: "设定", nodeType: "dir" }),
      createAuxNode({ id: "/notes.md", name: "notes.md" }),
    ],
    moveMutate: mock(async () => {
      throw new Error("重名冲突");
    }),
  });
  const { actions, store } = renderActions(workspace);

  store.getState().setActiveTimelinePointId("timeline_1");
  await actions.handleAuxMove({ nodeId: "/notes.md", targetId: "/设定" });

  expect(store.getState().auxError).toEqual({
    message: "重名冲突",
    anchorId: "aux:row:/notes.md",
  });
});

test("enterAuxSymlinkTargetPicker tracks the source symlink and expands current target ancestors", () => {
  const workspace = createWorkspaceState({
    auxTree: [
      createAuxNode({
        id: "/设定",
        name: "设定",
        nodeType: "dir",
        children: [
          createAuxNode({ id: "/设定/角色.md", name: "角色.md", path: "/设定/角色.md" }),
          createAuxNode({
            id: "/索引/角色入口",
            name: "角色入口",
            nodeType: "symlink",
            symlinkTargetPath: "/设定/角色.md",
          }),
        ],
      }),
    ],
  });
  const { actions, store } = renderActions(workspace);

  actions.enterAuxSymlinkTargetPicker("/索引/角色入口");

  expect(store.getState().isAuxSymlinkTargetPickerActive).toBe(true);
  expect(store.getState().auxSymlinkTargetPickerSourceId).toBe("/索引/角色入口");
  expect(store.getState().activeAuxPath).toBe("/索引/角色入口");
  expect(store.getState().expandedAuxPaths.has("/设定")).toBe(true);
});

test("cancelAuxSymlinkTargetPicker exits without changing selection", () => {
  const workspace = createWorkspaceState({
    auxTree: [
      createAuxNode({
        id: "/索引/角色入口",
        name: "角色入口",
        nodeType: "symlink",
        symlinkTargetPath: "/设定/角色.md",
      }),
      createAuxNode({ id: "/设定/角色.md", name: "角色.md" }),
    ],
  });
  const { actions, store } = renderActions(workspace);

  store.getState().setActiveAuxPath("/索引/角色入口");
  store.getState().setIsAuxSymlinkTargetPickerActive(true);
  store.getState().setAuxSymlinkTargetPickerSourceId("/索引/角色入口");
  actions.cancelAuxSymlinkTargetPicker();

  expect(store.getState().isAuxSymlinkTargetPickerActive).toBe(false);
  expect(store.getState().auxSymlinkTargetPickerSourceId).toBeNull();
  expect(store.getState().activeAuxPath).toBe("/索引/角色入口");
});

test("submitAuxSymlinkTargetRetarget updates the source symlink and exits picker mode", async () => {
  const workspace = createWorkspaceState({
    auxTree: [
      createAuxNode({
        id: "/索引/角色入口",
        name: "角色入口",
        nodeType: "symlink",
        symlinkTargetPath: "/设定/旧角色.md",
      }),
      createAuxNode({ id: "/设定/旧角色.md", name: "旧角色.md" }),
      createAuxNode({ id: "/设定/新角色.md", name: "新角色.md" }),
    ],
    retargetMutate: mock(async () => ({ path: "/索引/角色入口" })),
  });
  const { actions, store } = renderActions(workspace);

  store.getState().setActiveTimelinePointId("timeline_1");
  store.getState().setActiveAuxPath("/索引/角色入口");
  store.getState().setIsAuxSymlinkTargetPickerActive(true);
  store.getState().setAuxSymlinkTargetPickerSourceId("/索引/角色入口");
  await actions.submitAuxSymlinkTargetRetarget("/设定/新角色.md");

  expect(workspace.aux.retargetSymlinkAux.mutate).toHaveBeenCalledWith({
    workspaceId: "workspace_1",
    timelinePointId: "timeline_1",
    path: "/索引/角色入口",
    targetPath: "/设定/新角色.md",
  });
  expect(store.getState().isAuxSymlinkTargetPickerActive).toBe(false);
  expect(store.getState().auxSymlinkTargetPickerSourceId).toBeNull();
  expect(store.getState().activeAuxPath).toBe("/索引/角色入口");
});

test("submitAuxSymlinkTargetRetarget ignores the current target without requesting changes", async () => {
  const workspace = createWorkspaceState({
    auxTree: [
      createAuxNode({
        id: "/索引/角色入口",
        name: "角色入口",
        nodeType: "symlink",
        symlinkTargetPath: "/设定/角色.md",
      }),
      createAuxNode({ id: "/设定/角色.md", name: "角色.md" }),
    ],
  });
  const { actions, store } = renderActions(workspace);

  store.getState().setActiveTimelinePointId("timeline_1");
  store.getState().setActiveAuxPath("/索引/角色入口");
  store.getState().setIsAuxSymlinkTargetPickerActive(true);
  store.getState().setAuxSymlinkTargetPickerSourceId("/索引/角色入口");
  await actions.submitAuxSymlinkTargetRetarget("/设定/角色.md");

  expect(workspace.aux.retargetSymlinkAux.mutate).not.toHaveBeenCalled();
  expect(store.getState().isAuxSymlinkTargetPickerActive).toBe(true);
  expect(store.getState().auxSymlinkTargetPickerSourceId).toBe("/索引/角色入口");
});

test("submitAuxSymlinkTargetRetarget keeps picker mode active and reports errors", async () => {
  const workspace = createWorkspaceState({
    auxTree: [
      createAuxNode({
        id: "/索引/角色入口",
        name: "角色入口",
        nodeType: "symlink",
        symlinkTargetPath: "/设定/旧角色.md",
      }),
      createAuxNode({ id: "/设定/旧角色.md", name: "旧角色.md" }),
      createAuxNode({ id: "/设定/新角色.md", name: "新角色.md" }),
    ],
    retargetMutate: mock(async () => {
      throw new Error("循环冲突");
    }),
  });
  const { actions, store } = renderActions(workspace);

  store.getState().setActiveTimelinePointId("timeline_1");
  store.getState().setActiveAuxPath("/索引/角色入口");
  store.getState().setIsAuxSymlinkTargetPickerActive(true);
  store.getState().setAuxSymlinkTargetPickerSourceId("/索引/角色入口");
  await actions.submitAuxSymlinkTargetRetarget("/设定/新角色.md");

  expect(store.getState().isAuxSymlinkTargetPickerActive).toBe(true);
  expect(store.getState().auxSymlinkTargetPickerSourceId).toBe("/索引/角色入口");
  expect(store.getState().auxError).toEqual({
    message: "循环冲突",
    anchorId: "aux:row:/索引/角色入口",
  });
});

test("handleAuxRestoreDeleted restores a deleted path and clears local aux state", async () => {
  const restoreDeletedMutate = mock(async () => ({ path: "/notes.md" }));
  const workspace = createWorkspaceState({
    auxTree: [createAuxNode({ id: "/notes.md", name: "notes.md", overlayStatus: "deleted" })],
    restoreDeletedMutate,
  });
  const { actions, store } = renderActions(workspace);

  store.getState().setActiveTimelinePointId("timeline_1");
  store.getState().setActiveAuxPath("/notes.md");
  store.getState().setPendingAuxPath("/notes.md");
  store.getState().setDrafts({ "/notes.md": "draft" });
  store.getState().setCommittedBodies({ "/notes.md": "committed" });
  store.getState().setPendingSaveCounts({ "/notes.md": 1 });
  store.getState().setSaveErrors({ "/notes.md": "failed" });

  await actions.handleAuxRestoreDeleted("/notes.md", "aux:restore-deleted:/notes.md");

  expect(restoreDeletedMutate).toHaveBeenCalledWith({
    workspaceId: "workspace_1",
    timelinePointId: "timeline_1",
    path: "/notes.md",
  });
  expect(store.getState().activeAuxPath).toBeNull();
  expect(store.getState().pendingAuxPath).toBeNull();
  expect(store.getState().drafts).toEqual({});
  expect(store.getState().committedBodies).toEqual({});
  expect(store.getState().pendingSaveCounts).toEqual({});
  expect(store.getState().saveErrors).toEqual({});
});

test("handleTimelineMove calls the timeline move RPC with the requested anchor", async () => {
  const timelinePoints = [
    createTimelinePoint({
      id: ORIGIN_TIMELINE_POINT_ID,
      label: "原点",
      isImplicitOrigin: true,
    }),
    createTimelinePoint({ id: "point_a", label: "A" }),
    createTimelinePoint({ id: "point_b", label: "B" }),
    createTimelinePoint({ id: "point_c", label: "C" }),
  ];
  const workspace = createWorkspaceState({
    auxTree: [],
    timelinePoints,
    timelineMoveMutate: mock(async () => undefined),
  });
  const { actions } = renderActions(workspace);
  await actions.handleTimelineMove("point_c", ORIGIN_TIMELINE_POINT_ID);

  expect(workspace.timeline.moveTimeline.mutate).toHaveBeenCalledWith({
    workspaceId: "workspace_1",
    pointId: "point_c",
    afterPointId: ORIGIN_TIMELINE_POINT_ID,
  });
});

test("handleTimelineMove reports timeline move failures on the dragged row anchor", async () => {
  const timelinePoints = [
    createTimelinePoint({
      id: ORIGIN_TIMELINE_POINT_ID,
      label: "原点",
      isImplicitOrigin: true,
    }),
    createTimelinePoint({ id: "point_a", label: "A" }),
    createTimelinePoint({ id: "point_b", label: "B" }),
    createTimelinePoint({ id: "point_c", label: "C" }),
  ];
  const workspace = createWorkspaceState({
    auxTree: [],
    timelinePoints,
    timelineMoveMutate: mock(async () => {
      throw new Error("移动失败");
    }),
  });
  const { actions, store } = renderActions(workspace);
  await actions.handleTimelineMove("point_a", "point_b");

  expect(store.getState().timelineError).toEqual({
    message: "移动失败",
    anchorId: "timeline:row:point_a",
  });
});
