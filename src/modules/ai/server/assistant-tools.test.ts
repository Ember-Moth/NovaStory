import { expect, test } from "bun:test";

import { setupMockDatabase } from "@/test/mock-db";
import { seedProjectRecord } from "@/test/project";

setupMockDatabase();

const workspaceDomain = await import("@/modules/workspace/domain");
const { createAssistantTools } = await import("./assistant-tools");
const { normalizeAskUserAnswers, normalizeAskUserInput, validateAskUserSubmission } = await import(
  "./assistant-tools/ask-user"
);
const { PROJECT_ASSISTANT_TOOL_NAMES } = await import("@/modules/ai/domain/types");

function createRuntimeContext(
  snapshot: {
    workspaceId: string | null;
    activeContentNodeId: string | null;
    activeContentTitle: string | null;
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

async function seedProject(projectId: string) {
  seedProjectRecord(projectId);
  return await workspaceDomain.createDefaultWorkspace(projectId);
}

type TestWorkspace = Awaited<ReturnType<typeof seedProject>>;

async function auxMkdir(workspace: TestWorkspace, auxPath: string, timelinePointId?: string) {
  return await workspaceDomain.mkdirAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: timelinePointId ?? workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
    path: auxPath,
  });
}

async function auxWrite(
  workspace: TestWorkspace,
  auxPath: string,
  content: string,
  timelinePointId?: string,
) {
  return await workspaceDomain.writeFileAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: timelinePointId ?? workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
    path: auxPath,
    content,
  });
}

async function auxLink(
  workspace: TestWorkspace,
  auxPath: string,
  targetPath: string,
  timelinePointId?: string,
) {
  return await workspaceDomain.linkAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: timelinePointId ?? workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
    path: auxPath,
    targetPath,
  });
}

async function seedTimelineAuxDiffScenario(projectId: string) {
  const workspace = await seedProject(projectId);
  await auxMkdir(workspace, "/state");
  await auxWrite(workspace, "/state/location.md", "home");
  await auxWrite(workspace, "/state/backup.md", "backup");
  await auxLink(workspace, "/current_location", "/state/location.md");
  const pointA = await workspaceDomain.createTimelinePoint({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    afterPointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
    label: "离家后",
  });
  await auxWrite(workspace, "/delta-only.md", "delta", pointA.id);
  await auxWrite(workspace, "/state/location.md", "park", pointA.id);
  const pointB = await workspaceDomain.createTimelinePoint({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    afterPointId: pointA.id,
    label: "折返前",
  });
  await workspaceDomain.deleteAuxNodeAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: pointB.id,
    path: "/delta-only.md",
  });
  await workspaceDomain.retargetAuxSymlinkAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: pointB.id,
    path: "/current_location",
    targetPath: "/state/backup.md",
  });

  return { workspace, pointA, pointB };
}

async function executeTool<TArgs, TResult>(toolDefinition: unknown, args: TArgs) {
  const execute = (toolDefinition as { execute?: (_args: TArgs, ..._rest: unknown[]) => TResult })
    .execute;
  expect(execute).toBeDefined();
  return await execute!(args);
}

test("createAssistantTools always exposes the full tool set", async () => {
  await seedProject("assistant_tools_filter");

  const tools = createAssistantTools({
    projectId: "assistant_tools_filter",
    runtimeContext: createRuntimeContext(),
  });

  expect(Object.keys(tools).sort()).toEqual([...PROJECT_ASSISTANT_TOOL_NAMES].sort());
  expect(tools.list_manuscript_nodes).toBeDefined();
  expect(tools.ask_user).toBeDefined();
  expect(tools.read_manuscript_node).toBeDefined();
  expect("get_manuscript_subtree" in tools).toBe(false);
  expect(tools.create_dir).toBeDefined();
  expect(tools.write_file).toBeDefined();
});

test("ask_user is exposed as an external tool without automatic execution", async () => {
  await seedProject("assistant_tools_ask_user");
  const tools = createAssistantTools({
    projectId: "assistant_tools_ask_user",
    runtimeContext: createRuntimeContext(),
  });

  expect(tools.ask_user).toBeDefined();
  expect((tools.ask_user as { execute?: unknown }).execute).toBeUndefined();
  expect((tools.ask_user as { needsApproval?: unknown }).needsApproval).toBeUndefined();
  expect((tools.ask_user as { inputSchema?: unknown }).inputSchema).toBeDefined();
});

test("ask_user accepts single_choice custom text answers", async () => {
  const request = normalizeAskUserInput({
    questions: [
      {
        id: "tone",
        prompt: "偏什么气质？",
        kind: "single_choice",
        options: [
          { id: "quiet", label: "安静" },
          { id: "sharp", label: "锋利" },
        ],
      },
    ],
  });

  expect(
    normalizeAskUserAnswers({
      request,
      answers: [{ questionId: "tone", type: "single_choice", text: "更梦幻一点" }],
    }),
  ).toEqual([{ questionId: "tone", type: "single_choice", text: "更梦幻一点" }]);
});

test("ask_user rejects invalid single_choice answer shapes", async () => {
  const request = normalizeAskUserInput({
    questions: [
      {
        id: "tone",
        prompt: "偏什么气质？",
        kind: "single_choice",
        options: [
          { id: "quiet", label: "安静" },
          { id: "sharp", label: "锋利" },
        ],
      },
    ],
  });

  expect(() =>
    validateAskUserSubmission({
      request,
      answers: [{ questionId: "tone", type: "single_choice", optionId: "quiet", text: "别的" }],
    }),
  ).toThrow("必须且只能提供 optionId 或 text");
  expect(() =>
    validateAskUserSubmission({
      request,
      answers: [{ questionId: "tone", type: "single_choice" }],
    }),
  ).toThrow("必须且只能提供 optionId 或 text");
  expect(() =>
    validateAskUserSubmission({
      request,
      answers: [{ questionId: "tone", type: "single_choice", text: "   " }],
    }),
  ).toThrow("自定义答案不能为空");
  expect(() =>
    validateAskUserSubmission({
      request,
      answers: [{ questionId: "tone", type: "single_choice", optionId: "missing" }],
    }),
  ).toThrow("选项不存在");
});

