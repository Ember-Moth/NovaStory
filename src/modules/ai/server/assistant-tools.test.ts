import { expect, test } from "bun:test";

import { setupMockDatabase } from "@/test/mock-db";

setupMockDatabase();

const { db, schema } = await import("@/db");
const workspaceDomain = await import("@/modules/workspace/domain");
const { createAssistantTools } = await import("./assistant-tools");
const { PROJECT_ASSISTANT_TOOL_NAMES } = await import("@/modules/ai/domain/types");

function createRuntimeContext(
  snapshot: {
    workspaceId: string | null;
    activeContentNodeId: string | null;
    activeContentTitle: string | null;
    activeAuxNodeId: string | null;
    activeAuxPath: string | null;
    activeTimelinePointId: string | null;
    activeTimelineLabel: string | null;
  } | null = null,
) {
  return {
    snapshot,
    updateSnapshot(updater: (current: typeof snapshot) => typeof snapshot) {
      this.snapshot = updater(this.snapshot);
    },
  };
}

function seedProject(projectId: string) {
  db.insert(schema.projects)
    .values({
      id: projectId,
      name: `Project ${projectId}`,
      description: null,
    })
    .run();
  return workspaceDomain.createDefaultWorkspace(projectId);
}

async function executeTool<TArgs, TResult>(toolDefinition: unknown, args: TArgs) {
  const execute = (toolDefinition as { execute?: (_args: TArgs, ..._rest: unknown[]) => TResult })
    .execute;
  expect(execute).toBeDefined();
  return await execute!(args);
}

test("createAssistantTools always exposes the full tool set", () => {
  seedProject("assistant_tools_filter");

  const tools = createAssistantTools({
    projectId: "assistant_tools_filter",
    runtimeContext: createRuntimeContext(),
  });

  expect(Object.keys(tools).sort()).toEqual([...PROJECT_ASSISTANT_TOOL_NAMES].sort());
  expect(tools.get_writing_context).toBeDefined();
  expect(tools.create_dir).toBeDefined();
  expect(tools.write_file).toBeDefined();
});

test("list_files returns a recursive tree by default and does not recurse into symlinks", async () => {
  const workspace = seedProject("assistant_tools_list_tree_default");
  const settingsDir = workspaceDomain.mkdirAt({
    workspaceId: workspace.id,
    timelinePointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
    parentDirId: workspace.auxRootId!,
    name: "设定",
  });
  const worldDir = workspaceDomain.mkdirAt({
    workspaceId: workspace.id,
    timelinePointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
    parentDirId: settingsDir.id,
    name: "世界观",
  });
  workspaceDomain.writeFileAt({
    workspaceId: workspace.id,
    timelinePointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
    parentDirId: settingsDir.id,
    name: "角色.md",
    content: "角色",
  });
  workspaceDomain.writeFileAt({
    workspaceId: workspace.id,
    timelinePointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
    parentDirId: worldDir.id,
    name: "阵营.md",
    content: "阵营",
  });
  workspaceDomain.writeFileAt({
    workspaceId: workspace.id,
    timelinePointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
    parentDirId: worldDir.id,
    name: "王都.md",
    content: "王都",
  });
  const indexDir = workspaceDomain.mkdirAt({
    workspaceId: workspace.id,
    timelinePointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
    parentDirId: workspace.auxRootId!,
    name: "索引",
  });
  workspaceDomain.linkAt({
    workspaceId: workspace.id,
    timelinePointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
    parentDirId: indexDir.id,
    name: "设定入口",
    targetNodeId: settingsDir.id,
  });
  const tools = createAssistantTools({
    projectId: "assistant_tools_list_tree_default",
    runtimeContext: createRuntimeContext(),
  });

  const result = await executeTool(tools.list_files!, {});

  expect(result).toEqual({
    ok: true,
    truncated: true,
    data: {
      path: "/",
      depth: 2,
      entries: [
        {
          id: indexDir.id,
          nodeType: "dir",
          name: "索引",
          path: "/索引",
          parentAuxNodeId: workspace.auxRootId,
          content: null,
          symlinkTargetAuxNodeId: null,
          symlinkTargetPath: null,
          timelinePointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
          hiddenChildrenCount: 0,
          children: [
            {
              id: expect.any(String),
              nodeType: "symlink",
              name: "设定入口",
              path: "/索引/设定入口",
              parentAuxNodeId: indexDir.id,
              content: null,
              symlinkTargetAuxNodeId: settingsDir.id,
              symlinkTargetPath: "/设定",
              timelinePointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
              hiddenChildrenCount: 0,
              children: [],
            },
          ],
        },
        {
          id: settingsDir.id,
          nodeType: "dir",
          name: "设定",
          path: "/设定",
          parentAuxNodeId: workspace.auxRootId,
          content: null,
          symlinkTargetAuxNodeId: null,
          symlinkTargetPath: null,
          timelinePointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
          hiddenChildrenCount: 0,
          children: [
            {
              id: worldDir.id,
              nodeType: "dir",
              name: "世界观",
              path: "/设定/世界观",
              parentAuxNodeId: settingsDir.id,
              content: null,
              symlinkTargetAuxNodeId: null,
              symlinkTargetPath: null,
              timelinePointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
              hiddenChildrenCount: 2,
              children: [],
            },
            {
              id: expect.any(String),
              nodeType: "file",
              name: "角色.md",
              path: "/设定/角色.md",
              parentAuxNodeId: settingsDir.id,
              content: "角色",
              symlinkTargetAuxNodeId: null,
              symlinkTargetPath: null,
              timelinePointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
              hiddenChildrenCount: 0,
              children: [],
            },
          ],
        },
      ],
    },
  });
});

