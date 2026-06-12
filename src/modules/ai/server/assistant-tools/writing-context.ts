import { jsonSchema, tool } from "ai";

import { composeWritingContext } from "@/modules/workspace/domain";
import type { WritingContext } from "@/modules/workspace/domain/types";

import type { ToolBuildContext } from "./context";
import { failure, withEnvelope } from "./envelope";
import type { AssistantToolSuccess } from "./envelope";
import {
  CONTENT_SUBTREE_NODE_LIMIT,
  WRITING_CONTEXT_AUX_LIMIT,
  limitAuxNodes,
  limitContentNode,
} from "./limits";
import { resolveActiveContentNodeId } from "./selection";
import type { WritingContextToolName } from "./tool-names";
import { getWorkspaceForProject } from "./workspace";

export function buildWritingContextTools({ projectId, runtimeContext }: ToolBuildContext) {
  return {
    get_writing_context: tool({
      description:
        "获取指定正文节点的写作上下文。用于回答或续写前先了解当前章节、锚定时间点和该时间点可见的参考资料；省略 contentNodeId 时读取当前选中正文节点。",
      inputSchema: jsonSchema<{ contentNodeId?: string }>({
        type: "object",
        properties: {
          contentNodeId: {
            type: "string",
            description: "正文节点 ID。省略时使用当前选中的正文节点；没有选中节点时会失败。",
          },
        },
      }),
      execute: async ({ contentNodeId }) => {
        const workspace = getWorkspaceForProject(projectId);
        if (!workspace) {
          return failure(new Error("当前项目没有默认工作区。"));
        }

        return withEnvelope(() => {
          const targetContentNodeId =
            contentNodeId ??
            resolveActiveContentNodeId(runtimeContext.snapshot, workspace.contentRootId);
          if (!targetContentNodeId) {
            throw new Error("当前没有可读取的正文节点。");
          }

          const writingContext = composeWritingContext(workspace.id, targetContentNodeId);
          const contentState = {
            remaining: CONTENT_SUBTREE_NODE_LIMIT,
            truncated: false,
          };
          const contentNode = limitContentNode(writingContext.contentNode, contentState);
          if (!contentNode) {
            throw new Error("当前正文节点没有可读取内容。");
          }
          const auxSnapshot = limitAuxNodes(writingContext.auxSnapshot, WRITING_CONTEXT_AUX_LIMIT);

          return {
            ok: true,
            truncated: contentState.truncated || auxSnapshot.truncated,
            data: {
              contentNode,
              timelinePointId: writingContext.timelinePointId,
              auxSnapshot: auxSnapshot.nodes,
            },
          } satisfies AssistantToolSuccess<WritingContext>;
        });
      },
    }),
  } satisfies Record<WritingContextToolName, unknown>;
}