test("list_manuscript_nodes returns structure without bodies by default", async () => {
  const workspace = await seedProject("assistant_tools_list_manuscript_default");
  const chapter = await workspaceDomain.createContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    parentId: null,
    title: "第一章",
    body: "第一章正文",
  });
  const scene = await workspaceDomain.createContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    parentId: chapter.id,
    title: "第一场",
    body: "第一场正文",
  });
  await workspaceDomain.createContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    parentId: scene.id,
    title: "镜头一",
    body: "镜头正文",
  });
  const tools = createAssistantTools({
    projectId: "assistant_tools_list_manuscript_default",
    runtimeContext: createRuntimeContext(),
  });

  const result = await executeTool(tools.list_manuscript_nodes!, {});

  expect(result).toEqual({
    ok: true,
    truncated: true,
    data: {
      depth: 2,
      entries: [
        {
          id: chapter.id,
          anchorTimelinePointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
          title: "第一章",
          children: [
            {
              id: scene.id,
              anchorTimelinePointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
              title: "第一场",
              hiddenChildrenCount: 1,
              children: [],
            },
          ],
        },
      ],
    },
  });
  expect(JSON.stringify(result)).not.toContain("第一章正文");
  expect(JSON.stringify(result)).not.toContain("第一场正文");
});

test("list_manuscript_nodes accepts a root node and deeper depth", async () => {
  const workspace = await seedProject("assistant_tools_list_manuscript_deep");
  const chapter = await workspaceDomain.createContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    parentId: null,
    title: "第一章",
  });
  const scene = await workspaceDomain.createContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    parentId: chapter.id,
    title: "第一场",
  });
  const beat = await workspaceDomain.createContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    parentId: scene.id,
    title: "镜头一",
  });
  const tools = createAssistantTools({
    projectId: "assistant_tools_list_manuscript_deep",
    runtimeContext: createRuntimeContext(),
  });

  const result = await executeTool(tools.list_manuscript_nodes!, {
    rootNodeId: chapter.id,
    depth: 3,
  });

  expect(result).toEqual({
    ok: true,
    truncated: false,
    data: {
      depth: 3,
      entries: [
        {
          id: chapter.id,
          anchorTimelinePointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
          title: "第一章",
          children: [
            {
              id: scene.id,
              anchorTimelinePointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
              title: "第一场",
              children: [
                {
                  id: beat.id,
                  anchorTimelinePointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
                  title: "镜头一",
                  children: [],
                },
              ],
            },
          ],
        },
      ],
    },
  });
});

test("read_manuscript_node returns one full node with child structure summaries", async () => {
  const workspace = await seedProject("assistant_tools_read_manuscript_node");
  const chapter = await workspaceDomain.createContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    parentId: null,
    title: "第一章",
    body: "第一章完整正文",
  });
  const scene = await workspaceDomain.createContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    parentId: chapter.id,
    title: "第一场",
    body: "子节点正文不应返回",
  });
  await workspaceDomain.createContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    parentId: scene.id,
    title: "镜头一",
  });
  const tools = createAssistantTools({
    projectId: "assistant_tools_read_manuscript_node",
    runtimeContext: createRuntimeContext(),
  });

  const result = await executeTool(tools.read_manuscript_node!, { nodeId: chapter.id });

  expect(result).toEqual({
    ok: true,
    truncated: false,
    data: {
      node: {
        id: chapter.id,
        anchorTimelinePointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
        title: "第一章",
        body: "第一章完整正文",
        children: [
          {
            id: scene.id,
            anchorTimelinePointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
            title: "第一场",
            hiddenChildrenCount: 1,
            children: [],
          },
        ],
      },
    },
  });
  expect(JSON.stringify(result)).not.toContain("子节点正文不应返回");
});

test("read_manuscript_node defaults to the active content node", async () => {
  const workspace = await seedProject("assistant_tools_read_active_manuscript_node");
  const chapter = await workspaceDomain.createContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    parentId: null,
    title: "当前章",
    body: "当前正文",
  });
  const tools = createAssistantTools({
    projectId: "assistant_tools_read_active_manuscript_node",
    runtimeContext: createRuntimeContext({
      workspaceId: workspace.id,
      activeContentNodeId: chapter.id,
      activeContentTitle: "当前章",
      activeAuxPath: null,
      activeTimelinePointId: null,
      activeTimelineLabel: null,
    }),
  });

  const result = await executeTool(tools.read_manuscript_node!, {});

  expect(result).toMatchObject({
    ok: true,
    truncated: false,
    data: {
      node: {
        id: chapter.id,
        title: "当前章",
        body: "当前正文",
      },
    },
  });
});

test("read_manuscript_node fails without a node id or active content node", async () => {
  await seedProject("assistant_tools_read_manuscript_node_missing");
  const tools = createAssistantTools({
    projectId: "assistant_tools_read_manuscript_node_missing",
    runtimeContext: createRuntimeContext(),
  });

  const result = await executeTool(tools.read_manuscript_node!, {});

  expect(result).toEqual({
    ok: false,
    error: "当前没有可读取的正文节点。",
  });
});