test("list_files accepts a deeper depth for nested directories", async () => {
  const workspace = seedProject("assistant_tools_list_tree_deep");
  const settingsDir = workspaceDomain.mkdirAt({
    workspaceId: workspace.id,
    timelinePointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
    parentDirId: workspace.auxRootId!,
    name: "设定",
  });
  const worldDir = workspaceDomain.mkdirAt({
    workspaceId: workspace.id,
    timelinePointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
    parentDirId: settingsDir.id,
    name: "世界观",
  });
  workspaceDomain.writeFileAt({
    workspaceId: workspace.id,
    timelinePointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
    parentDirId: worldDir.id,
    name: "王都.md",
    content: "王都",
  });
  const tools = createAssistantTools({
    projectId: "assistant_tools_list_tree_deep",
    runtimeContext: createRuntimeContext(),
  });

  const result = await executeTool(tools.list_files!, {
    path: "/设定",
    depth: 3,
  });

  expect(result).toEqual({
    ok: true,
    truncated: false,
    data: {
      path: "/设定",
      depth: 3,
      entries: [
        {
          id: worldDir.id,
          nodeType: "dir",
          name: "世界观",
          path: "/设定/世界观",
          parentAuxNodeId: settingsDir.id,
          content: null,
          symlinkTargetAuxNodeId: null,
          symlinkTargetPath: null,
          timelinePointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
          hiddenChildrenCount: 0,
          children: [
            {
              id: expect.any(String),
              nodeType: "file",
              name: "王都.md",
              path: "/设定/世界观/王都.md",
              parentAuxNodeId: worldDir.id,
              content: "王都",
              symlinkTargetAuxNodeId: null,
              symlinkTargetPath: null,
              timelinePointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
              hiddenChildrenCount: 0,
              children: [],
            },
          ],
        },
      ],
    },
  });
});

test("create_dir creates a directory at the current timeline point", async () => {
  const workspace = seedProject("assistant_tools_mkdir");
  const tools = createAssistantTools({
    projectId: "assistant_tools_mkdir",
    runtimeContext: createRuntimeContext(),
  });

  const result = await executeTool(tools.create_dir!, { path: "/设定" });

  expect(result).toMatchObject({
    ok: true,
    truncated: false,
    data: {
      action: "created",
      path: "/设定",
    },
  });
  expect(
    workspaceDomain.readAuxByPathAt(workspace.id, workspaceDomain.ORIGIN_TIMELINE_POINT_ID, "/设定")
      ?.nodeType,
  ).toBe("dir");
});

test("write_file creates a new file when the target path does not exist", async () => {
  const workspace = seedProject("assistant_tools_write_create");
  workspaceDomain.mkdirAt({
    workspaceId: workspace.id,
    timelinePointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
    parentDirId: workspace.auxRootId!,
    name: "设定",
  });
  const tools = createAssistantTools({
    projectId: "assistant_tools_write_create",
    runtimeContext: createRuntimeContext(),
  });

  const result = await executeTool(tools.write_file!, {
    path: "/设定/角色.md",
    content: "主角设定",
  });

  expect(result).toMatchObject({
    ok: true,
    truncated: false,
    data: {
      action: "created",
      path: "/设定/角色.md",
    },
  });
  expect(
    workspaceDomain.readAuxByPathAt(
      workspace.id,
      workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
      "/设定/角色.md",
    )?.content,
  ).toBe("主角设定");
});

