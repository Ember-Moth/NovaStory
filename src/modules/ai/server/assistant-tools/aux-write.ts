import { jsonSchema, tool } from "ai";

import {
  deleteAuxNodeAt,
  linkAt,
  listAuxDirAt,
  mkdirAt,
  moveAuxNodeAt,
  readAuxByPathAt,
  retargetAuxSymlinkAt,
  writeFileAt,
} from "@/modules/workspace/domain";
import type { ResolvedAuxNode } from "@/modules/workspace/domain";
import { invariant } from "@/shared/lib/domain";

import { assertParentDirPath, resolveAuxNodeByPathOrThrow, splitAuxPath } from "./aux-path";
import type { ToolBuildContext } from "./context";
import type { AssistantToolErrorContext } from "./envelope";
import { resolveCurrentTimelinePointId } from "./timeline-helpers";
import type { AuxWriteToolName } from "./tool-names";
import { withProjectWorkspace } from "./workspace";

const REFERENCE_OVERLAY_WRITE_SEMANTICS =
  "参考资料写入始终作用于当前时间点，并只在该时间点写入新的覆盖层状态，不会回写更早时间点。若需要切换到其他时间点，请先调用 set_current_timeline。";

type AuxWriteErrorContext = AssistantToolErrorContext & {
  tool: AuxWriteToolName;
};

function summarizeAuxNode(node: Partial<ResolvedAuxNode> | null | undefined) {
  if (!node) {
    return null;
  }

  return {
    nodeType: node.nodeType,
    path: node.path,
    name: node.name,
    timelinePointId: node.timelinePointId,
    symlinkTargetPath: node.symlinkTargetPath,
  };
}

function createAuxWriteErrorContext(toolName: AuxWriteToolName, input: AssistantToolErrorContext) {
  const context: AuxWriteErrorContext = {
    tool: toolName,
    input,
  };
  return {
    set(values: AssistantToolErrorContext) {
      Object.assign(context, values);
    },
    get() {
      return context;
    },
  };
}