test("create_manuscript_node anchors new content to the current timeline point", async () => {
  const workspace = await seedProject("assistant_tools_create_manuscript_anchor");
  const timelinePoint = await workspaceDomain.createTimelinePoint({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    afterPointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
    label: "第二幕",
  });
  const tools = createAssistantTools({
    projectId: "assistant_tools_create_manuscript_anchor",
    runtimeContext: createRuntimeContext({
      workspaceId: workspace.id,
      activeContentNodeId: null,
      activeContentTitle: null,
      activeAuxPath: null,
      activeTimelinePointId: timelinePoint.id,
      activeTimelineLabel: timelinePoint.label,
    }),
  });

  const result = await executeTool(tools.create_manuscript_node!, {
    parentId: null,
    title: "新场景",
    body: "正文",
  });

  expect(result).toMatchObject({
    ok: true,
    truncated: false,
    data: {
      action: "created",
      parentId: null,
      title: "新场景",
      timelinePointId: timelinePoint.id,
    },
  });
  const nodeId = (result as { data: { nodeId: string } }).data.nodeId;
  expect(
    await workspaceDomain.readManuscriptNode(workspace.projectId, workspace.id, nodeId),
  ).toMatchObject({
    id: nodeId,
    anchorTimelinePointId: timelinePoint.id,
    title: "新场景",
    body: "正文",
  });
});

test("create_manuscript_node creates a top-level node when parentId is omitted", async () => {
  const workspace = await seedProject("assistant_tools_create_manuscript_top_level_omitted_parent");
  const tools = createAssistantTools({
    projectId: "assistant_tools_create_manuscript_top_level_omitted_parent",
    runtimeContext: createRuntimeContext(),
  });

  const result = await executeTool(tools.create_manuscript_node!, {
    title: "顶层章节",
  });

  expect(result).toMatchObject({
    ok: true,
    data: {
      action: "created",
      parentId: null,
      title: "顶层章节",
    },
  });

  const nodeId = (result as { data: { nodeId: string } }).data.nodeId;
  expect(
    (
      await workspaceDomain.listManuscriptNodes(workspace.projectId, workspace.id, undefined, {
        depth: 1,
      })
    ).nodes.map((node) => node.id),
  ).toContain(nodeId);
  expect(
    await workspaceDomain.readManuscriptNode(workspace.projectId, workspace.id, nodeId),
  ).toMatchObject({
    id: nodeId,
    title: "顶层章节",
  });
});

test("create_manuscript_node rejects missing or blank title", async () => {
  await seedProject("assistant_tools_create_manuscript_missing_title");
  const tools = createAssistantTools({
    projectId: "assistant_tools_create_manuscript_missing_title",
    runtimeContext: createRuntimeContext(),
  });

  await expect(
    executeTool(tools.create_manuscript_node!, {
      parentId: null,
    }),
  ).resolves.toMatchObject({
    ok: false,
    error: "title 不能为空。",
  });

  await expect(
    executeTool(tools.create_manuscript_node!, {
      parentId: null,
      title: "   ",
    }),
  ).resolves.toMatchObject({
    ok: false,
    error: "title 不能为空。",
  });
});

test("create_manuscript_node treats empty parent and sibling ids as top-level insertion", async () => {
  const workspace = await seedProject("assistant_tools_create_manuscript_empty_parent");
  await workspaceDomain.createContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    parentId: null,
    title: "已存在章节",
  });
  const tools = createAssistantTools({
    projectId: "assistant_tools_create_manuscript_empty_parent",
    runtimeContext: createRuntimeContext(),
  });

  await executeTool(tools.create_manuscript_node!, {
    parentId: "   ",
    afterSiblingId: "   ",
    title: "新顶层章节",
  });

  expect(
    (
      await workspaceDomain.listManuscriptNodes(workspace.projectId, workspace.id, undefined, {
        depth: 1,
      })
    ).nodes.map((node) => node.title),
  ).toEqual(["新顶层章节", "已存在章节"]);
});

test("create_manuscript_node preserves call order when parallel calls share an insertion point", async () => {
  const workspace = await seedProject("assistant_tools_create_manuscript_parallel_order");
  const chapter7 = await workspaceDomain.createContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    parentId: null,
    title: "第七章",
  });
  await workspaceDomain.createContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    parentId: null,
    afterSiblingId: chapter7.id,
    title: "终章",
  });
  const tools = createAssistantTools({
    projectId: "assistant_tools_create_manuscript_parallel_order",
    runtimeContext: createRuntimeContext(),
  });

  await Promise.all([
    executeTool(tools.create_manuscript_node!, {
      parentId: null,
      afterSiblingId: chapter7.id,
      title: "第八章",
    }),
    executeTool(tools.create_manuscript_node!, {
      parentId: null,
      afterSiblingId: chapter7.id,
      title: "第九章",
    }),
    executeTool(tools.create_manuscript_node!, {
      parentId: null,
      afterSiblingId: chapter7.id,
      title: "第十章",
    }),
  ]);

  expect(
    (
      await workspaceDomain.listManuscriptNodes(workspace.projectId, workspace.id, undefined, {
        depth: 1,
      })
    ).nodes.map((node) => node.title),
  ).toEqual(["第七章", "第八章", "第九章", "第十章", "终章"]);
});

test("content write tools return manuscript titles for model and UI summaries", async () => {
  const workspace = await seedProject("assistant_tools_content_write_titles");
  const chapter = await workspaceDomain.createContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    parentId: null,
    title: "旧标题",
  });
  const parent = await workspaceDomain.createContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    parentId: null,
    title: "第二卷",
  });
  const tools = createAssistantTools({
    projectId: "assistant_tools_content_write_titles",
    runtimeContext: createRuntimeContext(),
  });

  await expect(
    executeTool(tools.update_manuscript_node!, {
      nodeId: chapter.id,
      title: "新标题",
    }),
  ).resolves.toMatchObject({
    ok: true,
    data: {
      action: "updated",
      nodeId: chapter.id,
      title: "新标题",
    },
  });

  await expect(
    executeTool(tools.move_manuscript_node!, {
      nodeId: chapter.id,
      newParentId: parent.id,
    }),
  ).resolves.toMatchObject({
    ok: true,
    data: {
      action: "moved",
      nodeId: chapter.id,
      title: "新标题",
      newParentId: parent.id,
    },
  });

  await expect(
    executeTool(tools.move_manuscript_node!, {
      nodeId: chapter.id,
      newParentId: "",
      afterSiblingId: "",
    }),
  ).resolves.toMatchObject({
    ok: true,
    data: {
      action: "moved",
      nodeId: chapter.id,
      title: "新标题",
      newParentId: null,
    },
  });

  await expect(
    executeTool(tools.delete_manuscript_node!, { nodeId: chapter.id }),
  ).resolves.toMatchObject({
    ok: true,
    data: {
      action: "deleted",
      nodeId: chapter.id,
      title: "新标题",
    },
  });
});