test("write_file overwrites an existing file", async () => {
  const workspace = seedProject("assistant_tools_write_update");
  const notesDir = workspaceDomain.mkdirAt({
    workspaceId: workspace.id,
    timelinePointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
    parentDirId: workspace.auxRootId!,
    name: "设定",
  });
  workspaceDomain.writeFileAt({
    workspaceId: workspace.id,
    timelinePointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
    parentDirId: notesDir.id,
    name: "角色.md",
    content: "旧内容",
  });
  const tools = createAssistantTools({
    projectId: "assistant_tools_write_update",
    runtimeContext: createRuntimeContext(),
  });

  const result = await executeTool(tools.write_file!, {
    path: "/设定/角色.md",
    content: "新内容",
  });

  expect(result).toMatchObject({
    ok: true,
    truncated: false,
    data: {
      action: "updated",
      path: "/设定/角色.md",
    },
  });
  expect(
    workspaceDomain.readAuxByPathAt(
      workspace.id,
      workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
      "/设定/角色.md",
    )?.content,
  ).toBe("新内容");
});

test("write_file overlays inherited files without changing earlier timeline points", async () => {
  const workspace = seedProject("assistant_tools_write_overlay_inherit");
  const notesDir = workspaceDomain.mkdirAt({
    workspaceId: workspace.id,
    timelinePointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
    parentDirId: workspace.auxRootId!,
    name: "设定",
  });
  workspaceDomain.writeFileAt({
    workspaceId: workspace.id,
    timelinePointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
    parentDirId: notesDir.id,
    name: "角色.md",
    content: "origin 内容",
  });
  const timelinePoint = workspaceDomain.createTimelinePoint({
    workspaceId: workspace.id,
    afterPointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
    label: "Draft",
  });
  const tools = createAssistantTools({
    projectId: "assistant_tools_write_overlay_inherit",
    runtimeContext: createRuntimeContext({
      workspaceId: workspace.id,
      activeContentNodeId: null,
      activeContentTitle: null,
      activeAuxNodeId: null,
      activeAuxPath: null,
      activeTimelinePointId: timelinePoint.id,
      activeTimelineLabel: timelinePoint.label,
    }),
  });

  const result = await executeTool(tools.write_file!, {
    path: "/设定/角色.md",
    content: "draft 内容",
  });

  expect(result).toMatchObject({
    ok: true,
    data: {
      action: "updated",
      path: "/设定/角色.md",
    },
  });
  expect(
    workspaceDomain.readAuxByPathAt(
      workspace.id,
      workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
      "/设定/角色.md",
    )?.content,
  ).toBe("origin 内容");
  expect(
    workspaceDomain.readAuxByPathAt(workspace.id, timelinePoint.id, "/设定/角色.md")?.content,
  ).toBe("draft 内容");
});

test("write_file returns an error when the parent directory does not exist", async () => {
  seedProject("assistant_tools_write_missing_parent");
  const tools = createAssistantTools({
    projectId: "assistant_tools_write_missing_parent",
    runtimeContext: createRuntimeContext(),
  });

  const result = await executeTool(tools.write_file!, {
    path: "/设定/角色.md",
    content: "主角设定",
  });

  expect(result).toEqual({
    ok: false,
    error: "写入辅助资料文件失败：父目录不存在或在当前时间点不可见。",
  });
});

test("write_file returns an error when the target path is a directory", async () => {
  const workspace = seedProject("assistant_tools_write_dir_guard");
  workspaceDomain.mkdirAt({
    workspaceId: workspace.id,
    timelinePointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
    parentDirId: workspace.auxRootId!,
    name: "设定",
  });
  const tools = createAssistantTools({
    projectId: "assistant_tools_write_dir_guard",
    runtimeContext: createRuntimeContext(),
  });

  const result = await executeTool(tools.write_file!, {
    path: "/设定",
    content: "should fail",
  });

  expect(result).toEqual({
    ok: false,
    error: "写入辅助资料文件失败：目标路径不是文件。",
  });
});

test("move_path renames a file in the same directory", async () => {
  const workspace = seedProject("assistant_tools_move_rename");
  const notesDir = workspaceDomain.mkdirAt({
    workspaceId: workspace.id,
    timelinePointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
    parentDirId: workspace.auxRootId!,
    name: "设定",
  });
  const file = workspaceDomain.writeFileAt({
    workspaceId: workspace.id,
    timelinePointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
    parentDirId: notesDir.id,
    name: "角色.md",
    content: "主角设定",
  });
  const tools = createAssistantTools({
    projectId: "assistant_tools_move_rename",
    runtimeContext: createRuntimeContext(),
  });

  const result = await executeTool(tools.move_path!, {
    path: "/设定/角色.md",
    newPath: "/设定/主角.md",
  });

  expect(result).toMatchObject({
    ok: true,
    truncated: false,
    data: {
      action: "moved",
      path: "/设定/主角.md",
      previousPath: "/设定/角色.md",
      nodeId: file.id,
    },
  });
  expect(
    workspaceDomain.readAuxByPathAt(
      workspace.id,
      workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
      "/设定/角色.md",
    ),
  ).toBeNull();
  expect(
    workspaceDomain.readAuxByPathAt(
      workspace.id,
      workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
      "/设定/主角.md",
    )?.id,
  ).toBe(file.id);
});

