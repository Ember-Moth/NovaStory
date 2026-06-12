import { jsonSchema, tool } from "ai";

import { listAuxTreeAt, readAuxByPathAt } from "@/modules/workspace/domain";

import type { ToolBuildContext } from "./context";
import { failure, withEnvelope } from "./envelope";
import { sanitizeAuxNode } from "./limits";
import { resolveActiveAuxPath } from "./selection";
import { resolveCurrentTimelinePointId } from "./timeline-helpers";
import type { AuxReadToolName } from "./tool-names";
import { getWorkspaceForProject } from "./workspace";

const REFERENCE_OVERLAY_READ_SEMANTICS =
  "参考资料按当前时间点形成叠加视图：原点放置全局初始设定，自定义时间点会继承更早时间点仍可见的目录、文件和链接。若需要改到别的时间点，请先调用 set_current_timeline。";

export function buildAuxReadTools({ projectId, runtimeContext }: ToolBuildContext) {
  return {
    list_files: tool({
      description: `${REFERENCE_OVERLAY_READ_SEMANTICS} 以文件树形式列出当前时间点可见的参考资料目录。默认递归 2 层；可传更大的 depth 查看更深层。符号链接只显示自身，不继续递归。省略 path 时读取参考资料根目录 /。`,
      inputSchema: jsonSchema<{ path?: string; depth?: number }>({
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "参考资料目录绝对路径。省略时读取根目录 /。",
          },
          depth: {
            type: "integer",
            minimum: 1,
            description: "递归展开层数，默认 2。depth=1 只列当前目录直接子项。",
          },
        },
      }),
      execute: async ({ path, depth }) => {
        const workspace = getWorkspaceForProject(projectId);
        if (!workspace) {
          return failure(new Error("当前项目没有默认工作区。"));
        }

        return withEnvelope(() => {
          const resolvedTimelinePointId = resolveCurrentTimelinePointId(runtimeContext);
          const tree = listAuxTreeAt(
            workspace.id,
            resolvedTimelinePointId,
            {
              dirId: path ? undefined : (workspace.auxRootId ?? undefined),
              path: path ?? undefined,
            },
            {
              depth,
            },
          );

          return {
            ok: true,
            truncated: tree.truncated,
            data: {
              path: path ?? "/",
              depth: Math.max(1, Math.trunc(depth ?? 2)),
              entries: tree.nodes,
            },
          };
        });
      },
    }),
    read_file: tool({
      description: `${REFERENCE_OVERLAY_READ_SEMANTICS} 读取当前时间点可见的参考资料节点。用于查看具体设定/素材内容；省略 path 时读取当前选中的参考资料路径。若要浏览目录，优先使用 list_files。`,
      inputSchema: jsonSchema<{ path?: string }>({
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              "参考资料绝对路径。省略时使用当前选中的参考资料路径；没有选中路径时会失败。",
          },
        },
      }),
      execute: async ({ path }) => {
        const workspace = getWorkspaceForProject(projectId);
        if (!workspace) {
          return failure(new Error("当前项目没有默认工作区。"));
        }

        return withEnvelope(() => {
          const resolvedTimelinePointId = resolveCurrentTimelinePointId(runtimeContext);
          const resolvedPath = path ?? resolveActiveAuxPath(runtimeContext.snapshot);
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