test("update_manuscript_node accepts null to clear body but not title", async () => {
  const workspace = await seedProject("assistant_tools_update_manuscript_nullable_fields");
  const chapter = await workspaceDomain.createContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    parentId: null,
    title: "原标题",
    body: "原正文",
  });
  const tools = createAssistantTools({
    projectId: "assistant_tools_update_manuscript_nullable_fields",
    runtimeContext: createRuntimeContext(),
  });

  const result = await executeTool(tools.update_manuscript_node!, {
    nodeId: chapter.id,
    body: null,
  });

  expect(result).toMatchObject({
    ok: true,
    data: {
      action: "updated",
      nodeId: chapter.id,
      title: "原标题",
    },
  });
  expect(
    await workspaceDomain.readManuscriptNode(workspace.projectId, workspace.id, chapter.id),
  ).toMatchObject({
    id: chapter.id,
    title: "原标题",
    body: "",
  });

  await expect(
    executeTool(tools.update_manuscript_node!, {
      nodeId: chapter.id,
      title: "   ",
    }),
  ).resolves.toMatchObject({
    ok: false,
    error: "title 不能为空。",
  });
});

test("update_manuscript_node warns when editing body outside the node anchor timeline", async () => {
  const workspace = await seedProject("assistant_tools_update_manuscript_anchor_warning");
  const anchoredPoint = await workspaceDomain.createTimelinePoint({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    afterPointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
    label: "锚定章节",
  });
  const currentPoint = await workspaceDomain.createTimelinePoint({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    afterPointId: anchoredPoint.id,
    label: "当前上下文",
  });
  const chapter = await workspaceDomain.createContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    parentId: null,
    anchorPointId: anchoredPoint.id,
    title: "章节",
    body: "旧正文",
  });
  const tools = createAssistantTools({
    projectId: "assistant_tools_update_manuscript_anchor_warning",
    runtimeContext: createRuntimeContext({
      workspaceId: workspace.id,
      activeContentNodeId: chapter.id,
      activeContentTitle: chapter.title,
      activeAuxPath: null,
      activeTimelinePointId: currentPoint.id,
      activeTimelineLabel: currentPoint.label,
    }),
  });

  const result = await executeTool(tools.update_manuscript_node!, {
    nodeId: chapter.id,
    body: "新正文",
  });

  expect(result).toMatchObject({
    ok: true,
    data: {
      action: "updated",
      nodeId: chapter.id,
      timelinePointId: anchoredPoint.id,
      warnings: [
        {
          code: "content_anchor_timeline_not_current",
          currentTimelinePointId: currentPoint.id,
          currentTimelineLabel: "当前上下文",
          nodeTimelinePointId: anchoredPoint.id,
          nodeTimelineLabel: "锚定章节",
        },
      ],
    },
  });
});

test("list_files returns a recursive tree by default", async () => {
  const workspace = await seedProject("assistant_tools_list_tree_default");
  await auxMkdir(workspace, "/设定");
  await auxMkdir(workspace, "/设定/世界观");
  await auxWrite(workspace, "/设定/角色.md", "角色");
  await auxWrite(workspace, "/设定/世界观/阵营.md", "阵营");
  await auxWrite(workspace, "/设定/世界观/王都.md", "王都");
  await auxMkdir(workspace, "/索引");
  await auxLink(workspace, "/索引/设定入口", "/设定");
  const tools = createAssistantTools({
    projectId: "assistant_tools_list_tree_default",
    runtimeContext: createRuntimeContext(),
  });

  const result = await executeTool(tools.list_files!, {});

  expect(result).toEqual({
    ok: true,
    truncated: false,
    data: {
      path: "/",
      depth: 2,
      entries: [
        {
          nodeType: "dir",
          name: "索引",
          path: "/索引",
          children: [
            {
              nodeType: "symlink",
              name: "设定入口",
              path: "/索引/设定入口",
              symlinkTargetPath: "/设定",
              children: [],
            },
          ],
        },
        {
          nodeType: "dir",
          name: "设定",
          path: "/设定",
          children: [
            {
              nodeType: "dir",
              name: "世界观",
              path: "/设定/世界观",
              children: [
                {
                  nodeType: "file",
                  name: "王都.md",
                  path: "/设定/世界观/王都.md",
                  children: [],
                },
                {
                  nodeType: "file",
                  name: "阵营.md",
                  path: "/设定/世界观/阵营.md",
                  children: [],
                },
              ],
            },
            {
              nodeType: "file",
              name: "角色.md",
              path: "/设定/角色.md",
              children: [],
            },
          ],
        },
      ],
    },
  });
});

test("list_files accepts a deeper depth for nested directories", async () => {
  const workspace = await seedProject("assistant_tools_list_tree_deep");
  await auxMkdir(workspace, "/设定");
  await auxMkdir(workspace, "/设定/世界观");
  await auxWrite(workspace, "/设定/世界观/王都.md", "王都");
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
          nodeType: "dir",
          name: "世界观",
          path: "/设定/世界观",
          children: [
            {
              nodeType: "file",
              name: "王都.md",
              path: "/设定/世界观/王都.md",
              children: [],
            },
          ],
        },
      ],
    },
  });
});