test("move_path moves a file across directories", async () => {
  const workspace = seedProject("assistant_tools_move_cross_dir");
  const sourceDir = workspaceDomain.mkdirAt({
    workspaceId: workspace.id,
    timelinePointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
    parentDirId: workspace.auxRootId!,
    name: "设定",
  });
  workspaceDomain.mkdirAt({
    workspaceId: workspace.id,
    timelinePointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
    parentDirId: workspace.auxRootId!,
    name: "资料库",
  });
  const file = workspaceDomain.writeFileAt({
    workspaceId: workspace.id,
    timelinePointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
    parentDirId: sourceDir.id,
    name: "角色.md",
    content: "主角设定",
  });
  const tools = createAssistantTools({
    projectId: "assistant_tools_move_cross_dir",
    runtimeContext: createRuntimeContext(),
  });

  const result = await executeTool(tools.move_path!, {
    path: "/设定/角色.md",
    newPath: "/资料库/角色.md",
  });

  expect(result).toMatchObject({
    ok: true,
    data: {
      action: "moved",
      path: "/资料库/角色.md",
      previousPath: "/设定/角色.md",
      nodeId: file.id,
    },
  });
  expect(
    workspaceDomain.readAuxByPathAt(
      workspace.id,
      workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
      "/资料库/角色.md",
    )?.id,
  ).toBe(file.id);
});

test("move_path moves a directory", async () => {
  const workspace = seedProject("assistant_tools_move_dir");
  const sourceDir = workspaceDomain.mkdirAt({
    workspaceId: workspace.id,
    timelinePointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
    parentDirId: workspace.auxRootId!,
    name: "设定",
  });
  workspaceDomain.mkdirAt({
    workspaceId: workspace.id,
    timelinePointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
    parentDirId: workspace.auxRootId!,
    name: "资料库",
  });
  const nestedDir = workspaceDomain.mkdirAt({
    workspaceId: workspace.id,
    timelinePointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
    parentDirId: sourceDir.id,
    name: "角色",
  });
  const tools = createAssistantTools({
    projectId: "assistant_tools_move_dir",
    runtimeContext: createRuntimeContext(),
  });

  const result = await executeTool(tools.move_path!, {
    path: "/设定/角色",
    newPath: "/资料库/角色档案",
  });

  expect(result).toMatchObject({
    ok: true,
    data: {
      action: "moved",
      path: "/资料库/角色档案",
      previousPath: "/设定/角色",
      nodeId: nestedDir.id,
    },
  });
  expect(
    workspaceDomain.readAuxByPathAt(
      workspace.id,
      workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
      "/资料库/角色档案",
    )?.id,
  ).toBe(nestedDir.id);
});

test("move_path returns an error when the target path already exists", async () => {
  const workspace = seedProject("assistant_tools_move_conflict");
  const sourceDir = workspaceDomain.mkdirAt({
    workspaceId: workspace.id,
    timelinePointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
    parentDirId: workspace.auxRootId!,
    name: "设定",
  });
  workspaceDomain.writeFileAt({
    workspaceId: workspace.id,
    timelinePointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
    parentDirId: sourceDir.id,
    name: "角色.md",
    content: "a",
  });
  workspaceDomain.writeFileAt({
    workspaceId: workspace.id,
    timelinePointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
    parentDirId: sourceDir.id,
    name: "主角.md",
    content: "b",
  });
  const tools = createAssistantTools({
    projectId: "assistant_tools_move_conflict",
    runtimeContext: createRuntimeContext(),
  });

  const result = await executeTool(tools.move_path!, {
    path: "/设定/角色.md",
    newPath: "/设定/主角.md",
  });

  expect(result).toEqual({
    ok: false,
    error: "移动辅助资料失败：目标路径已存在。",
  });
});

test("move_path returns an error when the target parent directory does not exist", async () => {
  const workspace = seedProject("assistant_tools_move_missing_parent");
  const sourceDir = workspaceDomain.mkdirAt({
    workspaceId: workspace.id,
    timelinePointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
    parentDirId: workspace.auxRootId!,
    name: "设定",
  });
  workspaceDomain.writeFileAt({
    workspaceId: workspace.id,
    timelinePointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
    parentDirId: sourceDir.id,
    name: "角色.md",
    content: "a",
  });
  const tools = createAssistantTools({
    projectId: "assistant_tools_move_missing_parent",
    runtimeContext: createRuntimeContext(),
  });

  const result = await executeTool(tools.move_path!, {
    path: "/设定/角色.md",
    newPath: "/资料库/角色.md",
  });

  expect(result).toEqual({
    ok: false,
    error: "移动辅助资料失败：父目录不存在或在当前时间点不可见。",
  });
});

