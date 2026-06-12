import { expect, test } from "bun:test";

import { setupMockDatabase } from "@/test/mock-db";

setupMockDatabase();

const { db, schema } = await import("@/db");
const workspaceDomain = await import("@/modules/workspace/domain");
const { createAssistantTools } = await import("./assistant-tools");
const { PROJECT_ASSISTANT_TOOL_NAMES } = await import("@/modules/ai/domain/types");

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
    context: null,
  });

  expect(Object.keys(tools).sort()).toEqual([...PROJECT_ASSISTANT_TOOL_NAMES].sort());
  expect(tools.get_writing_context).toBeDefined();
  expect(tools.create_reference_overlay_dir).toBeDefined();
  expect(tools.write_reference_overlay_file).toBeDefined();
});

test("create_reference_overlay_dir creates a directory at the current timeline point", async () => {
  const workspace = seedProject("assistant_tools_mkdir");
  const tools = createAssistantTools({
    projectId: "assistant_tools_mkdir",
    context: null,
  });

  const result = await executeTool(tools.create_reference_overlay_dir!, { path: "/设定" });

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

test("write_reference_overlay_file creates a new file when the target path does not exist", async () => {
  const workspace = seedProject("assistant_tools_write_create");
  workspaceDomain.mkdirAt({
    workspaceId: workspace.id,
    timelinePointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
    parentDirId: workspace.auxRootId!,
    name: "设定",
  });
  const tools = createAssistantTools({
    projectId: "assistant_tools_write_create",
    context: null,
  });

  const result = await executeTool(tools.write_reference_overlay_file!, {
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

test("write_reference_overlay_file overwrites an existing file", async () => {
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
    context: null,
  });

  const result = await executeTool(tools.write_reference_overlay_file!, {
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

test("write_reference_overlay_file overlays inherited files without changing earlier timeline points", async () => {
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
    key: "draft",
    label: "Draft",
  });
  const tools = createAssistantTools({
    projectId: "assistant_tools_write_overlay_inherit",
    context: null,
  });

  const result = await executeTool(tools.write_reference_overlay_file!, {
    path: "/设定/角色.md",
    content: "draft 内容",
    overlayTimelinePointId: timelinePoint.id,
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

test("write_reference_overlay_file returns an error when the parent directory does not exist", async () => {
  seedProject("assistant_tools_write_missing_parent");
  const tools = createAssistantTools({
    projectId: "assistant_tools_write_missing_parent",
    context: null,
  });

  const result = await executeTool(tools.write_reference_overlay_file!, {
    path: "/设定/角色.md",
    content: "主角设定",
  });

  expect(result).toEqual({
    ok: false,
    error: "写入辅助资料文件失败：父目录不存在或在当前时间点不可见。",
  });
});

test("write_reference_overlay_file returns an error when the target path is a directory", async () => {
  const workspace = seedProject("assistant_tools_write_dir_guard");
  workspaceDomain.mkdirAt({
    workspaceId: workspace.id,
    timelinePointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
    parentDirId: workspace.auxRootId!,
    name: "设定",
  });
  const tools = createAssistantTools({
    projectId: "assistant_tools_write_dir_guard",
    context: null,
  });

  const result = await executeTool(tools.write_reference_overlay_file!, {
    path: "/设定",
    content: "should fail",
  });

  expect(result).toEqual({
    ok: false,
    error: "写入辅助资料文件失败：目标路径不是文件。",
  });
});

test("move_reference_overlay_node renames a file in the same directory", async () => {
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
    context: null,
  });

  const result = await executeTool(tools.move_reference_overlay_node!, {
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

test("move_reference_overlay_node moves a file across directories", async () => {
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
    context: null,
  });

  const result = await executeTool(tools.move_reference_overlay_node!, {
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

test("move_reference_overlay_node moves a directory", async () => {
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
    context: null,
  });

  const result = await executeTool(tools.move_reference_overlay_node!, {
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

test("move_reference_overlay_node returns an error when the target path already exists", async () => {
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
    context: null,
  });

  const result = await executeTool(tools.move_reference_overlay_node!, {
    path: "/设定/角色.md",
    newPath: "/设定/主角.md",
  });

  expect(result).toEqual({
    ok: false,
    error: "移动辅助资料失败：目标路径已存在。",
  });
});

test("move_reference_overlay_node returns an error when the target parent directory does not exist", async () => {
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
    context: null,
  });

  const result = await executeTool(tools.move_reference_overlay_node!, {
    path: "/设定/角色.md",
    newPath: "/资料库/角色.md",
  });

  expect(result).toEqual({
    ok: false,
    error: "移动辅助资料失败：父目录不存在或在当前时间点不可见。",
  });
});

test("move_reference_overlay_node rejects moving a directory into its own subtree", async () => {
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
    context: null,
  });

  const result = await executeTool(tools.move_reference_overlay_node!, {
    path: "/设定",
    newPath: "/设定/角色/设定",
  });

  expect(result).toEqual({
    ok: false,
    error: "无法移动：不能把辅助信息移动到自己的子节点下。",
  });
});

test("move_reference_overlay_node respects the active timeline point from context", async () => {
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
    key: "draft",
    label: "Draft",
  });
  const tools = createAssistantTools({
    projectId: "assistant_tools_move_timeline",
    context: {
      workspaceId: workspace.id,
      activeContentNodeId: null,
      activeContentTitle: null,
      activeAuxNodeId: null,
      activeAuxPath: null,
      activeTimelinePointId: timelinePoint.id,
      activeTimelineLabel: timelinePoint.label,
    },
  });

  await executeTool(tools.move_reference_overlay_node!, {
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

test("create_reference_overlay_link creates a symlink to a file", async () => {
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
    context: null,
  });

  const result = await executeTool(tools.create_reference_overlay_link!, {
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

test("create_reference_overlay_link creates a symlink to a directory", async () => {
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
    context: null,
  });

  const result = await executeTool(tools.create_reference_overlay_link!, {
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

test("create_reference_overlay_link returns an error when the target does not exist", async () => {
  const workspace = seedProject("assistant_tools_symlink_missing_target");
  workspaceDomain.mkdirAt({
    workspaceId: workspace.id,
    timelinePointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
    parentDirId: workspace.auxRootId!,
    name: "索引",
  });
  const tools = createAssistantTools({
    projectId: "assistant_tools_symlink_missing_target",
    context: null,
  });

  const result = await executeTool(tools.create_reference_overlay_link!, {
    path: "/索引/角色.md",
    targetPath: "/设定/角色.md",
  });

  expect(result).toEqual({
    ok: false,
    error: "创建辅助资料符号链接失败：目标路径不存在或在当前时间点不可见。",
  });
});

test("create_reference_overlay_link returns an error when the destination path already exists", async () => {
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
    context: null,
  });

  const result = await executeTool(tools.create_reference_overlay_link!, {
    path: "/索引/角色.md",
    targetPath: "/设定/角色.md",
  });

  expect(result).toEqual({
    ok: false,
    error: "创建辅助资料符号链接失败：目标路径已存在。",
  });
});

test("aux write tools respect the active timeline point from context", async () => {
  const workspace = seedProject("assistant_tools_timeline");
  const timelinePoint = workspaceDomain.createTimelinePoint({
    workspaceId: workspace.id,
    afterPointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
    key: "draft",
    label: "Draft",
  });
  const tools = createAssistantTools({
    projectId: "assistant_tools_timeline",
    context: {
      workspaceId: workspace.id,
      activeContentNodeId: null,
      activeContentTitle: null,
      activeAuxNodeId: null,
      activeAuxPath: null,
      activeTimelinePointId: timelinePoint.id,
      activeTimelineLabel: timelinePoint.label,
    },
  });

  await executeTool(tools.create_reference_overlay_dir!, { path: "/草稿" });

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
