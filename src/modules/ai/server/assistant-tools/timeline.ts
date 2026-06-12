import { tool } from "ai";

import {
  createTimelinePoint,
  deleteTimelinePoint,
  listTimelinePoints,
  moveTimelinePoint,
  updateTimelinePoint,
} from "@/modules/workspace/domain";

import type { ToolBuildContext, TimelineToolName } from "./_shared";
import {
  failure,
  getWorkspaceForProject,
  jsonSchema,
  limitTimelinePoints,
  withEnvelope,
} from "./_shared";

export function buildTimelineTools({ projectId }: ToolBuildContext) {
  return {
    list_timeline_points: tool({
      description:
        "读取当前项目默认工作区的时间线列表。" +
        "时间线是小说创作的骨架，定义故事推进的每个关键节拍，" +
        "章节通过锚定时间点来关联时间轴位置，时间线的排列顺序即为叙事的推进顺序。",
      inputSchema: jsonSchema<Record<string, never>>({
        type: "object",
        additionalProperties: false,
      }),
      execute: async () => {
        const workspace = getWorkspaceForProject(projectId);
        if (!workspace) {
          return failure(new Error("当前项目没有默认工作区。"));
        }

        return withEnvelope(() => {
          const limited = limitTimelinePoints(listTimelinePoints(workspace.id));
          return {
            ok: true,
            truncated: limited.truncated,
            data: {
              points: limited.points,
            },
          };
        });
      },
    }),
    create_timeline_point: tool({
      description:
        "在时间线上创建新的时间点。时间线是小说创作的骨架，定义故事推进的每个关键节拍；" +
        "新时间点将插入到指定前驱时间点之后，省略 afterPointId 则插入到时间线末尾。",
      inputSchema: jsonSchema<{
        key: string;
        label: string;
        description?: string;
        afterPointId?: string;
      }>({
        type: "object",
        required: ["key", "label"],
        properties: {
          key: {
            type: "string",
            description: "时间点的唯一标识符，用于内部引用。",
          },
          label: {
            type: "string",
            description: "时间点的显示名称，如「序幕」「第一章」「转折」等。",
          },
          description: {
            type: "string",
            description: "时间点的详细说明，描述该节拍在故事中的作用。",
          },
          afterPointId: {
            type: "string",
            description:
              '新时间点将插入到此时间点之后。省略则在时间线末尾追加。传入 "origin" 表示插入到原点之后。',
          },
        },
      }),
      execute: async ({ key, label, description, afterPointId }) => {
        const workspace = getWorkspaceForProject(projectId);
        if (!workspace) {
          return failure(new Error("当前项目没有默认工作区。"));
        }

        return withEnvelope(() => {
          const point = createTimelinePoint({
            workspaceId: workspace.id,
            key,
            label,
            description: description ?? undefined,
            afterPointId: afterPointId ?? undefined,
          });

          return {
            ok: true,
            truncated: false,
            data: {
              action: "created" as const,
              pointId: point.id,
              key: point.key,
              label: point.label,
            },
          };
        });
      },
    }),
    update_timeline_point: tool({
      description: "更新时间点的标签或描述。无法修改原点时间点。",
      inputSchema: jsonSchema<{
        pointId: string;
        label?: string;
        description?: string;
      }>({
        type: "object",
        required: ["pointId"],
        properties: {
          pointId: {
            type: "string",
            description: "要更新的时间点 ID。",
          },
          label: {
            type: "string",
            description: "新的时间点标签。",
          },
          description: {
            type: "string",
            description: "新的时间点描述，传空字符串可清除。",
          },
        },
      }),
      execute: async ({ pointId, label, description }) => {
        const workspace = getWorkspaceForProject(projectId);
        if (!workspace) {
          return failure(new Error("当前项目没有默认工作区。"));
        }

        return withEnvelope(() => {
          const point = updateTimelinePoint({
            workspaceId: workspace.id,
            pointId,
            label: label ?? undefined,
            description: description === undefined ? undefined : description || null,
          });

          return {
            ok: true,
            truncated: false,
            data: {
              action: "updated" as const,
              pointId: point.id,
            },
          };
        });
      },
    }),
    move_timeline_point: tool({
      description:
        "在时间线上重排时间点。将指定时间点移动到另一个时间点之后，从而改变叙事的推进顺序。" +
        "时间线的排列顺序即为故事的时间推进顺序，重新排列会直接影响读者体验。",
      inputSchema: jsonSchema<{
        pointId: string;
        afterPointId?: string;
      }>({
        type: "object",
        required: ["pointId"],
        properties: {
          pointId: {
            type: "string",
            description: "要移动的时间点 ID。",
          },
          afterPointId: {
            type: "string",
            description:
              '移动后该时间点将排在此时间点之后。省略则移动到时间线末尾。传入 "origin" 表示移动到原点之后。',
          },
        },
      }),
      execute: async ({ pointId, afterPointId }) => {
        const workspace = getWorkspaceForProject(projectId);
        if (!workspace) {
          return failure(new Error("当前项目没有默认工作区。"));
        }

        return withEnvelope(() => {
          const point = moveTimelinePoint({
            workspaceId: workspace.id,
            pointId,
            afterPointId: afterPointId ?? undefined,
          });

          return {
            ok: true,
            truncated: false,
            data: {
              action: "moved" as const,
              pointId: point.id,
            },
          };
        });
      },
    }),
    delete_timeline_point: tool({
      description:
        "删除时间线上的时间点。若该时间点有章节锚定或辅助资料关联，删除将被阻止并提示原因。" +
        "此操作不可逆。",
      inputSchema: jsonSchema<{
        pointId: string;
        purgeAuxLayers?: boolean;
      }>({
        type: "object",
        required: ["pointId"],
        properties: {
          pointId: {
            type: "string",
            description: "要删除的时间点 ID。不能删除原点时间点。",
          },
          purgeAuxLayers: {
            type: "boolean",
            description:
              "是否一并删除该时间点关联的辅助资料层。若不设为 true，存在辅助资料关联时删除将失败。",
          },
        },
      }),
      execute: async ({ pointId, purgeAuxLayers }) => {
        const workspace = getWorkspaceForProject(projectId);
        if (!workspace) {
          return failure(new Error("当前项目没有默认工作区。"));
        }

        return withEnvelope(() => {
          deleteTimelinePoint(workspace.id, pointId, {
            purgeAuxLayers: purgeAuxLayers ?? undefined,
          });

          return {
            ok: true,
            truncated: false,
            data: {
              action: "deleted" as const,
              pointId,
            },
          };
        });
      },
    }),
  } satisfies Record<TimelineToolName, unknown>;
}
