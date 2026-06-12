import { jsonSchema, tool } from "ai";

import { exportContentSubtree } from "@/modules/workspace/domain";

import type { ToolBuildContext } from "./context";
import { failure, withEnvelope } from "./envelope";
import { limitContentSubtree } from "./limits";
import type { ContentReadToolName } from "./tool-names";
import { getWorkspaceForProject } from "./workspace";

export function buildContentReadTools({ projectId }: ToolBuildContext) {
  return {
    get_manuscript_subtree: tool({
      description:
        "获取正文树中某个节点及其子树。用于分析章节结构、层级和相邻正文内容；省略 rootNodeId 时读取整棵正文树。",
      inputSchema: jsonSchema<{ rootNodeId?: string }>({
        type: "object",
        properties: {
          rootNodeId: {
            type: "string",
            description: "要读取的正文根节点 ID。省略时读取整个正文树根。",
          },
        },
      }),
      execute: async ({ rootNodeId }) => {
        const workspace = getWorkspaceForProject(projectId);
        if (!workspace) {
          return failure(new Error("当前项目没有默认工作区。"));
        }

        return withEnvelope(() =>
          limitContentSubtree(exportContentSubtree(workspace.id, rootNodeId ?? undefined)),
        );
      },
    }),
  } satisfies Record<ContentReadToolName, unknown>;
}
