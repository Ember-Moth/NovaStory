import { jsonSchema, tool } from "ai";

import { listManuscriptNodes, readManuscriptNode } from "@/modules/workspace/domain";

import type { ToolBuildContext } from "./context";
import { resolveActiveContentNodeId } from "./selection";
import type { ContentReadToolName } from "./tool-names";
import { withProjectWorkspace } from "./workspace";

export function buildContentReadTools({ projectId, runtimeContext }: ToolBuildContext) {
  return {
    list_manuscript_nodes: tool({
      description:
        "以树形目录列出正文节点。用于先浏览章节结构、层级和锚定时间点；默认展开 2 层，不返回正文内容。省略 rootNodeId 时读取整棵正文树根。",
      inputSchema: jsonSchema<{ rootNodeId?: string; depth?: number }>({
        type: "object",
        properties: {
          rootNodeId: {
            type: "string",
            description: "要列出的正文根节点 ID。省略时从隐藏正文根列出整棵正文目录。",
          },
          depth: {
            type: "integer",
            minimum: 1,
            description: "递归展开层数，默认 2。depth=1 只列目标根的直接正文节点。",
          },
        },
      }),
      execute: ({ rootNodeId, depth }) =>
        withProjectWorkspace({
          projectId,
          execute: (workspace) => {
            const list = listManuscriptNodes(workspace.projectId, workspace.id, rootNodeId, {
              depth,
            });
            return {
              ok: true as const,
              truncated: list.truncated,
              data: {
                depth: Math.max(1, Math.trunc(depth ?? 2)),
                entries: list.nodes,
              },
            };
          },
        }),
    }),
    read_manuscript_node: tool({
      description:
        "读取单个正文节点的完整标题、正文和直接子节点结构。用于在 list_manuscript_nodes 找到节点后查看具体正文；省略 nodeId 时读取当前选中的正文节点。",
      inputSchema: jsonSchema<{ nodeId?: string }>({
        type: "object",
        properties: {
          nodeId: {
            type: "string",
            description: "正文节点 ID。省略时使用当前选中的正文节点；没有选中节点时会失败。",
          },
        },
      }),
      execute: ({ nodeId }) =>
        withProjectWorkspace({
          projectId,
          execute: (workspace) => {
            const targetNodeId =
              nodeId ?? resolveActiveContentNodeId(runtimeContext.snapshot, null);
            if (!targetNodeId) {
              throw new Error("当前没有可读取的正文节点。");
            }

            return {
              ok: true as const,
              truncated: false,
              data: {
                node: readManuscriptNode(workspace.projectId, workspace.id, targetNodeId),
              },
            };
          },
        }),
    }),
  } satisfies Record<ContentReadToolName, unknown>;
}