test("create_dir creates a directory at the current timeline point", async () => {
  const workspace = await seedProject("assistant_tools_mkdir");
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
    (
      await workspaceDomain.readAuxByPathAt(
        workspace.projectId,
        workspace.id,
        workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
        "/设定",
      )
    )?.nodeType,
  ).toBe("dir");
});

test("write_file creates a new file when the target path does not exist", async () => {
  const workspace = await seedProject("assistant_tools_write_create");
  await auxMkdir(workspace, "/设定");
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
    (
      await workspaceDomain.readAuxByPathAt(
        workspace.projectId,
        workspace.id,
        workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
        "/设定/角色.md",
      )
    )?.content,
  ).toBe("主角设定");
});

test("write_file overwrites an existing file", async () => {
  const workspace = await seedProject("assistant_tools_write_update");
  await auxMkdir(workspace, "/设定");
  await auxWrite(workspace, "/设定/角色.md", "旧内容");
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
    (
      await workspaceDomain.readAuxByPathAt(
        workspace.projectId,
        workspace.id,
        workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
        "/设定/角色.md",
      )
    )?.content,
  ).toBe("新内容");
});

test("write_file overlays inherited files without changing earlier timeline points", async () => {
  const workspace = await seedProject("assistant_tools_write_overlay_inherit");
  await auxMkdir(workspace, "/设定");
  await auxWrite(workspace, "/设定/角色.md", "origin 内容");
  const timelinePoint = await workspaceDomain.createTimelinePoint({
    projectId: workspace.projectId,
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
    (
      await workspaceDomain.readAuxByPathAt(
        workspace.projectId,
        workspace.id,
        workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
        "/设定/角色.md",
      )
    )?.content,
  ).toBe("origin 内容");
  expect(
    (
      await workspaceDomain.readAuxByPathAt(
        workspace.projectId,
        workspace.id,
        timelinePoint.id,
        "/设定/角色.md",
      )
    )?.content,
  ).toBe("draft 内容");
});

test("write_file returns an error when the parent directory does not exist", async () => {
  await seedProject("assistant_tools_write_missing_parent");
  const tools = createAssistantTools({
    projectId: "assistant_tools_write_missing_parent",
    runtimeContext: createRuntimeContext(),
  });

  const result = await executeTool(tools.write_file!, {
    path: "/设定/角色.md",
    content: "主角设定",
  });

  expect(result).toMatchObject({
    ok: false,
    error: "写入辅助资料文件失败：父目录不存在或在当前时间点不可见。",
  });
});

test("write_file returns an error when the target path is a directory", async () => {
  const workspace = await seedProject("assistant_tools_write_dir_guard");
  await auxMkdir(workspace, "/设定");
  const tools = createAssistantTools({
    projectId: "assistant_tools_write_dir_guard",
    runtimeContext: createRuntimeContext(),
  });

  const result = await executeTool(tools.write_file!, {
    path: "/设定",
    content: "should fail",
  });

  expect(result).toMatchObject({
    ok: false,
    error: "写入辅助资料文件失败：目标路径不是文件。",
  });
});

test("move_path renames a file in the same directory", async () => {
  const workspace = await seedProject("assistant_tools_move_rename");
  await auxMkdir(workspace, "/设定");
  await auxWrite(workspace, "/设定/角色.md", "主角设定");
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
    },
  });
  expect(
    await workspaceDomain.readAuxByPathAt(
      workspace.projectId,
      workspace.id,
      workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
      "/设定/角色.md",
    ),
  ).toBeNull();
  expect(
    (
      await workspaceDomain.readAuxByPathAt(
        workspace.projectId,
        workspace.id,
        workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
        "/设定/主角.md",
      )
    )?.path,
  ).toBe("/设定/主角.md");
});

test("move_path moves a file across directories", async () => {
  const workspace = await seedProject("assistant_tools_move_cross_dir");
  await auxMkdir(workspace, "/设定");
  await auxMkdir(workspace, "/资料库");
  await auxWrite(workspace, "/设定/角色.md", "主角设定");
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
    },
  });
  expect(
    (
      await workspaceDomain.readAuxByPathAt(
        workspace.projectId,
        workspace.id,
        workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
        "/资料库/角色.md",
      )
    )?.path,
  ).toBe("/资料库/角色.md");
});

test("move_path moves a directory", async () => {
  const workspace = await seedProject("assistant_tools_move_dir");
  await auxMkdir(workspace, "/设定");
  await auxMkdir(workspace, "/资料库");
  await auxMkdir(workspace, "/设定/角色");
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
    },
  });
  expect(
    (
      await workspaceDomain.readAuxByPathAt(
        workspace.projectId,
        workspace.id,
        workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
        "/资料库/角色档案",
      )
    )?.path,
  ).toBe("/资料库/角色档案");
});

test("move_path returns an error when the target path already exists", async () => {
  const workspace = await seedProject("assistant_tools_move_conflict");
  await auxMkdir(workspace, "/设定");
  await auxWrite(workspace, "/设定/角色.md", "a");
  await auxWrite(workspace, "/设定/主角.md", "b");
  const tools = createAssistantTools({
    projectId: "assistant_tools_move_conflict",
    runtimeContext: createRuntimeContext(),
  });

  const result = await executeTool(tools.move_path!, {
    path: "/设定/角色.md",
    newPath: "/设定/主角.md",
  });

  expect(result).toMatchObject({
    ok: false,
    error: "移动辅助资料失败：目标路径已存在。",
  });
});

