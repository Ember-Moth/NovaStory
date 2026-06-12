import { tool } from "ai";

import { listAuxDirAt, readAuxByPathAt } from "@/modules/workspace/domain";

import type { ToolBuildContext, AuxReadToolName } from "./_shared";
import {
  AUX_DIR_ENTRY_LIMIT,
  failure,
  getWorkspaceForProject,
  jsonSchema,
  limitAuxNodes,
  resolveActiveAuxPath,
  resolveTimelinePointIdFromInput,
  sanitizeAuxNode,
  withEnvelope,
} from "./_shared";

const REFERENCE_OVERLAY_READ_SEMANTICS =
  "参考资料是按时间点叠加的 overlayfs 式视图：读取某个 overlayTimelinePointId 时，会看到该时间点自己的覆盖层，并自动继承更早时间点仍可见的目录、文件和链接；较新时间点的改动不会改变较早时间点的状态。";

const OVERLAY_TIMELINE_POINT_READ_DESCRIPTION =
  '要读取的参考资料叠加视图时间点 ID。省略时使用当前选中的时间点；传入 "origin" 表示原点时间点。';

export function buildAuxReadTools({ projectId, context }: ToolBuildContext) {
  return {
    list_reference_overlay_dir: tool({
      description: `${REFERENCE_OVERLAY_READ_SEMANTICS} 列出某个叠加视图中可见的参考资料目录。用于先查看有哪些设定/素材文件；省略 path 时读取参考资料根目录 /。`,
      inputSchema: jsonSchema<{ path?: string; overlayTimelinePointId?: string }>({
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "参考资料目录绝对路径。省略时读取根目录 /。",
          },
          overlayTimelinePointId: {
            type: "string",
            description: OVERLAY_TIMELINE_POINT_READ_DESCRIPTION,
          },
        },
      }),
      execute: async ({ path, overlayTimelinePointId }) => {
        const workspace = getWorkspaceForProject(projectId);
        if (!workspace) {
          return failure(new Error("当前项目没有默认工作区。"));
        }

        return withEnvelope(() => {
          const resolvedTimelinePointId = resolveTimelinePointIdFromInput(
            workspace.id,
            context,
            overlayTimelinePointId,
          );
          const dirNodes = listAuxDirAt(workspace.id, resolvedTimelinePointId, {
            dirId: path ? undefined : (workspace.auxRootId ?? undefined),
            path: path ?? undefined,
          });
          const limited = limitAuxNodes(dirNodes, AUX_DIR_ENTRY_LIMIT);

          return {
            ok: true,
            truncated: limited.truncated,
            data: {
              path: path ?? "/",
              entries: limited.nodes.map((node) => ({
                id: node.id,
                nodeType: node.nodeType,
                name: node.name,
                path: node.path,
                parentAuxNodeId: node.parentAuxNodeId,
                timelinePointId: node.timelinePointId,
              })),
            },
          };
        });
      },
    }),
    read_reference_overlay_path: tool({
      description: `${REFERENCE_OVERLAY_READ_SEMANTICS} 读取某个叠加视图中可见的参考资料节点。用于查看具体设定/素材内容；省略 path 时读取当前选中的参考资料路径。`,
      inputSchema: jsonSchema<{ path?: string; overlayTimelinePointId?: string }>({
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              "参考资料绝对路径。省略时使用当前选中的参考资料路径；没有选中路径时会失败。",
          },
          overlayTimelinePointId: {
            type: "string",
            description: OVERLAY_TIMELINE_POINT_READ_DESCRIPTION,
          },
        },
      }),
      execute: async ({ path, overlayTimelinePointId }) => {
        const workspace = getWorkspaceForProject(projectId);
        if (!workspace) {
          return failure(new Error("当前项目没有默认工作区。"));
        }

        return withEnvelope(() => {
          const resolvedTimelinePointId = resolveTimelinePointIdFromInput(
            workspace.id,
            context,
            overlayTimelinePointId,
          );
          const resolvedPath = path ?? resolveActiveAuxPath(context);
          if (!resolvedPath) {
            throw new Error("当前没有可读取的辅助资料路径。");
          }

          const node = readAuxByPathAt(workspace.id, resolvedTimelinePointId, resolvedPath);
          if (!node) {
            throw new Error("辅助资料不存在或在当前时间点不可见。");
          }

          const sanitized = sanitizeAuxNode(node);

          return {
            ok: true,
            truncated: sanitized.truncated,
            data: {
              path: resolvedPath,
              node: sanitized.node,
            },
          };
        });
      },
    }),
  } satisfies Record<AuxReadToolName, unknown>;
}
