import { jsonSchema, tool } from "ai";

import {
  createTimelinePoints,
  deleteTimelinePoint,
  listTimelinePoints,
  listAuxTimelineChangesAt,
  moveTimelinePoint,
  summarizeAuxTimelineChangesAt,
  updateTimelinePoint,
  ORIGIN_TIMELINE_POINT_ID,
} from "@/modules/workspace/domain";
import { invariant } from "@/shared/lib/domain";

import type { ToolBuildContext } from "./context";
import { failure, withEnvelope } from "./envelope";
import { limitItems, limitTimelinePoints, TIMELINE_AUX_CHANGE_LIMIT } from "./limits";
import {
  getTimelineLabelById,
  resolveCurrentTimelinePointId,
  resolveSelectableTimelinePoint,
  resolveTimelinePointIdOrLabel,
  updateRuntimeTimelineSelection,
} from "./timeline-helpers";
import type { TimelineToolName } from "./tool-names";
import { getWorkspaceForProject } from "./workspace";

export function buildTimelineTools({ projectId, runtimeContext }: ToolBuildContext) {
  return {
    list_story_timeline_points: tool({
      description:
        "获取全部时间点。origin 是内置原点，用于放置全局初始设定，不属于故事推进顺序；第一个自定义时间点才是故事时间线的真正起点。列表按时间推进顺序排列。",
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
              points: limited.points.map((point) => ({
                ...point,
                auxChangeSummary: summarizeAuxTimelineChangesAt(workspace.id, point.id),
              })),
            },
          };
        });
      },
    }),
    list_current_timeline_aux_changes: tool({
      description:
        "枚举某个故事时间点相对前一个时间点的辅助信息变更详情。默认读取当前时间点；会列出新增、修改、删除以及符号链接目标变化，但不会返回文件内容。",
      inputSchema: jsonSchema<{ timelinePointId?: string }>({
        type: "object",
        additionalProperties: false,
        properties: {
          timelinePointId: {
            type: "string",
            description:
              '要检查的时间点 ID 或名称。省略时使用当前时间点；若当前是 "origin" 则无法比较。',
          },
        },
      }),
      execute: async ({ timelinePointId }) => {
        const workspace = getWorkspaceForProject(projectId);
        if (!workspace) {
          return failure(new Error("当前项目没有默认工作区。"));
        }

        return withEnvelope(() => {
          const resolvedPointId =
            timelinePointId === undefined
              ? resolveCurrentTimelinePointId(runtimeContext)
              : resolveTimelinePointIdOrLabel({
                  workspaceId: workspace.id,
                  timelinePointIdOrLabel: timelinePointId,
                });
          invariant(
            resolvedPointId !== ORIGIN_TIMELINE_POINT_ID,
            "原点没有前一个时间线，无法枚举辅助信息变更。",
          );

          const point = listTimelinePoints(workspace.id).find(
            (item) => item.id === resolvedPointId,
          );
          invariant(point, "指定的时间点不存在。");
          invariant(point.prevPointId, "原点没有前一个时间线，无法枚举辅助信息变更。");

          const changes = listAuxTimelineChangesAt(workspace.id, resolvedPointId);
          const limited = limitItems(changes, TIMELINE_AUX_CHANGE_LIMIT);

          return {
            ok: true,
            truncated: limited.truncated,
            data: {
              timelinePointId: resolvedPointId,
              timelineLabel: getTimelineLabelById(workspace.id, resolvedPointId),
              previousTimelinePointId: point.prevPointId,
              previousTimelineLabel: getTimelineLabelById(workspace.id, point.prevPointId),
              summary: summarizeAuxTimelineChangesAt(workspace.id, resolvedPointId),
              changes: limited.items,
            },
          };
        });
      },
    }),
    set_current_timeline: tool({
      description:
        '重新设置当前时间点。之后同一轮以及后续继续/重试中的 `list_files` `read_file` `create_dir` `write_file` `move_path` `delete_path` `create_symlink` `retarget_symlink` 都会基于这个当前时间点操作。传入 "origin" 可切回全局初始设定原点。',
      inputSchema: jsonSchema<{ timelinePointId: string }>({
        type: "object",
        required: ["timelinePointId"],
        properties: {
          timelinePointId: {
            type: "string",
            description: '要切换到的时间点 ID。传入 "origin" 表示切换到全局初始设定原点。',
          },
        },
      }),
      execute: async ({ timelinePointId }) => {
        const workspace = getWorkspaceForProject(projectId);
        if (!workspace) {
          return failure(new Error("当前项目没有默认工作区。"));
        }

        return withEnvelope(() => {
          const selected = resolveSelectableTimelinePoint({
            workspaceId: workspace.id,
            timelinePointId,
          });
          updateRuntimeTimelineSelection({
            runtimeContext,
            timelinePointId: selected.timelinePointId,
            timelineLabel: selected.timelineLabel,
          });

          return {
            ok: true,
            truncated: false,
            data: {
              action: "selected" as const,
              timelinePointId: selected.timelinePointId,
              timelineLabel: selected.timelineLabel,
            },
          };
        });
      },
    }),
    create_story_timeline_points: tool({
      description:
        "在故事时间线上按顺序一次创建多个新时间点。用于批量新增剧情节拍；origin 是内置的全局初始设定原点，story 时间线从第一个自定义时间点开始。省略 afterPointId 时整体追加到故事时间线末尾。",
      inputSchema: jsonSchema<{
        points: Array<{
          label: string;
          description?: string;
        }>;
        afterPointId?: string;
      }>({
        type: "object",
        required: ["points"],
        properties: {
          points: {
            type: "array",
            minItems: 1,
            description: "要按顺序创建的时间点列表。数组顺序就是插入后的故事时间推进顺序。",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["label"],
              properties: {
                label: {
                  type: "string",
                  description: "时间点的显示名称，如「序幕」「第一章」「转折」等。",
                },
                description: {
                  type: "string",
                  description: "时间点说明，描述该剧情节拍在故事中的作用。",
                },
              },
            },
          },
          afterPointId: {
            type: "string",
            description:
              '新时间点列表将整体插入到此时间点之后。省略则在故事时间线末尾追加。传入 "origin" 表示插入到全局初始设定原点之后，即故事时间线的最前端。',
          },
        },
      }),
      execute: async ({ points, afterPointId }) => {
        const workspace = getWorkspaceForProject(projectId);
        if (!workspace) {
          return failure(new Error("当前项目没有默认工作区。"));
        }

        return withEnvelope(() => {
          const resolvedAfterPointId =
            afterPointId === undefined
              ? undefined
              : resolveTimelinePointIdOrLabel({
                  workspaceId: workspace.id,
                  timelinePointIdOrLabel: afterPointId,
                });
          const createdPoints = createTimelinePoints({
            workspaceId: workspace.id,
            afterPointId: resolvedAfterPointId,
            points: points.map((point) => ({
              label: point.label,
              description: point.description ?? undefined,
            })),
          });

          return {
            ok: true,
            truncated: false,
            data: {
              action: "created_batch" as const,
              points: createdPoints.map((point) => ({
                pointId: point.id,
                label: point.label,
              })),
            },
          };
        });
      },
    }),
    update_story_timeline_point: tool({
      description:
        "更新时间点的标签或说明。用于调整已有剧情节拍的信息；origin 是内置的全局初始设定锚点，不可修改。",
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
            description: "新的时间点说明。传空字符串可清除。",
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
              label: point.label,
            },
          };
        });
      },
    }),
    move_story_timeline_point: tool({
      description:
        "重排故事时间线上的时间点。会改变故事时间推进顺序和章节锚定语境；省略 afterPointId 时移动到末尾。",
      inputSchema: jsonSchema<{
        pointId: string;
        afterPointId?: string;
      }>({
        type: "object",
        required: ["pointId"],
        properties: {
          pointId: {
            type: "string",
            description: "要移动的时间点 ID 或名称。",
          },
          afterPointId: {
            type: "string",
            description:
              '移动后该时间点将排在此时间点之后。可传时间点 ID 或名称。省略则移动到故事时间线末尾。传入 "origin" 表示移动到全局初始设定原点之后，即故事时间线的最前端。',
          },
        },
      }),
      execute: async ({ pointId, afterPointId }) => {
        const workspace = getWorkspaceForProject(projectId);
        if (!workspace) {
          return failure(new Error("当前项目没有默认工作区。"));
        }

        return withEnvelope(() => {
          const resolvedPointId = resolveTimelinePointIdOrLabel({
            workspaceId: workspace.id,
            timelinePointIdOrLabel: pointId,
          });
          invariant(resolvedPointId !== ORIGIN_TIMELINE_POINT_ID, "无法移动原点时间点。");
          const resolvedAfterPointId =
            afterPointId === undefined
              ? undefined
              : resolveTimelinePointIdOrLabel({
                  workspaceId: workspace.id,
                  timelinePointIdOrLabel: afterPointId,
                });
          const point = moveTimelinePoint({
            workspaceId: workspace.id,
            pointId: resolvedPointId,
            afterPointId: resolvedAfterPointId,
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
    delete_story_timeline_point: tool({
      description:
        "删除故事时间线上的时间点。若有章节锚定或参考资料关联会被阻止，除非允许清理关联参考资料层；此操作不可逆。",
      inputSchema: jsonSchema<{
        pointId: string;
        purgeAuxLayers?: boolean;
      }>({
        type: "object",
        required: ["pointId"],
        properties: {
          pointId: {
            type: "string",
            description: "要删除的时间点 ID 或名称。不能删除 origin 原点（全局初始设定锚点）。",
          },
          purgeAuxLayers: {
            type: "boolean",
            description:
              "是否一并删除该时间点关联的参考资料层。若不设为 true，存在参考资料关联时删除会失败。",
          },
        },
      }),
      execute: async ({ pointId, purgeAuxLayers }) => {
        const workspace = getWorkspaceForProject(projectId);
        if (!workspace) {
          return failure(new Error("当前项目没有默认工作区。"));
        }

        return withEnvelope(() => {
          const resolvedPointId = resolveTimelinePointIdOrLabel({
            workspaceId: workspace.id,
            timelinePointIdOrLabel: pointId,
          });
          invariant(resolvedPointId !== ORIGIN_TIMELINE_POINT_ID, "无法删除原点时间点。");
          deleteTimelinePoint(workspace.id, resolvedPointId, {
            purgeAuxLayers: purgeAuxLayers ?? undefined,
          });

          return {
            ok: true,
            truncated: false,
            data: {
              action: "deleted" as const,
              pointId: resolvedPointId,
            },
          };
        });
      },
    }),
  } satisfies Record<TimelineToolName, unknown>;
}