test("move_path rejects moving a directory into its own subtree", async () => {
  const workspace = seedProject("assistant_tools_move_into_child");
  const parentDir = workspaceDomain.mkdirAt({
    workspaceId: workspace.id,
    timelinePointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
    parentDirId: workspace.auxRootId!,
    name: "设定",
  });
  workspaceDomain.mkdirAt({
    workspaceId: workspace.id,
    timelinePointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
    parentDirId: parentDir.id,
    name: "角色",
  });
  const tools = createAssistantTools({
    projectId: "assistant_tools_move_into_child",
    runtimeContext: createRuntimeContext(),
  });

  const result = await executeTool(tools.move_path!, {
    path: "/设定",
    newPath: "/设定/角色/设定",
  });

  expect(result).toEqual({
    ok: false,
    error: "无法移动：不能把辅助信息移动到自己的子节点下。",
  });
});

test("move_path respects the active timeline point from context", async () => {
  const workspace = seedProject("assistant_tools_move_timeline");
  const sourceDir = workspaceDomain.mkdirAt({
    workspaceId: workspace.id,
    timelinePointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
    parentDirId: workspace.auxRootId!,
    name: "设定",
  });
  workspaceDomain.mkdirAt({
    workspaceId: workspace.id,
    timelinePointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
    parentDirId: workspace.auxRootId!,
    name: "资料库",
  });
  const file = workspaceDomain.writeFileAt({
    workspaceId: workspace.id,
    timelinePointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
    parentDirId: sourceDir.id,
    name: "角色.md",
    content: "origin",
  });
  const timelinePoint = workspaceDomain.createTimelinePoint({
    workspaceId: workspace.id,
    afterPointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
    label: "Draft",
  });
  const tools = createAssistantTools({
    projectId: "assistant_tools_move_timeline",
    runtimeContext: createRuntimeContext({
      workspaceId: workspace.id,
      activeContentNodeId: null,
      activeContentTitle: null,
      activeAuxNodeId: null,
      activeAuxPath: null,
      activeTimelinePointId: timelinePoint.id,
      activeTimelineLabel: timelinePoint.label,
    }),
  });

  await executeTool(tools.move_path!, {
    path: "/设定/角色.md",
    newPath: "/资料库/角色.md",
  });

  expect(
    workspaceDomain.readAuxByPathAt(
      workspace.id,
      workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
      "/设定/角色.md",
    )?.id,
  ).toBe(file.id);
  expect(
    workspaceDomain.readAuxByPathAt(workspace.id, timelinePoint.id, "/资料库/角色.md")?.id,
  ).toBe(file.id);
});

test("create_symlink creates a symlink to a file", async () => {
  const workspace = seedProject("assistant_tools_symlink_file");
  const notesDir = workspaceDomain.mkdirAt({
    workspaceId: workspace.id,
    timelinePointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
    parentDirId: workspace.auxRootId!,
    name: "设定",
  });
  workspaceDomain.mkdirAt({
    workspaceId: workspace.id,
    timelinePointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
    parentDirId: workspace.auxRootId!,
    name: "索引",
  });
  const targetFile = workspaceDomain.writeFileAt({
    workspaceId: workspace.id,
    timelinePointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
    parentDirId: notesDir.id,
    name: "角色.md",
    content: "主角设定",
  });
  const tools = createAssistantTools({
    projectId: "assistant_tools_symlink_file",
    runtimeContext: createRuntimeContext(),
  });

  const result = await executeTool(tools.create_symlink!, {
    path: "/索引/角色.md",
    targetPath: "/设定/角色.md",
  });

  expect(result).toMatchObject({
    ok: true,
    data: {
      action: "created",
      path: "/索引/角色.md",
      targetPath: "/设定/角色.md",
    },
  });
  expect(
    workspaceDomain.readAuxByPathAt(
      workspace.id,
      workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
      "/索引/角色.md",
    )?.id,
  ).toBe(targetFile.id);
  expect(
    workspaceDomain
      .exportAuxSnapshotTree(workspace.id, workspaceDomain.ORIGIN_TIMELINE_POINT_ID)
      .nodes.find((node) => node.path === "/索引")?.children[0]?.symlinkTargetPath,
  ).toBe("/设定/角色.md");
});

