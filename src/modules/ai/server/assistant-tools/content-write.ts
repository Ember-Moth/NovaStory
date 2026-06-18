import { jsonSchema, tool } from "ai";

import {
  createContentNode,
  deleteContentNode,
  moveContentNode,
  ORIGIN_TIMELINE_POINT_ID,
  readManuscriptNode,
  updateContentNode,
} from "@/modules/workspace/domain";

import type { ToolBuildContext } from "./context";
import { getTimelineLabelById, resolveCurrentTimelinePointId } from "./timeline-helpers";
import type { ContentWriteToolName } from "./tool-names";
import { normalizeOptionalStringToNull } from "./string-args";
import { withProjectWorkspace } from "./workspace";

type QueuedCreateAnchor = string | null;

function createManuscriptInsertQueueKey(input: { workspaceId: string; parentId: string | null }) {
  return `${input.workspaceId}:${input.parentId ?? "top"}`;
}

function normalizeRequiredNodeId(value: string, fieldName: string) {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${fieldName} 不能为空。`);
  }
  return normalized;
}

function normalizeRequiredTitle(value: string | null | undefined, fieldName: string) {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`${fieldName} 不能为空。`);
  }
  return normalized;
}

function normalizeOptionalUpdatedTitle(value: string | undefined) {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.trim();
  if (!normalized) {
    throw new Error("title 不能为空。");
  }
  return normalized;
}

function buildContentAnchorTimelineWarnings(input: {
  projectId: string;
  workspaceId: string;
  currentTimelinePointId: string;
  nodeTimelinePointId: string;
}) {
  if (input.currentTimelinePointId === input.nodeTimelinePointId) {
    return [];
  }

  return [
    {
      code: "content_anchor_timeline_not_current" as const,
      message:
        "当前章节锚定的时间轴锚点未被选中，如果需要读取章节锚定的上下文，请执行 set_current_timeline。",
      currentTimelinePointId: input.currentTimelinePointId,
      currentTimelineLabel: getTimelineLabelById(
        input.projectId,
        input.workspaceId,
        input.currentTimelinePointId,
      ),
      nodeTimelinePointId: input.nodeTimelinePointId,
      nodeTimelineLabel: getTimelineLabelById(
        input.projectId,
        input.workspaceId,
        input.nodeTimelinePointId,
      ),
    },
  ];
}

export function buildContentWriteTools({ projectId, runtimeContext }: ToolBuildContext) {
  const createManuscriptNodeQueues = new Map<string, Promise<QueuedCreateAnchor>>();

  return {
    create_manuscript_node: tool({
      description:
        "在正文树中创建新的章节节点，并自动锚定到当前故事时间轴的时间点。仅在用户明确要求新增正文/章节时使用；必须提供非空标题。parentId 决定新节点归属在哪个父节点下，省略、null 或空字符串表示创建到顶层；afterSiblingId 只决定同一父节点下的排序位置，省略、null 或空字符串表示插入为该层级的第一个节点。同一轮里连续创建到同一位置的节点会按工具调用顺序排列。",
      inputSchema: jsonSchema<{
        parentId?: string | null;
        afterSiblingId?: string | null;
        title: string;
        body?: string;
      }>({
        type: "object",
        required: ["title"],
        properties: {
          parentId: {
            type: ["string", "null"],
            description:
              "父正文节点 ID。新节点会作为该节点的子节点；省略、null 或空字符串表示创建到顶层。",
          },
          afterSiblingId: {
            type: ["string", "null"],
            description:
              "插入到该兄弟节点之后。省略、null 或空字符串时插入为该层级的第一个节点；同一轮里连续省略时按工具调用顺序排列。",
          },
          title: {
            type: "string",
            description: "章节标题。必须为非空字符串。",
          },
          body: {
            type: "string",
            description: "章节正文内容。",
          },
        },
      }),
      execute: ({ parentId, afterSiblingId, title, body }) =>
        withProjectWorkspace({
          projectId,
          execute: async (workspace) => {
            const normalizedParentId = normalizeOptionalStringToNull(parentId);
            const normalizedAfterSiblingId = normalizeOptionalStringToNull(afterSiblingId);
            const normalizedTitle = normalizeRequiredTitle(title, "title");
            const queueKey = createManuscriptInsertQueueKey({
              workspaceId: workspace.id,
              parentId: normalizedParentId,
            });
            const previousCreate =
              createManuscriptNodeQueues.get(queueKey) ?? Promise.resolve(null);

            const resultPromise = previousCreate
              .catch(() => normalizedAfterSiblingId)
              .then((queuedAfterSiblingId) => {
                const effectiveAfterSiblingId = queuedAfterSiblingId ?? normalizedAfterSiblingId;
                const resolvedTimelinePointId = resolveCurrentTimelinePointId(runtimeContext);
                const node = createContentNode({
                  projectId: workspace.projectId,
                  workspaceId: workspace.id,
                  parentId: normalizedParentId,
                  afterSiblingId: effectiveAfterSiblingId ?? undefined,
                  anchorPointId: resolvedTimelinePointId,
                  title: normalizedTitle,
                  body: body ?? undefined,
                });

                return {
                  ok: true as const,
                  truncated: false,
                  data: {
                    action: "created" as const,
                    nodeId: node.id,
                    title: node.title,
                    parentId: node.parentId,
                    timelinePointId: resolvedTimelinePointId,
                  },
                };
              });

            createManuscriptNodeQueues.set(
              queueKey,
              resultPromise.then(
                (result) => result.data.nodeId,
                () => normalizedAfterSiblingId,
              ),
            );

            return await resultPromise;
          },
        }),
    }),
    update_manuscript_node: tool({
      description:
        "更新正文节点的标题、正文或锚定时间点。仅在用户明确要求修改正文时使用；省略的字段不会改变。",
      inputSchema: jsonSchema<{
        nodeId: string;
        title?: string;
        body?: string | null;
        anchorPointId?: string;
      }>({
        type: "object",
        required: ["nodeId"],
        properties: {
          nodeId: {
            type: "string",
            description: "要更新的正文节点 ID。",
          },
          title: {
            type: "string",
            description: "新的章节标题。省略则不修改；如提供，必须为非空字符串。",
          },
          body: {
            type: ["string", "null"],
            description: "新的正文完整内容。省略则不修改；传 null 可清除。",
          },
          anchorPointId: {
            type: "string",
            description: "新的锚定时间点 ID。省略则不修改锚定关系。",
          },
        },
      }),
      execute: ({ nodeId, title, body, anchorPointId }) =>
        withProjectWorkspace({
          projectId,
          execute: (workspace) => {
            const normalizedNodeId = normalizeRequiredNodeId(nodeId, "nodeId");
            const normalizedTitle = normalizeOptionalUpdatedTitle(title);
            const currentTimelinePointId = resolveCurrentTimelinePointId(runtimeContext);
            const node = updateContentNode({
              projectId: workspace.projectId,
              workspaceId: workspace.id,
              nodeId: normalizedNodeId,
              title: normalizedTitle,
              body: body === undefined ? undefined : (body ?? null),
              anchorPointId: anchorPointId ?? undefined,
            });
            const warnings =
              body === undefined
                ? []
                : buildContentAnchorTimelineWarnings({
                    projectId: workspace.projectId,
                    workspaceId: workspace.id,
                    currentTimelinePointId,
                    nodeTimelinePointId: node.anchorTimelinePointId ?? ORIGIN_TIMELINE_POINT_ID,
                  });
            const timelinePointId = node.anchorTimelinePointId ?? ORIGIN_TIMELINE_POINT_ID;

            return {
              ok: true as const,
              truncated: false,
              data: {
                action: "updated" as const,
                nodeId: node.id,
                title: node.title,
                timelinePointId,
                ...(warnings.length > 0 ? { warnings } : {}),
              },
            };
          },
        }),
    }),
    move_manuscript_node: tool({
      description:
        "移动或重排正文节点。会改变正文结构和章节顺序；newParentId 决定移动后归属在哪个父节点下，省略、null 或空字符串表示移动到顶层；afterSiblingId 只决定同一父节点下的排序位置，省略、null 或空字符串表示插入为该层级的第一个节点。",
      inputSchema: jsonSchema<{
        nodeId: string;
        newParentId?: string | null;
        afterSiblingId?: string | null;
      }>({
        type: "object",
        required: ["nodeId"],
        properties: {
          nodeId: {
            type: "string",
            description: "要移动的正文节点 ID。",
          },
          newParentId: {
            type: ["string", "null"],
            description:
              "新父正文节点 ID。目标节点会被移动为该节点的直接子节点；省略、null 或空字符串表示移动到顶层；不要填“要移动到其后”的节点 ID。",
          },
          afterSiblingId: {
            type: ["string", "null"],
            description:
              "移动后的前一个同级正文节点 ID。该节点必须已经在 newParentId 下；目标节点会插入到它后面。省略、null 或空字符串时插入为该层级的第一个节点；不要用父节点 ID 填这里。",
          },
        },
      }),
      execute: ({ nodeId, newParentId, afterSiblingId }) =>
        withProjectWorkspace({
          projectId,
          execute: (workspace) => {
            const normalizedNodeId = normalizeRequiredNodeId(nodeId, "nodeId");
            const normalizedParentId = normalizeOptionalStringToNull(newParentId);
            const normalizedAfterSiblingId = normalizeOptionalStringToNull(afterSiblingId);
            const node = moveContentNode({
              projectId: workspace.projectId,
              workspaceId: workspace.id,
              nodeId: normalizedNodeId,
              newParentId: normalizedParentId,
              afterSiblingId: normalizedAfterSiblingId ?? undefined,
            });

            return {
              ok: true as const,
              truncated: false,
              data: {
                action: "moved" as const,
                nodeId: node.id,
                title: node.title,
                newParentId: node.parentId,
              },
            };
          },
        }),
    }),
    delete_manuscript_node: tool({
      description:
        "删除正文节点。删除非叶节点会连同所有子节点一起删除；此操作不可逆，仅在用户明确要求删除时使用。",
      inputSchema: jsonSchema<{ nodeId: string }>({
        type: "object",
        required: ["nodeId"],
        properties: {
          nodeId: {
            type: "string",
            description: "要删除的正文节点 ID。",
          },
        },
      }),
      execute: ({ nodeId }) =>
        withProjectWorkspace({
          projectId,
          execute: (workspace) => {
            const normalizedNodeId = normalizeRequiredNodeId(nodeId, "nodeId");
            const node = readManuscriptNode(workspace.projectId, workspace.id, normalizedNodeId);
            deleteContentNode({
              projectId: workspace.projectId,
              workspaceId: workspace.id,
              nodeId: normalizedNodeId,
            });

            return {
              ok: true as const,
              truncated: false,
              data: {
                action: "deleted" as const,
                nodeId: normalizedNodeId,
                title: node.title,
              },
            };
          },
        }),
    }),
  } satisfies Record<ContentWriteToolName, unknown>;
}
