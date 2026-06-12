import { tool } from "ai";

import {
  deleteAuxNodeAt,
  linkAt,
  mkdirAt,
  moveAuxNodeAt,
  readAuxByPathAt,
  retargetAuxSymlinkAt,
  writeFileAt,
} from "@/modules/workspace/domain";

import type { ToolBuildContext, AuxWriteToolName } from "./_shared";
import {
  failure,
  getWorkspaceForProject,
  jsonSchema,
  resolveAuxNodeByPathOrThrow,
  resolveParentDirId,
  resolveTimelinePointIdFromInput,
  splitAuxPath,
  withEnvelope,
} from "./_shared";
import { invariant } from "@/shared/lib/domain";

export function buildAuxWriteTools({ projectId, context }: ToolBuildContext) {
  return {
    create_reference_dir: tool({
      description:
        "在指定时间点创建参考资料目录。只创建目标路径的最后一级目录，父目录必须已存在；省略 timelinePointId 时使用当前选中的时间点。",
      inputSchema: jsonSchema<{ path: string; timelinePointId?: string }>({
        type: "object",
        required: ["path"],
        properties: {
          path: {
            type: "string",
            description: "要创建的参考资料目录绝对路径，例如 /设定/角色。",
          },
          timelinePointId: {
            type: "string",
            description:
              '目标时间点 ID。省略时使用当前选中的时间点；传入 "origin" 表示原点时间点。',
          },
        },
      }),
      execute: async ({ path, timelinePointId }) => {
        const workspace = getWorkspaceForProject(projectId);
        if (!workspace) {
          return failure(new Error("当前项目没有默认工作区。"));
        }

        return withEnvelope(() => {
          const resolvedTimelinePointId = resolveTimelinePointIdFromInput(
            workspace.id,
            context,
            timelinePointId,
          );
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
              nodeId: node.id,
            },
          };
        });
      },
    }),
    write_reference_file: tool({
      description:
        "在指定时间点创建或覆盖参考资料文件。若文件已存在会整文件覆盖；仅在用户明确要求写入素材/设定时使用；省略 timelinePointId 时使用当前选中的时间点。",
      inputSchema: jsonSchema<{ path: string; content: string; timelinePointId?: string }>({
        type: "object",
        required: ["path", "content"],
        properties: {
          path: {
            type: "string",
            description: "要写入的参考资料文件绝对路径，例如 /设定/角色/主角.md。",
          },
          content: {
            type: "string",
            description: "要写入文件的完整内容；会替换目标文件原有内容。",
          },
          timelinePointId: {
            type: "string",
            description:
              '目标时间点 ID。省略时使用当前选中的时间点；传入 "origin" 表示原点时间点。',
          },
        },
      }),
      execute: async ({ path, content, timelinePointId }) => {
        const workspace = getWorkspaceForProject(projectId);
        if (!workspace) {
          return failure(new Error("当前项目没有默认工作区。"));
        }

        return withEnvelope(() => {
          const resolvedTimelinePointId = resolveTimelinePointIdFromInput(
            workspace.id,
            context,
            timelinePointId,
          );
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
              nodeId: node.id,
            },
          };
        });
      },
    }),
    move_reference_node: tool({
      description:
        "在指定时间点移动或重命名参考资料节点。支持文件、目录和链接；会改变路径，不能移动根目录；省略 timelinePointId 时使用当前选中的时间点。",
      inputSchema: jsonSchema<{ path: string; newPath: string; timelinePointId?: string }>({
        type: "object",
        required: ["path", "newPath"],
        properties: {
          path: {
            type: "string",
            description: "要移动的参考资料绝对路径，例如 /设定/角色.md。",
          },
          newPath: {
            type: "string",
            description: "移动后的目标绝对路径，例如 /资料库/人物/主角.md；目标路径不能已存在。",
          },
          timelinePointId: {
            type: "string",
            description:
              '目标时间点 ID。省略时使用当前选中的时间点；传入 "origin" 表示原点时间点。',
          },
        },
      }),
      execute: async ({ path, newPath, timelinePointId }) => {
        const workspace = getWorkspaceForProject(projectId);
        if (!workspace) {
          return failure(new Error("当前项目没有默认工作区。"));
        }

        return withEnvelope(() => {
          const resolvedTimelinePointId = resolveTimelinePointIdFromInput(
            workspace.id,
            context,
            timelinePointId,
          );
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
              nodeId: node.id,
            },
          };
        });
      },
    }),
    delete_reference_node: tool({
      description:
        "删除指定时间点的参考资料节点。若是目录会连同所有子项一起删除；此操作不可逆，仅在用户明确要求删除时使用；省略 timelinePointId 时使用当前选中的时间点。",
      inputSchema: jsonSchema<{ path: string; timelinePointId?: string }>({
        type: "object",
        required: ["path"],
        properties: {
          path: {
            type: "string",
            description: "要删除的参考资料绝对路径，例如 /设定/旧角色.md。",
          },
          timelinePointId: {
            type: "string",
            description:
              '目标时间点 ID。省略时使用当前选中的时间点；传入 "origin" 表示原点时间点。',
          },
        },
      }),
      execute: async ({ path, timelinePointId }) => {
        const workspace = getWorkspaceForProject(projectId);
        if (!workspace) {
          return failure(new Error("当前项目没有默认工作区。"));
        }

        return withEnvelope(() => {
          const resolvedTimelinePointId = resolveTimelinePointIdFromInput(
            workspace.id,
            context,
            timelinePointId,
          );
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
              nodeId: node.id,
            },
          };
        });
      },
    }),
    create_reference_link: tool({
      description:
        "在指定时间点创建参考资料链接。链接本身写入到指定路径，目标路径必须在指定时间点可见；省略 timelinePointId 时使用当前选中的时间点。",
      inputSchema: jsonSchema<{ path: string; targetPath: string; timelinePointId?: string }>({
        type: "object",
        required: ["path", "targetPath"],
        properties: {
          path: {
            type: "string",
            description: "要创建的链接绝对路径，例如 /索引/角色.md。",
          },
          targetPath: {
            type: "string",
            description:
              "链接目标绝对路径，例如 /设定/角色/主角.md；目标必须已存在且在指定时间点可见。",
          },
          timelinePointId: {
            type: "string",
            description:
              '目标时间点 ID。省略时使用当前选中的时间点；传入 "origin" 表示原点时间点。',
          },
        },
      }),
      execute: async ({ path, targetPath, timelinePointId }) => {
        const workspace = getWorkspaceForProject(projectId);
        if (!workspace) {
          return failure(new Error("当前项目没有默认工作区。"));
        }

        return withEnvelope(() => {
          const resolvedTimelinePointId = resolveTimelinePointIdFromInput(
            workspace.id,
            context,
            timelinePointId,
          );
          const { normalizedPath, parentPath, name } = splitAuxPath(path, "创建辅助资料符号链接");
          const { normalizedPath: normalizedTargetPath } = splitAuxPath(
            targetPath,
            "创建辅助资料符号链接",
          );
          const existing = readAuxByPathAt(workspace.id, resolvedTimelinePointId, normalizedPath);
          invariant(existing == null, "创建辅助资料符号链接失败：目标路径已存在。");

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
              nodeId: node.id,
            },
          };
        });
      },
    }),
    retarget_reference_link: tool({
      description:
        "修改参考资料链接的目标路径。链接自身路径不变，只改变指向；新目标必须在指定时间点可见；省略 timelinePointId 时使用当前选中的时间点。",
      inputSchema: jsonSchema<{ path: string; newTargetPath: string; timelinePointId?: string }>({
        type: "object",
        required: ["path", "newTargetPath"],
        properties: {
          path: {
            type: "string",
            description: "要重定向的链接绝对路径，例如 /索引/角色.md。",
          },
          newTargetPath: {
            type: "string",
            description:
              "新的目标绝对路径，例如 /设定/角色/主角.md；目标必须已存在且在指定时间点可见。",
          },
          timelinePointId: {
            type: "string",
            description:
              '目标时间点 ID。省略时使用当前选中的时间点；传入 "origin" 表示原点时间点。',
          },
        },
      }),
      execute: async ({ path, newTargetPath, timelinePointId }) => {
        const workspace = getWorkspaceForProject(projectId);
        if (!workspace) {
          return failure(new Error("当前项目没有默认工作区。"));
        }

        return withEnvelope(() => {
          const resolvedTimelinePointId = resolveTimelinePointIdFromInput(
            workspace.id,
            context,
            timelinePointId,
          );
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
              nodeId: node.id,
            },
          };
        });
      },
    }),
  } satisfies Record<AuxWriteToolName, unknown>;
}