test("create_symlink creates a symlink to a directory", async () => {
  const workspace = seedProject("assistant_tools_symlink_dir");
  const targetDir = workspaceDomain.mkdirAt({
    workspaceId: workspace.id,
    timelinePointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
    parentDirId: workspace.auxRootId!,
    name: "设定",
  });
  workspaceDomain.mkdirAt({
    workspaceId: workspace.id,
    timelinePointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
    parentDirId: workspace.auxRootId!,
    name: "索引",
  });
  const tools = createAssistantTools({
    projectId: "assistant_tools_symlink_dir",
    runtimeContext: createRuntimeContext(),
  });

  const result = await executeTool(tools.create_symlink!, {
    path: "/索引/设定入口",
    targetPath: "/设定",
  });

  expect(result).toMatchObject({
    ok: true,
    data: {
      action: "created",
      path: "/索引/设定入口",
      targetPath: "/设定",
      nodeId: expect.any(String),
    },
  });
  const indexNode = workspaceDomain
    .exportAuxSnapshotTree(workspace.id, workspaceDomain.ORIGIN_TIMELINE_POINT_ID)
    .nodes.find((node) => node.path === "/索引");
  expect(
    indexNode?.children.find((node) => node.path === "/索引/设定入口")?.symlinkTargetPath,
  ).toBe("/设定");
  expect(
    workspaceDomain.readAuxByPathAt(
      workspace.id,
      workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
      "/索引/设定入口",
    )?.id,
  ).toBe(targetDir.id);
});

test("create_symlink returns an error when the target does not exist", async () => {
  const workspace = seedProject("assistant_tools_symlink_missing_target");
  workspaceDomain.mkdirAt({
    workspaceId: workspace.id,
    timelinePointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
    parentDirId: workspace.auxRootId!,
    name: "索引",
  });
  const tools = createAssistantTools({
    projectId: "assistant_tools_symlink_missing_target",
    runtimeContext: createRuntimeContext(),
  });

  const result = await executeTool(tools.create_symlink!, {
    path: "/索引/角色.md",
    targetPath: "/设定/角色.md",
  });

  expect(result).toEqual({
    ok: false,
    error: "创建辅助资料符号链接失败：目标路径不存在或在当前时间点不可见。",
  });
});

test("create_symlink returns an error when the destination path already exists", async () => {
  const workspace = seedProject("assistant_tools_symlink_conflict");
  const notesDir = workspaceDomain.mkdirAt({
    workspaceId: workspace.id,
    timelinePointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
    parentDirId: workspace.auxRootId!,
    name: "设定",
  });
  const indexDir = workspaceDomain.mkdirAt({
    workspaceId: workspace.id,
    timelinePointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
    parentDirId: workspace.auxRootId!,
    name: "索引",
  });
  workspaceDomain.writeFileAt({
    workspaceId: workspace.id,
    timelinePointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
    parentDirId: notesDir.id,
    name: "角色.md",
    content: "主角设定",
  });
  workspaceDomain.writeFileAt({
    workspaceId: workspace.id,
    timelinePointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
    parentDirId: indexDir.id,
    name: "角色.md",
    content: "已存在",
  });
  const tools = createAssistantTools({
    projectId: "assistant_tools_symlink_conflict",
    runtimeContext: createRuntimeContext(),
  });

  const result = await executeTool(tools.create_symlink!, {
    path: "/索引/角色.md",
    targetPath: "/设定/角色.md",
  });

  expect(result).toEqual({
    ok: false,
    error: "创建辅助资料符号链接失败：目标路径已存在。",
  });
});

test("create_symlink suggests retarget_symlink when the destination is an existing symlink", async () => {
  const workspace = seedProject("assistant_tools_symlink_retarget_hint");
  const settingDir = workspaceDomain.mkdirAt({
    workspaceId: workspace.id,
    timelinePointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
    parentDirId: workspace.auxRootId!,
    name: "设定",
  });
  const sceneDir = workspaceDomain.mkdirAt({
    workspaceId: workspace.id,
    timelinePointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
    parentDirId: workspace.auxRootId!,
    name: "场景",
  });
  const indexDir = workspaceDomain.mkdirAt({
    workspaceId: workspace.id,
    timelinePointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
    parentDirId: workspace.auxRootId!,
    name: "索引",
  });
  workspaceDomain.linkAt({
    workspaceId: workspace.id,
    timelinePointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
    parentDirId: indexDir.id,
    name: "入口",
    targetNodeId: settingDir.id,
  });
  const tools = createAssistantTools({
    projectId: "assistant_tools_symlink_retarget_hint",
    runtimeContext: createRuntimeContext(),
  });

  const result = await executeTool(tools.create_symlink!, {
    path: "/索引/入口",
    targetPath: "/场景",
  });

  expect(result).toEqual({
    ok: false,
    error:
      "创建辅助资料符号链接失败：同路径已存在符号链接。通常你想要的是调用 retarget_symlink 来修改它的目标。",
  });
  expect(sceneDir.id).toBeTruthy();
});