test("move_path returns an error when the target parent directory does not exist", async () => {
  const workspace = await seedProject("assistant_tools_move_missing_parent");
  await auxMkdir(workspace, "/设定");
  await auxWrite(workspace, "/设定/角色.md", "a");
  const tools = createAssistantTools({
    projectId: "assistant_tools_move_missing_parent",
    runtimeContext: createRuntimeContext(),
  });

  const result = await executeTool(tools.move_path!, {
    path: "/设定/角色.md",
    newPath: "/资料库/角色.md",
  });

  expect(result).toMatchObject({
    ok: false,
    error: "移动辅助资料失败：父目录不存在或在当前时间点不可见。",
  });
});

test("move_path rejects moving a directory under its own subtree", async () => {
  const workspace = await seedProject("assistant_tools_move_into_child");
  await auxMkdir(workspace, "/设定");
  await auxMkdir(workspace, "/设定/角色");
  const tools = createAssistantTools({
    projectId: "assistant_tools_move_into_child",
    runtimeContext: createRuntimeContext(),
  });

  const result = await executeTool(tools.move_path!, {
    path: "/设定",
    newPath: "/设定/角色/设定",
  });

  expect(result).toMatchObject({
    ok: false,
    error: "不能把目录移动到自身子目录中。",
  });
});

test("move_path respects the active timeline point from context", async () => {
  const workspace = await seedProject("assistant_tools_move_timeline");
  await auxMkdir(workspace, "/设定");
  await auxMkdir(workspace, "/资料库");
  await auxWrite(workspace, "/设定/角色.md", "origin");
  const timelinePoint = await workspaceDomain.createTimelinePoint({
    projectId: workspace.projectId,
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
    (
      await workspaceDomain.readAuxByPathAt(
        workspace.projectId,
        workspace.id,
        workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
        "/设定/角色.md",
      )
    )?.path,
  ).toBe("/设定/角色.md");
  expect(
    (
      await workspaceDomain.readAuxByPathAt(
        workspace.projectId,
        workspace.id,
        timelinePoint.id,
        "/资料库/角色.md",
      )
    )?.path,
  ).toBe("/资料库/角色.md");
});

test("create_symlink creates a symlink to a file", async () => {
  const workspace = await seedProject("assistant_tools_symlink_file");
  await auxMkdir(workspace, "/设定");
  await auxMkdir(workspace, "/索引");
  await auxWrite(workspace, "/设定/角色.md", "主角设定");
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
    (
      await workspaceDomain.readAuxByPathAt(
        workspace.projectId,
        workspace.id,
        workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
        "/索引/角色.md",
      )
    )?.path,
  ).toBe("/索引/角色.md");
  expect(
    (
      await workspaceDomain.readAuxByPathAt(
        workspace.projectId,
        workspace.id,
        workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
        "/索引/角色.md",
      )
    )?.nodeType,
  ).toBe("symlink");
  expect(
    (
      await workspaceDomain.exportAuxSnapshotTree(
        workspace.projectId,
        workspace.id,
        workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
      )
    ).nodes.find((node) => node.path === "/索引")?.children[0]?.symlinkTargetPath,
  ).toBe("/设定/角色.md");
});

test("create_symlink creates a symlink to a directory", async () => {
  const workspace = await seedProject("assistant_tools_symlink_dir");
  await auxMkdir(workspace, "/设定");
  await auxMkdir(workspace, "/索引");
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
    },
  });
  const indexNode = (
    await workspaceDomain.exportAuxSnapshotTree(
      workspace.projectId,
      workspace.id,
      workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
    )
  ).nodes.find((node) => node.path === "/索引");
  expect(
    indexNode?.children.find((node) => node.path === "/索引/设定入口")?.symlinkTargetPath,
  ).toBe("/设定");
  expect(
    (
      await workspaceDomain.readAuxByPathAt(
        workspace.projectId,
        workspace.id,
        workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
        "/索引/设定入口",
      )
    )?.path,
  ).toBe("/索引/设定入口");
  expect(
    (
      await workspaceDomain.readAuxByPathAt(
        workspace.projectId,
        workspace.id,
        workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
        "/索引/设定入口",
      )
    )?.nodeType,
  ).toBe("symlink");
});