export function buildAuxWriteTools({ projectId, runtimeContext }: ToolBuildContext) {
  return {
    create_dir: tool({
      description: `${REFERENCE_OVERLAY_WRITE_SEMANTICS} 在当前时间点创建参考资料目录；只创建目标路径的最后一级目录，父目录必须已存在。`,
      inputSchema: jsonSchema<{ path: string }>({
        type: "object",
        required: ["path"],
        properties: {
          path: {
            type: "string",
            description: "要创建的参考资料目录绝对路径，例如 /角色。",
          },
        },
      }),
      execute: async ({ path }) => {
        const errorContext = createAuxWriteErrorContext("create_dir", { path });
        return withProjectWorkspace({
          projectId,
          getContext: errorContext.get,
          execute: async (workspace) => {
            errorContext.set({ workspaceId: workspace.id });
            const resolvedTimelinePointId = resolveCurrentTimelinePointId(runtimeContext);
            const { normalizedPath, parentPath, name } = splitAuxPath(path, "创建辅助资料目录");
            errorContext.set({
              timelinePointId: resolvedTimelinePointId,
              normalizedPath,
              parentPath,
              name,
            });
            const existing = await readAuxByPathAt(
              workspace.projectId,
              workspace.id,
              resolvedTimelinePointId,
              normalizedPath,
            );
            errorContext.set({ existingNode: summarizeAuxNode(existing) });
            invariant(existing == null, "创建辅助资料目录失败：目标路径已存在。");

            assertParentDirPath({
              projectId: workspace.projectId,
              workspaceId: workspace.id,
              timelinePointId: resolvedTimelinePointId,
              parentPath,
              actionLabel: "创建辅助资料目录",
            });
            const node = await mkdirAt({
              projectId: workspace.projectId,
              workspaceId: workspace.id,
              timelinePointId: resolvedTimelinePointId,
              path: normalizedPath,
            });

            return {
              ok: true as const,
              truncated: false,
              data: {
                action: "created",
                path: node.path,
                timelinePointId: resolvedTimelinePointId,
              },
            };
          },
        });
      },
    }),
    write_file: tool({
      description: `${REFERENCE_OVERLAY_WRITE_SEMANTICS} 在当前时间点创建或覆盖参考资料文件；如果路径继承自更早时间点，本次写入会在当前时间点产生新文件层，而不是修改早期文件层。若文件已存在会整文件覆盖；仅在用户明确要求写入素材/设定时使用。`,
      inputSchema: jsonSchema<{ path: string; content: string }>({
        type: "object",
        required: ["path", "content"],
        properties: {
          path: {
            type: "string",
            description: "要写入的参考资料文件绝对路径，例如 /角色/主角.md。",
          },
          content: {
            type: "string",
            description: "要写入文件的完整内容；会替换目标文件原有内容。",
          },
        },
      }),
      execute: async ({ path, content }) => {
        const errorContext = createAuxWriteErrorContext("write_file", {
          path,
          contentLength: content.length,
        });
        return withProjectWorkspace({
          projectId,
          getContext: errorContext.get,
          execute: async (workspace) => {
            errorContext.set({ workspaceId: workspace.id });
            const resolvedTimelinePointId = resolveCurrentTimelinePointId(runtimeContext);
            const { normalizedPath, parentPath, name } = splitAuxPath(path, "写入辅助资料文件");
            errorContext.set({
              timelinePointId: resolvedTimelinePointId,
              normalizedPath,
              parentPath,
              name,
            });
            const existing = await readAuxByPathAt(
              workspace.projectId,
              workspace.id,
              resolvedTimelinePointId,
              normalizedPath,
            );
            errorContext.set({ existingNode: summarizeAuxNode(existing) });

            if (existing) {
              invariant(existing.nodeType === "file", "写入辅助资料文件失败：目标路径不是文件。");
              const node = await writeFileAt({
                projectId: workspace.projectId,
                workspaceId: workspace.id,
                timelinePointId: resolvedTimelinePointId,
                path: existing.path,
                content,
              });
              return {
                ok: true as const,
                truncated: false,
                data: {
                  action: "updated",
                  path: node.path,
                  timelinePointId: resolvedTimelinePointId,
                },
              };
            }

            assertParentDirPath({
              projectId: workspace.projectId,
              workspaceId: workspace.id,
              timelinePointId: resolvedTimelinePointId,
              parentPath,
              actionLabel: "写入辅助资料文件",
            });
            const node = await writeFileAt({
              projectId: workspace.projectId,
              workspaceId: workspace.id,
              timelinePointId: resolvedTimelinePointId,
              path: normalizedPath,
              content,
            });

            return {
              ok: true as const,
              truncated: false,
              data: {
                action: "created",
                path: node.path,
                timelinePointId: resolvedTimelinePointId,
              },
            };
          },
        });
      },
    }),
    move_path: tool({
      description: `${REFERENCE_OVERLAY_WRITE_SEMANTICS} 在当前时间点移动或重命名参考资料节点；如果节点继承自更早时间点，本次移动只在当前时间点产生路径覆盖，早期时间点仍保留原路径。支持文件、目录和链接；不能移动根目录。`,
      inputSchema: jsonSchema<{
        path: string;
        newPath: string;
      }>({
        type: "object",
        required: ["path", "newPath"],
        properties: {
          path: {
            type: "string",
            description: "要移动的参考资料绝对路径，例如 /角色.md。",
          },
          newPath: {
            type: "string",
            description: "移动后的目标绝对路径，例如 /资料库/人物/主角.md；目标路径不能已存在。",
          },
        },
      }),
      execute: async ({ path, newPath }) => {
        const errorContext = createAuxWriteErrorContext("move_path", { path, newPath });
        return withProjectWorkspace({
          projectId,
          getContext: errorContext.get,
          execute: async (workspace) => {
            errorContext.set({ workspaceId: workspace.id });
            const resolvedTimelinePointId = resolveCurrentTimelinePointId(runtimeContext);
            const { normalizedPath } = splitAuxPath(path, "移动辅助资料");
            const {
              normalizedPath: normalizedNewPath,
              parentPath: newParentPath,
              name: newName,
            } = splitAuxPath(newPath, "移动辅助资料");
            errorContext.set({
              timelinePointId: resolvedTimelinePointId,
              normalizedPath,
              normalizedNewPath,
              newParentPath,
              newName,
            });
            invariant(
              normalizedPath !== normalizedNewPath,
              "移动辅助资料失败：目标路径不能与原路径相同。",
            );

            const existing = await resolveAuxNodeByPathOrThrow({
              projectId: workspace.projectId,
              workspaceId: workspace.id,
              timelinePointId: resolvedTimelinePointId,
              path: normalizedPath,
              actionLabel: "移动辅助资料",
            });
            errorContext.set({ sourceNode: summarizeAuxNode(existing) });
            const conflicting = await readAuxByPathAt(
              workspace.projectId,
              workspace.id,
              resolvedTimelinePointId,
              normalizedNewPath,
            );
            errorContext.set({ conflictingNode: summarizeAuxNode(conflicting) });
            invariant(conflicting == null, "移动辅助资料失败：目标路径已存在。");

            assertParentDirPath({
              projectId: workspace.projectId,
              workspaceId: workspace.id,
              timelinePointId: resolvedTimelinePointId,
              parentPath: newParentPath,
              actionLabel: "移动辅助资料",
            });
            const node = await moveAuxNodeAt({
              projectId: workspace.projectId,
              workspaceId: workspace.id,
              timelinePointId: resolvedTimelinePointId,
              path: existing.path,
              newPath: normalizedNewPath,
            });

            return {
              ok: true as const,
              truncated: false,
              data: {
                action: "moved",
                path: node.path,
                previousPath: normalizedPath,
                timelinePointId: resolvedTimelinePointId,
              },
            };
          },
        });
      },
    }),
    delete_path: tool({
      description: `${REFERENCE_OVERLAY_WRITE_SEMANTICS} 在当前时间点删除参考资料节点；如果节点继承自更早时间点，本次删除只在当前时间点写入删除遮罩，早期时间点仍可读取原节点。若是目录会连同当前时间点中可见的所有子项一起隐藏；仅在用户明确要求删除时使用。`,
      inputSchema: jsonSchema<{ path: string }>({
        type: "object",
        required: ["path"],
        properties: {
          path: {
            type: "string",
            description: "要删除的参考资料绝对路径，例如 /旧角色.md。",
          },
        },
      }),
      execute: async ({ path }) => {
        const errorContext = createAuxWriteErrorContext("delete_path", { path });
        return withProjectWorkspace({
          projectId,
          getContext: errorContext.get,
          execute: async (workspace) => {
            errorContext.set({ workspaceId: workspace.id });
            const resolvedTimelinePointId = resolveCurrentTimelinePointId(runtimeContext);
            const { normalizedPath } = splitAuxPath(path, "删除辅助资料");
            errorContext.set({ timelinePointId: resolvedTimelinePointId, normalizedPath });
            const node = await resolveAuxNodeByPathOrThrow({
              projectId: workspace.projectId,
              workspaceId: workspace.id,
              timelinePointId: resolvedTimelinePointId,
              path: normalizedPath,
              actionLabel: "删除辅助资料",
            });
            errorContext.set({ targetNode: summarizeAuxNode(node) });

            await deleteAuxNodeAt({
              projectId: workspace.projectId,
              workspaceId: workspace.id,
              timelinePointId: resolvedTimelinePointId,
              path: node.path,
            });

            return {
              ok: true as const,
              truncated: false,
              data: {
                action: "deleted" as const,
                path: normalizedPath,
                timelinePointId: resolvedTimelinePointId,
              },
            };
          },
        });
      },
    }),
    create_symlink: tool({
      description: `${REFERENCE_OVERLAY_WRITE_SEMANTICS} 在当前时间点创建参考资料符号链接。符号链接适合做会随故事推进变化的指针；目标路径只需是参考资料逻辑绝对路径，可以暂时不可见。`,
      inputSchema: jsonSchema<{
        path: string;
        targetPath: string;
      }>({
        type: "object",
        required: ["path", "targetPath"],
        properties: {
          path: {
            type: "string",
            description: "要创建的链接绝对路径，例如 /当前主要场景（在不同时间点可指向不同目标）。",
          },
          targetPath: {
            type: "string",
            description: "链接目标绝对路径，例如 /场景/城堡；目标可以暂时不可见。",
          },
        },
      }),
      execute: async ({ path, targetPath }) => {
        const errorContext = createAuxWriteErrorContext("create_symlink", { path, targetPath });
        return withProjectWorkspace({
          projectId,
          getContext: errorContext.get,
          execute: async (workspace) => {
            errorContext.set({ workspaceId: workspace.id });
            const resolvedTimelinePointId = resolveCurrentTimelinePointId(runtimeContext);
            const { normalizedPath, parentPath, name } = splitAuxPath(path, "创建辅助资料符号链接");
            const { normalizedPath: normalizedTargetPath } = splitAuxPath(
              targetPath,
              "创建辅助资料符号链接",
            );
            errorContext.set({
              timelinePointId: resolvedTimelinePointId,
              normalizedPath,
              parentPath,
              name,
              normalizedTargetPath,
            });
            const dirEntries = await listAuxDirAt(
              workspace.projectId,
              workspace.id,
              resolvedTimelinePointId,
              {
                path: parentPath,
              },
            );
            const existing = dirEntries.find((node) => node.name === name);
            errorContext.set({ existingNode: summarizeAuxNode(existing) });
            invariant(
              existing == null,
              existing?.nodeType === "symlink"
                ? "创建辅助资料符号链接失败：同路径已存在符号链接。通常你想要的是调用 retarget_symlink 来修改它的目标。"
                : "创建辅助资料符号链接失败：目标路径已存在。",
            );

            assertParentDirPath({
              projectId: workspace.projectId,
              workspaceId: workspace.id,
              timelinePointId: resolvedTimelinePointId,
              parentPath,
              actionLabel: "创建辅助资料符号链接",
            });
            await linkAt({
              projectId: workspace.projectId,
              workspaceId: workspace.id,
              timelinePointId: resolvedTimelinePointId,
              path: normalizedPath,
              targetPath: normalizedTargetPath,
            });

            return {
              ok: true as const,
              truncated: false,
              data: {
                action: "created",
                path: normalizedPath,
                targetPath: normalizedTargetPath,
                timelinePointId: resolvedTimelinePointId,
              },
            };
          },
        });
      },
    }),
    retarget_symlink: tool({
      description: `${REFERENCE_OVERLAY_WRITE_SEMANTICS} 在当前时间点修改参考资料符号链接的目标路径。链接自身路径不变，只在当前时间点改变指向；早期时间点仍看到旧指向。新目标只需是参考资料逻辑绝对路径，可以暂时不可见。`,
      inputSchema: jsonSchema<{
        path: string;
        newTargetPath: string;
      }>({
        type: "object",
        required: ["path", "newTargetPath"],
        properties: {
          path: {
            type: "string",
            description: "要重定向的链接绝对路径，例如 /当前主要场景（同一路径指向新目标）。",
          },
          newTargetPath: {
            type: "string",
            description: "新的目标绝对路径，例如 /场景/森林；目标可以暂时不可见。",
          },
        },
      }),
      execute: async ({ path, newTargetPath }) => {
        const errorContext = createAuxWriteErrorContext("retarget_symlink", {
          path,
          newTargetPath,
        });
        return withProjectWorkspace({
          projectId,
          getContext: errorContext.get,
          execute: async (workspace) => {
            errorContext.set({ workspaceId: workspace.id });
            const resolvedTimelinePointId = resolveCurrentTimelinePointId(runtimeContext);
            const { normalizedPath } = splitAuxPath(path, "重定向辅助资料符号链接");
            const { normalizedPath: normalizedNewTargetPath } = splitAuxPath(
              newTargetPath,
              "重定向辅助资料符号链接",
            );
            errorContext.set({
              timelinePointId: resolvedTimelinePointId,
              normalizedPath,
              normalizedNewTargetPath,
              followSymlinksForPath: false,
            });

            const symlinkNode = await resolveAuxNodeByPathOrThrow({
              projectId: workspace.projectId,
              workspaceId: workspace.id,
              timelinePointId: resolvedTimelinePointId,
              path: normalizedPath,
              actionLabel: "重定向辅助资料符号链接",
              followSymlinks: false,
            });
            errorContext.set({ resolvedPathNode: summarizeAuxNode(symlinkNode) });
            invariant(
              symlinkNode.nodeType === "symlink",
              "重定向辅助资料符号链接失败：指定路径不是符号链接。",
            );

            await retargetAuxSymlinkAt({
              projectId: workspace.projectId,
              workspaceId: workspace.id,
              timelinePointId: resolvedTimelinePointId,
              path: symlinkNode.path,
              targetPath: normalizedNewTargetPath,
            });

            return {
              ok: true as const,
              truncated: false,
              data: {
                action: "retargeted" as const,
                path: normalizedPath,
                newTargetPath: normalizedNewTargetPath,
                timelinePointId: resolvedTimelinePointId,
              },
            };
          },
        });
      },
    }),
  } satisfies Record<AuxWriteToolName, unknown>;
}