test("aux write tools respect the active timeline point from context", async () => {
  const workspace = seedProject("assistant_tools_timeline");
  const timelinePoint = workspaceDomain.createTimelinePoint({
    workspaceId: workspace.id,
    afterPointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
    label: "Draft",
  });
  const tools = createAssistantTools({
    projectId: "assistant_tools_timeline",
    runtimeContext: createRuntimeContext({
      workspaceId: workspace.id,
      activeContentNodeId: null,
      activeContentTitle: null,
      activeAuxNodeId: null,
      activeAuxPath: null,
      activeTimelinePointId: timelinePoint.id,
      activeTimelineLabel: timelinePoint.label,
    }),
  });

  await executeTool(tools.create_dir!, { path: "/草稿" });

  expect(
    workspaceDomain.readAuxByPathAt(
      workspace.id,
      workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
      "/草稿",
    ),
  ).toBeNull();
  expect(workspaceDomain.readAuxByPathAt(workspace.id, timelinePoint.id, "/草稿")?.nodeType).toBe(
    "dir",
  );
});

test("set_current_timeline updates runtime context for later file tools", async () => {
  const workspace = seedProject("assistant_tools_set_timeline");
  const timelinePoint = workspaceDomain.createTimelinePoint({
    workspaceId: workspace.id,
    afterPointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
    label: "Draft",
  });
  const runtimeContext = createRuntimeContext({
    workspaceId: workspace.id,
    activeContentNodeId: null,
    activeContentTitle: null,
    activeAuxNodeId: null,
    activeAuxPath: null,
    activeTimelinePointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
    activeTimelineLabel: "原点",
  });
  const tools = createAssistantTools({
    projectId: "assistant_tools_set_timeline",
    runtimeContext,
  });

  const selected = await executeTool(tools.set_current_timeline!, {
    timelinePointId: timelinePoint.id,
  });
  await executeTool(tools.create_dir!, { path: "/草稿" });

  expect(selected).toMatchObject({
    ok: true,
    data: {
      action: "selected",
      timelinePointId: timelinePoint.id,
      timelineLabel: timelinePoint.label,
    },
  });
  expect(runtimeContext.snapshot?.activeTimelinePointId).toBe(timelinePoint.id);
  expect(workspaceDomain.readAuxByPathAt(workspace.id, timelinePoint.id, "/草稿")?.nodeType).toBe(
    "dir",
  );
  expect(
    workspaceDomain.readAuxByPathAt(
      workspace.id,
      workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
      "/草稿",
    ),
  ).toBeNull();
});

test("set_current_timeline accepts origin", async () => {
  const workspace = seedProject("assistant_tools_set_origin");
  const timelinePoint = workspaceDomain.createTimelinePoint({
    workspaceId: workspace.id,
    afterPointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
    label: "Draft",
  });
  const runtimeContext = createRuntimeContext({
    workspaceId: workspace.id,
    activeContentNodeId: null,
    activeContentTitle: null,
    activeAuxNodeId: null,
    activeAuxPath: null,
    activeTimelinePointId: timelinePoint.id,
    activeTimelineLabel: timelinePoint.label,
  });
  const tools = createAssistantTools({
    projectId: "assistant_tools_set_origin",
    runtimeContext,
  });

  const selected = await executeTool(tools.set_current_timeline!, {
    timelinePointId: "origin",
  });

  expect(selected).toMatchObject({
    ok: true,
    data: {
      action: "selected",
      timelinePointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
      timelineLabel: "原点",
    },
  });
  expect(runtimeContext.snapshot?.activeTimelinePointId).toBe(
    workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
  );
});

test("create_story_timeline_points accepts afterPointId as timeline label", async () => {
  const workspace = seedProject("assistant_tools_create_timeline_after_label");
  const prologue = workspaceDomain.createTimelinePoint({
    workspaceId: workspace.id,
    afterPointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
    label: "序幕",
  });
  workspaceDomain.createTimelinePoint({
    workspaceId: workspace.id,
    afterPointId: prologue.id,
    label: "第一章",
  });
  const tools = createAssistantTools({
    projectId: "assistant_tools_create_timeline_after_label",
    runtimeContext: createRuntimeContext(),
  });

  const result = await executeTool(tools.create_story_timeline_points!, {
    points: [{ label: "转折" }],
    afterPointId: "序幕",
  });

  expect(result).toMatchObject({
    ok: true,
    data: {
      action: "created_batch",
      points: [{ label: "转折" }],
    },
  });
  expect(workspaceDomain.listTimelinePoints(workspace.id).map((point) => point.label)).toEqual([
    "Origin",
    "序幕",
    "转折",
    "第一章",
  ]);
});

test("create_story_timeline_points prefers exact id over matching label", async () => {
  const workspace = seedProject("assistant_tools_create_timeline_after_id_priority");
  const firstPoint = workspaceDomain.createTimelinePoint({
    workspaceId: workspace.id,
    afterPointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
    label: "第一章",
  });
  workspaceDomain.createTimelinePoint({
    workspaceId: workspace.id,
    afterPointId: firstPoint.id,
    label: firstPoint.id,
  });
  const tools = createAssistantTools({
    projectId: "assistant_tools_create_timeline_after_id_priority",
    runtimeContext: createRuntimeContext(),
  });

  await executeTool(tools.create_story_timeline_points!, {
    points: [{ label: "插入点" }],
    afterPointId: firstPoint.id,
  });

  expect(workspaceDomain.listTimelinePoints(workspace.id).map((point) => point.label)).toEqual([
    "Origin",
    "第一章",
    "插入点",
    firstPoint.id,
  ]);
});