test("create_symlink accepts a broken logical target path", async () => {
  const workspace = await seedProject("assistant_tools_symlink_missing_target");
  await auxMkdir(workspace, "/索引");
  const tools = createAssistantTools({
    projectId: "assistant_tools_symlink_missing_target",
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
    (
      await workspaceDomain.readAuxByPathAt(
        workspace.projectId,
        workspace.id,
        workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
        "/索引/角色.md",
      )
    )?.symlinkTargetPath,
  ).toBe("/设定/角色.md");
});

test("create_symlink returns an error when the destination path already exists", async () => {
  const workspace = await seedProject("assistant_tools_symlink_conflict");
  await auxMkdir(workspace, "/设定");
  await auxMkdir(workspace, "/索引");
  await auxWrite(workspace, "/设定/角色.md", "主角设定");
  await auxWrite(workspace, "/索引/角色.md", "已存在");
  const tools = createAssistantTools({
    projectId: "assistant_tools_symlink_conflict",
    runtimeContext: createRuntimeContext(),
  });

  const result = await executeTool(tools.create_symlink!, {
    path: "/索引/角色.md",
    targetPath: "/设定/角色.md",
  });

  expect(result).toMatchObject({
    ok: false,
    error: "创建辅助资料符号链接失败：目标路径已存在。",
  });
});

test("create_symlink suggests retarget_symlink when the destination is an existing symlink", async () => {
  const workspace = await seedProject("assistant_tools_symlink_retarget_hint");
  await auxMkdir(workspace, "/设定");
  await auxMkdir(workspace, "/场景");
  await auxMkdir(workspace, "/索引");
  await auxLink(workspace, "/索引/入口", "/设定");
  const tools = createAssistantTools({
    projectId: "assistant_tools_symlink_retarget_hint",
    runtimeContext: createRuntimeContext(),
  });

  const result = await executeTool(tools.create_symlink!, {
    path: "/索引/入口",
    targetPath: "/场景",
  });

  expect(result).toMatchObject({
    ok: false,
    error:
      "创建辅助资料符号链接失败：同路径已存在符号链接。通常你想要的是调用 retarget_symlink 来修改它的目标。",
  });
  expect(
    (
      await workspaceDomain.readAuxByPathAt(
        workspace.projectId,
        workspace.id,
        workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
        "/场景",
      )
    )?.path,
  ).toBe("/场景");
});

test("retarget_symlink resolves the source path without following the symlink", async () => {
  const workspace = await seedProject("assistant_tools_symlink_retarget_source");
  await auxMkdir(workspace, "/大纲");
  await auxWrite(workspace, "/大纲/序幕大纲.md", "序幕");
  await auxWrite(workspace, "/大纲/第一幕大纲.md", "第一幕");
  await auxLink(workspace, "/当前大纲", "/大纲/序幕大纲.md");
  const tools = createAssistantTools({
    projectId: "assistant_tools_symlink_retarget_source",
    runtimeContext: createRuntimeContext(),
  });

  const result = await executeTool(tools.retarget_symlink!, {
    path: "/当前大纲",
    newTargetPath: "/大纲/第一幕大纲.md",
  });

  expect(result).toMatchObject({
    ok: true,
    data: {
      action: "retargeted",
      path: "/当前大纲",
      newTargetPath: "/大纲/第一幕大纲.md",
    },
  });
  expect(
    (
      await workspaceDomain.readAuxByPathAt(
        workspace.projectId,
        workspace.id,
        workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
        "/当前大纲",
      )
    )?.path,
  ).toBe("/当前大纲");
  expect(
    (
      await workspaceDomain.exportAuxSnapshotTree(
        workspace.projectId,
        workspace.id,
        workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
      )
    ).nodes.find((node) => node.path === "/当前大纲")?.symlinkTargetPath,
  ).toBe("/大纲/第一幕大纲.md");
});

test("aux write tools respect the active timeline point from context", async () => {
  const workspace = await seedProject("assistant_tools_timeline");
  const timelinePoint = await workspaceDomain.createTimelinePoint({
    projectId: workspace.projectId,
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
      activeAuxPath: null,
      activeTimelinePointId: timelinePoint.id,
      activeTimelineLabel: timelinePoint.label,
    }),
  });

  await executeTool(tools.create_dir!, { path: "/草稿" });

  expect(
    await workspaceDomain.readAuxByPathAt(
      workspace.projectId,
      workspace.id,
      workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
      "/草稿",
    ),
  ).toBeNull();
  expect(
    (
      await workspaceDomain.readAuxByPathAt(
        workspace.projectId,
        workspace.id,
        timelinePoint.id,
        "/草稿",
      )
    )?.nodeType,
  ).toBe("dir");
});

