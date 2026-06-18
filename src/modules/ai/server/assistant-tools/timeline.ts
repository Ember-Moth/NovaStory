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
import { limitItems, limitTimelinePoints, TIMELINE_AUX_CHANGE_LIMIT } from "./limits";
import {
  getTimelineLabelById,
  resolveCurrentTimelinePointId,
  resolveOptionalTimelinePointIdOrLabel,
  resolveSelectableTimelinePoint,
  resolveTimelinePointIdOrLabel,
  updateRuntimeTimelineSelection,
} from "./timeline-helpers";
import type { TimelineToolName } from "./tool-names";
import { withProjectWorkspace } from "./workspace";

export function buildTimelineTools({ projectId, runtimeContext }: ToolBuildContext) {
  return {
    list_story_timeline_points: tool({
      description:
        "列出全部时间锚点。origin 是内置原点，存放故事开始前的全局初始设定。自定义时间锚点代表故事中「世界状态发生重大变化」的关键时刻——一个锚点可以跨越多个章节/场景，无需每章都建。切换到某个锚点后，辅助资料读写将基于该时间断面的资料快照。列表按时序排列。",
      inputSchema: jsonSchema<Record<string, never>>({
        type: "object",
        additionalProperties: false,
      }),
      execute: () =>
        withProjectWorkspace({
          projectId,
          execute: async (workspace) => {
            const limited = limitTimelinePoints(
              await listTimelinePoints(workspace.projectId, workspace.id),
            );
            return {
              ok: true as const,
              truncated: limited.truncated,
              data: {
                points: limited.points.map((point) => ({
                  ...point,
                  auxChangeSummary: summarizeAuxTimelineChangesAt(
                    workspace.projectId,
                    workspace.id,
                    point.id,
                  ),
                })),
              },
            };
          },
        }),
    }),
    list_current_timeline_aux_changes: tool({
      description:
        "查看某个时间锚点相对前一个锚点的辅助资料变更详情。用于了解「从这个锚点开始世界设定发生了什么变化」。默认读取当前锚点；会列出新增、修改、删除及符号链接目标变化，但不返回文件内容。注意：对 origin 原点调用无意义——原点之前没有锚点，无法计算变更。",
      inputSchema: jsonSchema<{ timelinePointId?: string }>({
        type: "object",
        additionalProperties: false,
        properties: {
          timelinePointId: {
            type: "string",
            description:
              '要检查的锚点 ID 或名称。省略时使用当前锚点；若当前是 "origin" 则无法比较（原点之前没有锚点）。',
          },
        },
      }),
      execute: ({ timelinePointId }) =>
        withProjectWorkspace({
          projectId,
          execute: async (workspace) => {
            const resolvedPointId =
              timelinePointId === undefined
                ? resolveCurrentTimelinePointId(runtimeContext)
                : await resolveTimelinePointIdOrLabel({
                    projectId: workspace.projectId,
                    workspaceId: workspace.id,
                    timelinePointIdOrLabel: timelinePointId,
                  });
            invariant(
              resolvedPointId !== ORIGIN_TIMELINE_POINT_ID,
              "原点没有前一个时间线，无法枚举辅助信息变更。",
            );

            const timelinePoints = await listTimelinePoints(workspace.projectId, workspace.id);
            const point = timelinePoints.find((item) => item.id === resolvedPointId);
            invariant(point, "指定的时间点不存在。");
            invariant(point.prevPointId, "原点没有前一个时间线，无法枚举辅助信息变更。");

            const changes = await listAuxTimelineChangesAt(
              workspace.projectId,
              workspace.id,
              resolvedPointId,
            );
            const limited = limitItems(changes, TIMELINE_AUX_CHANGE_LIMIT);

            return {
              ok: true as const,
              truncated: limited.truncated,
              data: {
                timelinePointId: resolvedPointId,
                timelineLabel: await getTimelineLabelById(
                  workspace.projectId,
                  workspace.id,
                  resolvedPointId,
                ),
                previousTimelinePointId: point.prevPointId,
                previousTimelineLabel: await getTimelineLabelById(
                  workspace.projectId,
                  workspace.id,
                  point.prevPointId,
                ),
                summary: summarizeAuxTimelineChangesAt(
                  workspace.projectId,
                  workspace.id,
                  resolvedPointId,
                ),
                changes: limited.items,
              },
            };
          },
        }),
    }),
    set_current_timeline: tool({
      description:
        '切换当前上下文到指定时间锚点。切换后，辅助资料读写（list_files、read_file、write_file 等）都将基于该时间断面的资料快照——只有在该锚点及之前更新过的设定才对模型可见。传入 "origin" 回到初始设定。',
      inputSchema: jsonSchema<{ timelinePointId: string }>({
        type: "object",
        required: ["timelinePointId"],
        properties: {
          timelinePointId: {
            type: "string",
            description:
              '要切换到的锚点 ID。传入 "origin" 表示切换回全局初始设定原点。也可回退传入锚点名称，但建议优先使用 ID。',
          },
        },
      }),
      execute: ({ timelinePointId }) =>
        withProjectWorkspace({
          projectId,
          execute: async (workspace) => {
            const selected = await resolveSelectableTimelinePoint({
              projectId: workspace.projectId,
              workspaceId: workspace.id,
              timelinePointIdOrLabel: timelinePointId,
            });
            updateRuntimeTimelineSelection({
              runtimeContext,
              timelinePointId: selected.timelinePointId,
              timelineLabel: selected.timelineLabel,
            });
            const warnings =
              selected.matchedBy === "label"
                ? [
                    {
                      code: "timeline_point_label_used_as_fallback" as const,
                      message:
                        "本次根据时间点名称匹配完成切换。为避免重名或后续改名带来的歧义，建议后续优先使用 timelinePointId。",
                      providedValue: timelinePointId,
                      matchedTimelinePointId: selected.timelinePointId,
                      matchedTimelineLabel: selected.timelineLabel,
                    },
                  ]
                : [];

            return {
              ok: true as const,
              truncated: false,
              data: {
                action: "selected" as const,
                timelinePointId: selected.timelinePointId,
                timelineLabel: selected.timelineLabel,
                ...(warnings.length > 0 ? { warnings } : {}),
              },
            };
          },
        }),
    }),
    create_story_timeline_points: tool({
      description:
        "批量创建时间锚点——在故事发展到需要「切换上下文」的关键节点时使用。何时创建新锚点：(1) 大量背景设定发生了不可逆变化；(2) 需要让后续写作基于新的世界状态。无需为每个章节创建锚点，多个章节可共享同一锚点。省略 afterPointId 时追加到末尾。",
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
            description: "要按顺序创建的锚点列表。数组顺序即插入后的时序。",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["label"],
              properties: {
                label: {
                  type: "string",
                  description:
                    "锚点的显示名称，建议用关键事件命名，如「大战前」「战后重建」「新世界」等。",
                },
                description: {
                  type: "string",
                  description:
                    "锚点说明，描述该时刻世界状态发生了什么关键变化，以及为什么需要在此切分上下文。",
                },
              },
            },
          },
          afterPointId: {
            type: "string",
            description:
              '新锚点列表将整体插入到此锚点之后。省略则追加到末尾。传入 "origin" 表示插入到初始设定原点之后（即最前端）。',
          },
        },
      }),
      execute: ({ points, afterPointId }) =>
        withProjectWorkspace({
          projectId,
          execute: async (workspace) => {
            const resolvedAfterPointId = await resolveOptionalTimelinePointIdOrLabel({
              projectId: workspace.projectId,
              workspaceId: workspace.id,
              timelinePointIdOrLabel: afterPointId,
            });
            const createdPoints = await createTimelinePoints({
              projectId: workspace.projectId,
              workspaceId: workspace.id,
              afterPointId: resolvedAfterPointId,
              points: points.map((point) => ({
                label: point.label,
                description: point.description ?? undefined,
              })),
            });

            return {
              ok: true as const,
              truncated: false,
              data: {
                action: "created_batch" as const,
                points: createdPoints.map((point) => ({
                  pointId: point.id,
                  label: point.label,
                })),
              },
            };
          },
        }),
    }),
    update_story_timeline_point: tool({
      description:
        "更新时间锚点的标签或说明。用于调整已有锚点的描述——注意这不会影响已锚定在该点上的辅助资料内容。origin 不可修改。",
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
      execute: ({ pointId, label, description }) =>
        withProjectWorkspace({
          projectId,
          execute: async (workspace) => {
            const point = await updateTimelinePoint({
              projectId: workspace.projectId,
              workspaceId: workspace.id,
              pointId,
              label: label ?? undefined,
              description: description === undefined ? undefined : description || null,
            });

            return {
              ok: true as const,
              truncated: false,
              data: {
                action: "updated" as const,
                pointId: point.id,
                label: point.label,
              },
            };
          },
        }),
    }),
    move_story_timeline_point: tool({
      description:
        "重排时间锚点的顺序。会改变辅助资料的可见性范围——移动锚点位置会影响该断面快照相对「前一个状态」的基准。省略 afterPointId 时移动到末尾。",
      inputSchema: jsonSchema<{
        pointId: string;
        afterPointId?: string;
      }>({
        type: "object",
        required: ["pointId"],
        properties: {
          pointId: {
            type: "string",
            description: "要移动的锚点 ID 或名称。",
          },
          afterPointId: {
            type: "string",
            description:
              '移动后该锚点将排在此锚点之后。可传 ID 或名称。省略则移动到末尾。传入 "origin" 表示移动到初始设定原点之后（即最前端）。',
          },
        },
      }),
      execute: ({ pointId, afterPointId }) =>
        withProjectWorkspace({
          projectId,
          execute: async (workspace) => {
            const resolvedPointId = await resolveTimelinePointIdOrLabel({
              projectId: workspace.projectId,
              workspaceId: workspace.id,
              timelinePointIdOrLabel: pointId,
            });
            invariant(resolvedPointId !== ORIGIN_TIMELINE_POINT_ID, "无法移动原点时间点。");
            const resolvedAfterPointId = await resolveOptionalTimelinePointIdOrLabel({
              projectId: workspace.projectId,
              workspaceId: workspace.id,
              timelinePointIdOrLabel: afterPointId,
            });
            const point = await moveTimelinePoint({
              projectId: workspace.projectId,
              workspaceId: workspace.id,
              pointId: resolvedPointId,
              afterPointId: resolvedAfterPointId,
            });

            return {
              ok: true as const,
              truncated: false,
              data: {
                action: "moved" as const,
                pointId: point.id,
                label: point.label,
              },
            };
          },
        }),
    }),
    delete_story_timeline_point: tool({
      description:
        "删除时间锚点。若该锚点上关联了辅助资料层，需设置 purgeAuxLayers=true 确认一并清除——这会删除该断面上所有参考资料变更。此操作不可逆。",
      inputSchema: jsonSchema<{
        pointId: string;
        purgeAuxLayers?: boolean;
      }>({
        type: "object",
        required: ["pointId"],
        properties: {
          pointId: {
            type: "string",
            description: "要删除的锚点 ID 或名称。不能删除 origin（全局初始设定原点）。",
          },
          purgeAuxLayers: {
            type: "boolean",
            description:
              "是否一并删除该锚点关联的辅助资料层。不设为 true 时，若有关联资料则删除失败。",
          },
        },
      }),
      execute: ({ pointId, purgeAuxLayers }) =>
        withProjectWorkspace({
          projectId,
          execute: async (workspace) => {
            const resolvedPointId = await resolveTimelinePointIdOrLabel({
              projectId: workspace.projectId,
              workspaceId: workspace.id,
              timelinePointIdOrLabel: pointId,
            });
            invariant(resolvedPointId !== ORIGIN_TIMELINE_POINT_ID, "无法删除原点时间点。");
            const label = await getTimelineLabelById(
              workspace.projectId,
              workspace.id,
              resolvedPointId,
            );
            await deleteTimelinePoint(workspace.projectId, workspace.id, resolvedPointId, {
              purgeAuxLayers: purgeAuxLayers ?? undefined,
            });

            return {
              ok: true as const,
              truncated: false,
              data: {
                action: "deleted" as const,
                pointId: resolvedPointId,
                label,
              },
            };
          },
        }),
    }),
  } satisfies Record<TimelineToolName, unknown>;
}
