import { expect, test } from "bun:test";

import { setupMockDatabase } from "@/test/mock-db";

setupMockDatabase();

const { db, schema } = await import("@/db");
const workspaceDomain = await import("@/modules/workspace/domain");
const { createAssistantTools } = await import("./assistant-tools");

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

test("createAssistantTools only exposes the allowlisted tools", () => {
  seedProject("assistant_tools_filter");

  const tools = createAssistantTools({
    projectId: "assistant_tools_filter",
    context: null,
    activeTools: ["read_aux_path", "write_aux_file"],
  });

  expect(Object.keys(tools).sort()).toEqual(["read_aux_path", "write_aux_file"]);
  expect(tools.read_current_writing_context).toBeUndefined();
  expect(tools.mkdir_aux_dir).toBeUndefined();
});

test("mkdir_aux_dir creates a directory at the current timeline point", async () => {
  const workspace = seedProject("assistant_tools_mkdir");
  const tools = createAssistantTools({
    projectId: "assistant_tools_mkdir",
    context: null,
    activeTools: ["mkdir_aux_dir"],
  });

  const result = await executeTool(tools.mkdir_aux_dir!, { path: "/设定" });

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

test("write_aux_file creates a new file when the target path does not exist", async () => {
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
    activeTools: ["write_aux_file"],
  });

  const result = await executeTool(tools.write_aux_file!, {
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

test("write_aux_file overwrites an existing file", async () => {
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
    activeTools: ["write_aux_file"],
  });

  const result = await executeTool(tools.write_aux_file!, {
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

test("write_aux_file returns an error when the parent directory does not exist", async () => {
  seedProject("assistant_tools_write_missing_parent");
  const tools = createAssistantTools({
    projectId: "assistant_tools_write_missing_parent",
    context: null,
    activeTools: ["write_aux_file"],
  });

  const result = await executeTool(tools.write_aux_file!, {
    path: "/设定/角色.md",
    content: "主角设定",
  });

  expect(result).toEqual({
    ok: false,
    error: "写入辅助资料文件失败：父目录不存在或在当前时间点不可见。",
  });
});

test("write_aux_file returns an error when the target path is a directory", async () => {
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
    activeTools: ["write_aux_file"],
  });

  const result = await executeTool(tools.write_aux_file!, {
    path: "/设定",
    content: "should fail",
  });

  expect(result).toEqual({
    ok: false,
    error: "写入辅助资料文件失败：目标路径不是文件。",
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
    activeTools: ["mkdir_aux_dir"],
  });

  await executeTool(tools.mkdir_aux_dir!, { path: "/草稿" });

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