test("create_story_timeline_points creates multiple points in one batch", async () => {
  const workspace = seedProject("assistant_tools_create_timeline_batch");
  workspaceDomain.createTimelinePoint({
    workspaceId: workspace.id,
    afterPointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
    label: "序幕",
  });
  const tools = createAssistantTools({
    projectId: "assistant_tools_create_timeline_batch",
    runtimeContext: createRuntimeContext(),
  });

  const result = await executeTool(tools.create_story_timeline_points!, {
    afterPointId: "序幕",
    points: [{ label: "第一章" }, { label: "第二章" }, { label: "第三章" }],
  });

  expect(result).toMatchObject({
    ok: true,
    data: {
      action: "created_batch",
      points: [
        { label: "第一章", pointId: expect.any(String) },
        { label: "第二章", pointId: expect.any(String) },
        { label: "第三章", pointId: expect.any(String) },
      ],
    },
  });
  expect(workspaceDomain.listTimelinePoints(workspace.id).map((point) => point.label)).toEqual([
    "Origin",
    "序幕",
    "第一章",
    "第二章",
    "第三章",
  ]);
});

test("move_story_timeline_point accepts pointId and afterPointId as timeline labels", async () => {
  const workspace = seedProject("assistant_tools_move_timeline_by_label");
  workspaceDomain.createTimelinePoint({
    workspaceId: workspace.id,
    afterPointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
    label: "序幕",
  });
  workspaceDomain.createTimelinePoint({
    workspaceId: workspace.id,
    afterPointId: workspaceDomain.listTimelinePoints(workspace.id)[1]!.id,
    label: "第一章",
  });
  workspaceDomain.createTimelinePoint({
    workspaceId: workspace.id,
    afterPointId: workspaceDomain.listTimelinePoints(workspace.id)[2]!.id,
    label: "第二章",
  });
  const tools = createAssistantTools({
    projectId: "assistant_tools_move_timeline_by_label",
    runtimeContext: createRuntimeContext(),
  });

  const result = await executeTool(tools.move_story_timeline_point!, {
    pointId: "第二章",
    afterPointId: "序幕",
  });

  expect(result).toMatchObject({
    ok: true,
    data: {
      action: "moved",
      pointId: expect.any(String),
    },
  });
  expect(workspaceDomain.listTimelinePoints(workspace.id).map((point) => point.label)).toEqual([
    "Origin",
    "序幕",
    "第二章",
    "第一章",
  ]);
});

test("move_story_timeline_point rejects origin by name", async () => {
  const workspace = seedProject("assistant_tools_move_timeline_origin_guard");
  const tools = createAssistantTools({
    projectId: "assistant_tools_move_timeline_origin_guard",
    runtimeContext: createRuntimeContext(),
  });

  const result = await executeTool(tools.move_story_timeline_point!, {
    pointId: "origin",
  });

  expect(result).toEqual({
    ok: false,
    error: "无法移动原点时间点。",
  });
  expect(workspace.id).toBeTruthy();
});

test("delete_story_timeline_point accepts pointId as timeline label", async () => {
  const workspace = seedProject("assistant_tools_delete_timeline_by_label");
  workspaceDomain.createTimelinePoint({
    workspaceId: workspace.id,
    afterPointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
    label: "序幕",
  });
  workspaceDomain.createTimelinePoint({
    workspaceId: workspace.id,
    afterPointId: workspaceDomain.listTimelinePoints(workspace.id)[1]!.id,
    label: "第一章",
  });
  const tools = createAssistantTools({
    projectId: "assistant_tools_delete_timeline_by_label",
    runtimeContext: createRuntimeContext(),
  });

  const result = await executeTool(tools.delete_story_timeline_point!, {
    pointId: "序幕",
  });

  expect(result).toMatchObject({
    ok: true,
    data: {
      action: "deleted",
      pointId: expect.any(String),
    },
  });
  expect(workspaceDomain.listTimelinePoints(workspace.id).map((point) => point.label)).toEqual([
    "Origin",
    "第一章",
  ]);
});

test("delete_story_timeline_point rejects origin by name", async () => {
  seedProject("assistant_tools_delete_timeline_origin_guard");
  const tools = createAssistantTools({
    projectId: "assistant_tools_delete_timeline_origin_guard",
    runtimeContext: createRuntimeContext(),
  });

  const result = await executeTool(tools.delete_story_timeline_point!, {
    pointId: "origin",
  });

  expect(result).toEqual({
    ok: false,
    error: "无法删除原点时间点。",
  });
});
