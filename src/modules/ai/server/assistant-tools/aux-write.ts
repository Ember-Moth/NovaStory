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
import { invariant } from "@/shared/lib/domain";

import { resolveAuxNodeByPathOrThrow, resolveParentDirId, splitAuxPath } from "./aux-path";
import type { ToolBuildContext } from "./context";
import { failure, withEnvelope } from "./envelope";
import { resolveCurrentTimelinePointId } from "./timeline-helpers";
import type { AuxWriteToolName } from "./tool-names";
import { getWorkspaceForProject } from "./workspace";

const REFERENCE_OVERLAY_WRITE_SEMANTICS =
  "参考资料写入始终作用于当前时间点，并只在该时间点写入新的覆盖层状态，不会回写更早时间点。若需要切换到其他时间点，请先调用 set_current_timeline。";

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
        const workspace = getWorkspaceForProject(projectId);
        if (!workspace) {
          return failure(new Error("当前项目没有默认工作区。"));
        }

        return withEnvelope(() => {
          const resolvedTimelinePointId = resolveCurrentTimelinePointId(runtimeContext);
          const { normalizedPath, parentPath, name } = splitAuxPath(path, "创建辅助资料目录");
          const existing = readAuxByPathAt(workspace.id, resolvedTimelinePointId, normalizedPath);
          invariant(existing == null, "创建辅助资料目录失败：目标路径已存在。");

          const parentDirId = resolveParentDirId({
            workspaceId: workspace.id,
            timelinePointId: resolvedTimelinePointId,
            auxRootId: workspace.auxRootId,
            parentPath,
            actionLabel: "创建辅助资料目录",
          });
          const node = mkdirAt({
            workspaceId: workspace.id,
            timelinePointId: resolvedTimelinePointId,
            parentDirId,
            name,
          });

          return {
            ok: true,
            truncated: false,
            data: {
              action: "created",
              path: normalizedPath,
              timelinePointId: resolvedTimelinePointId,
              nodeId: node.id,
            },
          };
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
        const workspace = getWorkspaceForProject(projectId);
        if (!workspace) {
          return failure(new Error("当前项目没有默认工作区。"));
        }

        return withEnvelope(() => {
          const resolvedTimelinePointId = resolveCurrentTimelinePointId(runtimeContext);
          const { normalizedPath, parentPath, name } = splitAuxPath(path, "写入辅助资料文件");
          const existing = readAuxByPathAt(workspace.id, resolvedTimelinePointId, normalizedPath);

          if (existing) {
            invariant(existing.nodeType === "file", "写入辅助资料文件失败：目标路径不是文件。");
            const node = writeFileAt({
              workspaceId: workspace.id,
              timelinePointId: resolvedTimelinePointId,
              nodeId: existing.id,
              content,
            });
            return {
              ok: true,
              truncated: false,
              data: {
                action: "updated",
                path: normalizedPath,
                timelinePointId: resolvedTimelinePointId,
                nodeId: node.id,
              },
            };
          }

          const parentDirId = resolveParentDirId({
            workspaceId: workspace.id,
            timelinePointId: resolvedTimelinePointId,
            auxRootId: workspace.auxRootId,
            parentPath,
            actionLabel: "写入辅助资料文件",
          });
          const node = writeFileAt({
            workspaceId: workspace.id,
            timelinePointId: resolvedTimelinePointId,
            parentDirId,
            name,
            content,
          });

          return {
            ok: true,
            truncated: false,
            data: {
              action: "created",
              path: normalizedPath,
              timelinePointId: resolvedTimelinePointId,
              nodeId: node.id,
            },
          };
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
        const workspace = getWorkspaceForProject(projectId);
        if (!workspace) {
          return failure(new Error("当前项目没有默认工作区。"));
        }

        return withEnvelope(() => {
          const resolvedTimelinePointId = resolveCurrentTimelinePointId(runtimeContext);
          const { normalizedPath } = splitAuxPath(path, "移动辅助资料");
          const {
            normalizedPath: normalizedNewPath,
            parentPath: newParentPath,
            name: newName,
          } = splitAuxPath(newPath, "移动辅助资料");
          invariant(
            normalizedPath !== normalizedNewPath,
            "移动辅助资料失败：目标路径不能与原路径相同。",
          );

          const existing = resolveAuxNodeByPathOrThrow({
            workspaceId: workspace.id,
            timelinePointId: resolvedTimelinePointId,
            path: normalizedPath,
            actionLabel: "移动辅助资料",
          });
          const conflicting = readAuxByPathAt(
            workspace.id,
            resolvedTimelinePointId,
            normalizedNewPath,
          );
          invariant(conflicting == null, "移动辅助资料失败：目标路径已存在。");

          const newParentDirId = resolveParentDirId({
            workspaceId: workspace.id,
            timelinePointId: resolvedTimelinePointId,
            auxRootId: workspace.auxRootId,
            parentPath: newParentPath,
            actionLabel: "移动辅助资料",
          });
          const node = moveAuxNodeAt({
            workspaceId: workspace.id,
            timelinePointId: resolvedTimelinePointId,
            nodeId: existing.id,
            newParentDirId,
            newName,
          });

          return {
            ok: true,
            truncated: false,
            data: {
              action: "moved",
              path: normalizedNewPath,
              previousPath: normalizedPath,
              timelinePointId: resolvedTimelinePointId,
              nodeId: node.id,
            },
          };
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
        const workspace = getWorkspaceForProject(projectId);
        if (!workspace) {
          return failure(new Error("当前项目没有默认工作区。"));
        }

        return withEnvelope(() => {
          const resolvedTimelinePointId = resolveCurrentTimelinePointId(runtimeContext);
          const { normalizedPath } = splitAuxPath(path, "删除辅助资料");
          const node = resolveAuxNodeByPathOrThrow({
            workspaceId: workspace.id,
            timelinePointId: resolvedTimelinePointId,
            path: normalizedPath,
            actionLabel: "删除辅助资料",
          });

          deleteAuxNodeAt({
            workspaceId: workspace.id,
            timelinePointId: resolvedTimelinePointId,
            nodeId: node.id,
          });

          return {
            ok: true,
            truncated: false,
            data: {
              action: "deleted" as const,
              path: normalizedPath,
              timelinePointId: resolvedTimelinePointId,
              nodeId: node.id,
            },
          };
        });
      },
    }),
    create_symlink: tool({
      description: `${REFERENCE_OVERLAY_WRITE_SEMANTICS} 在当前时间点创建参考资料符号链接。符号链接适合做会随故事推进变化的指针；目标路径必须在当前时间点可见，可以是从更早时间点继承来的节点。`,
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
            description:
              "链接目标绝对路径，例如 /场景/城堡；目标必须已存在且在目标叠加视图中可见。",
          },
        },
      }),
      execute: async ({ path, targetPath }) => {
        const workspace = getWorkspaceForProject(projectId);
        if (!workspace) {
          return failure(new Error("当前项目没有默认工作区。"));
        }

        return withEnvelope(() => {
          const resolvedTimelinePointId = resolveCurrentTimelinePointId(runtimeContext);
          const { normalizedPath, parentPath, name } = splitAuxPath(path, "创建辅助资料符号链接");
          const { normalizedPath: normalizedTargetPath } = splitAuxPath(
            targetPath,
            "创建辅助资料符号链接",
          );
          const existing = listAuxDirAt(workspace.id, resolvedTimelinePointId, {
            path: parentPath,
          }).find((node) => node.name === name);
          invariant(
            existing == null,
            existing?.nodeType === "symlink"
              ? "创建辅助资料符号链接失败：同路径已存在符号链接。通常你想要的是调用 retarget_symlink 来修改它的目标。"
              : "创建辅助资料符号链接失败：目标路径已存在。",
          );

          const targetNode = resolveAuxNodeByPathOrThrow({
            workspaceId: workspace.id,
            timelinePointId: resolvedTimelinePointId,
            path: normalizedTargetPath,
            actionLabel: "创建辅助资料符号链接",
          });
          const parentDirId = resolveParentDirId({
            workspaceId: workspace.id,
            timelinePointId: resolvedTimelinePointId,
            auxRootId: workspace.auxRootId,
            parentPath,
            actionLabel: "创建辅助资料符号链接",
          });
          const node = linkAt({
            workspaceId: workspace.id,
            timelinePointId: resolvedTimelinePointId,
            parentDirId,
            name,
            targetNodeId: targetNode.id,
          });

          return {
            ok: true,
            truncated: false,
            data: {
              action: "created",
              path: normalizedPath,
              targetPath: normalizedTargetPath,
              timelinePointId: resolvedTimelinePointId,
              nodeId: node.id,
            },
          };
        });
      },
    }),
    retarget_symlink: tool({
      description: `${REFERENCE_OVERLAY_WRITE_SEMANTICS} 在当前时间点修改参考资料符号链接的目标路径。链接自身路径不变，只在当前时间点改变指向；早期时间点仍看到旧指向。新目标必须在当前时间点可见。`,
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
            description:
              "新的目标绝对路径，例如 /场景/森林；目标必须已存在且在目标叠加视图中可见。",
          },
        },
      }),
      execute: async ({ path, newTargetPath }) => {
        const workspace = getWorkspaceForProject(projectId);
        if (!workspace) {
          return failure(new Error("当前项目没有默认工作区。"));
        }

        return withEnvelope(() => {
          const resolvedTimelinePointId = resolveCurrentTimelinePointId(runtimeContext);
          const { normalizedPath } = splitAuxPath(path, "重定向辅助资料符号链接");
          const { normalizedPath: normalizedNewTargetPath } = splitAuxPath(
            newTargetPath,
            "重定向辅助资料符号链接",
          );

          const symlinkNode = resolveAuxNodeByPathOrThrow({
            workspaceId: workspace.id,
            timelinePointId: resolvedTimelinePointId,
            path: normalizedPath,
            actionLabel: "重定向辅助资料符号链接",
          });
          invariant(
            symlinkNode.nodeType === "symlink",
            "重定向辅助资料符号链接失败：指定路径不是符号链接。",
          );

          const targetNode = resolveAuxNodeByPathOrThrow({
            workspaceId: workspace.id,
            timelinePointId: resolvedTimelinePointId,
            path: normalizedNewTargetPath,
            actionLabel: "重定向辅助资料符号链接",
          });

          const node = retargetAuxSymlinkAt({
            workspaceId: workspace.id,
            timelinePointId: resolvedTimelinePointId,
            symlinkNodeId: symlinkNode.id,
            targetNodeId: targetNode.id,
          });

          return {
            ok: true,
            truncated: false,
            data: {
              action: "retargeted" as const,
              path: normalizedPath,
              newTargetPath: normalizedNewTargetPath,
              timelinePointId: resolvedTimelinePointId,
              nodeId: node.id,
            },
          };
        });
      },
    }),
  } satisfies Record<AuxWriteToolName, unknown>;
}