test("set_current_timeline updates runtime context for later file tools", async () => {
  const workspace = await seedProject("assistant_tools_set_timeline");
  const timelinePoint = await workspaceDomain.createTimelinePoint({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    afterPointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
    label: "Draft",
  });
  const runtimeContext = createRuntimeContext({
    workspaceId: workspace.id,
    activeContentNodeId: null,
    activeContentTitle: null,
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
  expect(
    (
      await workspaceDomain.readAuxByPathAt(
        workspace.projectId,
        workspace.id,
        timelinePoint.id,
        "/草稿",
      )
    )?.nodeType,
  ).toBe("dir");
  expect(
    await workspaceDomain.readAuxByPathAt(
      workspace.projectId,
      workspace.id,
      workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
      "/草稿",
    ),
  ).toBeNull();
});

test("set_current_timeline accepts origin", async () => {
  const workspace = await seedProject("assistant_tools_set_origin");
  const timelinePoint = await workspaceDomain.createTimelinePoint({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    afterPointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
    label: "Draft",
  });
  const runtimeContext = createRuntimeContext({
    workspaceId: workspace.id,
    activeContentNodeId: null,
    activeContentTitle: null,
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

test("set_current_timeline accepts timeline label as fallback and returns warning", async () => {
  const workspace = await seedProject("assistant_tools_set_timeline_by_label");
  const timelinePoint = await workspaceDomain.createTimelinePoint({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    afterPointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
    label: "Draft",
  });
  const runtimeContext = createRuntimeContext({
    workspaceId: workspace.id,
    activeContentNodeId: null,
    activeContentTitle: null,
    activeAuxPath: null,
    activeTimelinePointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
    activeTimelineLabel: "原点",
  });
  const tools = createAssistantTools({
    projectId: "assistant_tools_set_timeline_by_label",
    runtimeContext,
  });

  const selected = await executeTool(tools.set_current_timeline!, {
    timelinePointId: timelinePoint.label,
  });

  expect(selected).toMatchObject({
    ok: true,
    data: {
      action: "selected",
      timelinePointId: timelinePoint.id,
      timelineLabel: timelinePoint.label,
      warnings: [
        {
          code: "timeline_point_label_used_as_fallback",
          providedValue: timelinePoint.label,
          matchedTimelinePointId: timelinePoint.id,
          matchedTimelineLabel: timelinePoint.label,
        },
      ],
    },
  });
  expect(runtimeContext.snapshot?.activeTimelinePointId).toBe(timelinePoint.id);
});

test("list_story_timeline_points includes aux change summary counts", async () => {
  const { workspace, pointA, pointB } = await seedTimelineAuxDiffScenario(
    "assistant_tools_timeline_aux_summary",
  );
  const tools = createAssistantTools({
    projectId: "assistant_tools_timeline_aux_summary",
    runtimeContext: createRuntimeContext(),
  });

  const result = await executeTool(tools.list_story_timeline_points!, {});

  expect(result).toEqual({
    ok: true,
    truncated: false,
    data: {
      points: [
        {
          id: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
          label: "原点",
          description: null,
          prevPointId: null,
          isImplicitOrigin: true,
          auxChangeSummary: {
            hasChanges: false,
            added: 0,
            modified: 0,
            deleted: 0,
            total: 0,
          },
        },
        {
          id: pointA.id,
          label: pointA.label,
          description: null,
          prevPointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
          isImplicitOrigin: false,
          auxChangeSummary: {
            hasChanges: true,
            added: 1,
            modified: 1,
            deleted: 0,
            total: 2,
          },
        },
        {
          id: pointB.id,
          label: pointB.label,
          description: null,
          prevPointId: pointA.id,
          isImplicitOrigin: false,
          auxChangeSummary: {
            hasChanges: true,
            added: 0,
            modified: 1,
            deleted: 1,
            total: 2,
          },
        },
      ],
    },
  });
  expect(workspace.id).toBeTruthy();
});

test("list_current_timeline_aux_changes enumerates current timeline changes without file content", async () => {
  const { pointA, pointB } = await seedTimelineAuxDiffScenario(
    "assistant_tools_timeline_aux_changes",
  );
  const runtimeContext = createRuntimeContext({
    workspaceId: null,
    activeContentNodeId: null,
    activeContentTitle: null,
    activeAuxPath: null,
    activeTimelinePointId: pointB.id,
    activeTimelineLabel: pointB.label,
  });
  const tools = createAssistantTools({
    projectId: "assistant_tools_timeline_aux_changes",
    runtimeContext,
  });

  const result = await executeTool(tools.list_current_timeline_aux_changes!, {});

  expect(result).toEqual({
    ok: true,
    truncated: false,
    data: {
      timelinePointId: pointB.id,
      timelineLabel: pointB.label,
      previousTimelinePointId: pointA.id,
      previousTimelineLabel: pointA.label,
      summary: {
        hasChanges: true,
        added: 0,
        modified: 1,
        deleted: 1,
        total: 2,
      },
      changes: [
        {
          kind: "modified",
          nodeType: "symlink",
          path: "/current_location",
          previousPath: null,
          symlinkTargetPath: "/state/backup.md",
          previousSymlinkTargetPath: "/state/location.md",
          changedAspects: ["symlink_target"],
        },
        {
          kind: "deleted",
          nodeType: "file",
          path: "/delta-only.md",
          previousPath: null,
          symlinkTargetPath: null,
          previousSymlinkTargetPath: null,
          changedAspects: [],
        },
      ],
    },
  });
});

test("create_story_timeline_points accepts afterPointId as timeline label", async () => {
  const workspace = await seedProject("assistant_tools_create_timeline_after_label");
  const prologue = await workspaceDomain.createTimelinePoint({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    afterPointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
    label: "序幕",
  });
  await workspaceDomain.createTimelinePoint({
    projectId: workspace.projectId,
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
  expect(
    (await workspaceDomain.listTimelinePoints(workspace.projectId, workspace.id)).map(
      (point) => point.label,
    ),
  ).toEqual(["原点", "序幕", "转折", "第一章"]);
});

test("create_story_timeline_points prefers exact id over matching label", async () => {
  const workspace = await seedProject("assistant_tools_create_timeline_after_id_priority");
  const firstPoint = await workspaceDomain.createTimelinePoint({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    afterPointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
    label: "第一章",
  });
  await workspaceDomain.createTimelinePoint({
    projectId: workspace.projectId,
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

  expect(
    (await workspaceDomain.listTimelinePoints(workspace.projectId, workspace.id)).map(
      (point) => point.label,
    ),
  ).toEqual(["原点", "第一章", "插入点", firstPoint.id]);
});

test("create_story_timeline_points creates multiple points in one batch", async () => {
  const workspace = await seedProject("assistant_tools_create_timeline_batch");
  await workspaceDomain.createTimelinePoint({
    projectId: workspace.projectId,
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
  expect(
    (await workspaceDomain.listTimelinePoints(workspace.projectId, workspace.id)).map(
      (point) => point.label,
    ),
  ).toEqual(["原点", "序幕", "第一章", "第二章", "第三章"]);
});

test("move_story_timeline_point accepts pointId and afterPointId as timeline labels", async () => {
  const workspace = await seedProject("assistant_tools_move_timeline_by_label");
  await workspaceDomain.createTimelinePoint({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    afterPointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
    label: "序幕",
  });
  await workspaceDomain.createTimelinePoint({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    afterPointId: await (
      await workspaceDomain.listTimelinePoints(workspace.projectId, workspace.id)
    )[1]!.id,
    label: "第一章",
  });
  await workspaceDomain.createTimelinePoint({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    afterPointId: await (
      await workspaceDomain.listTimelinePoints(workspace.projectId, workspace.id)
    )[2]!.id,
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
      label: "第二章",
    },
  });
  expect(
    (await workspaceDomain.listTimelinePoints(workspace.projectId, workspace.id)).map(
      (point) => point.label,
    ),
  ).toEqual(["原点", "序幕", "第二章", "第一章"]);
});

test("move_story_timeline_point rejects origin by name", async () => {
  const workspace = await seedProject("assistant_tools_move_timeline_origin_guard");
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
  const workspace = await seedProject("assistant_tools_delete_timeline_by_label");
  await workspaceDomain.createTimelinePoint({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    afterPointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
    label: "序幕",
  });
  await workspaceDomain.createTimelinePoint({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    afterPointId: await (
      await workspaceDomain.listTimelinePoints(workspace.projectId, workspace.id)
    )[1]!.id,
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
      label: "序幕",
    },
  });
  expect(
    (await workspaceDomain.listTimelinePoints(workspace.projectId, workspace.id)).map(
      (point) => point.label,
    ),
  ).toEqual(["原点", "第一章"]);
});

test("delete_story_timeline_point rejects origin by name", async () => {
  await seedProject("assistant_tools_delete_timeline_origin_guard");
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
