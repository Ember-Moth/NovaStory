import { basename, dirname } from "node:path/posix";

import { jsonSchema, tool } from "ai";

import type {
  ProjectAssistantContextSnapshot,
  ProjectAssistantToolName,
} from "@/modules/ai/domain/types";
import {
  composeWritingContext,
  createContentNode,
  deleteAuxNodeAt,
  deleteContentNode,
  exportContentSubtree,
  getDefaultWorkspace,
  linkAt,
  listAuxDirAt,
  listTimelinePoints,
  mkdirAt,
  moveAuxNodeAt,
  moveContentNode,
  ORIGIN_TIMELINE_POINT_ID,
  readAuxByPathAt,
  retargetAuxSymlinkAt,
  updateContentNode,
  writeFileAt,
} from "@/modules/workspace/domain";
import type {
  ExportedContentNode,
  ExportedContentSubtree,
  ResolvedAuxNode,
  TimelinePointView,
  WritingContext,
} from "@/modules/workspace/domain/types";
import { invariant } from "@/shared/lib/domain";

type AssistantToolSuccess<T> = {
  ok: true;
  truncated: boolean;
  data: T;
};

type AssistantToolError = {
  ok: false;
  error: string;
};

type AssistantToolEnvelope<T> = AssistantToolSuccess<T> | AssistantToolError;

const CONTENT_TITLE_CHAR_LIMIT = 240;
const CONTENT_BODY_CHAR_LIMIT = 2_000;
const WRITING_CONTEXT_AUX_LIMIT = 24;
const CONTENT_SUBTREE_NODE_LIMIT = 40;
const TIMELINE_POINT_LIMIT = 120;
const AUX_DIR_ENTRY_LIMIT = 80;

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "工具执行失败。";
}

function trimText(
  value: string | null | undefined,
  maxChars: number,
): { value: string | null; truncated: boolean } {
  if (value == null) {
    return {
      value: null,
      truncated: false,
    };
  }

  if (value.length <= maxChars) {
    return {
      value,
      truncated: false,
    };
  }

  return {
    value: `${value.slice(0, maxChars)}…`,
    truncated: true,
  };
}

function limitContentNode(
  node: ExportedContentNode,
  state: { remaining: number; truncated: boolean },
): ExportedContentNode | null {
  if (state.remaining <= 0) {
    state.truncated = true;
    return null;
  }

  state.remaining -= 1;
  const title = trimText(node.title, CONTENT_TITLE_CHAR_LIMIT);
  const body = trimText(node.body, CONTENT_BODY_CHAR_LIMIT);
  let children: ExportedContentNode[] = [];

  for (const child of node.children) {
    const limitedChild = limitContentNode(child, state);
    if (!limitedChild) {
      break;
    }
    children.push(limitedChild);
  }

  if (children.length < node.children.length) {
    state.truncated = true;
  }

  if (title.truncated || body.truncated) {
    state.truncated = true;
  }

  return {
    ...node,
    title: title.value,
    body: body.value,
    children,
  };
}

function limitContentSubtree(
  subtree: ExportedContentSubtree,
): AssistantToolSuccess<ExportedContentSubtree> {
  const state = {
    remaining: CONTENT_SUBTREE_NODE_LIMIT,
    truncated: false,
  };
  const nodes: ExportedContentNode[] = [];

  for (const node of subtree.nodes) {
    const limitedNode = limitContentNode(node, state);
    if (!limitedNode) {
      break;
    }
    nodes.push(limitedNode);
  }

  if (nodes.length < subtree.nodes.length) {
    state.truncated = true;
  }

  return {
    ok: true,
    truncated: state.truncated,
    data: {
      ...subtree,
      nodes,
    },
  };
}

function sanitizeAuxNode(node: ResolvedAuxNode) {
  return {
    node,
    truncated: false,
  };
}

function limitAuxNodes(nodes: ResolvedAuxNode[], maxEntries: number) {
  const limited = nodes.slice(0, maxEntries).map((node) => sanitizeAuxNode(node).node);
  const truncated = limited.length < nodes.length;

  return {
    nodes: limited,
    truncated,
  };
}

function limitTimelinePoints(points: TimelinePointView[]) {
  return {
    points: points.slice(0, TIMELINE_POINT_LIMIT),
    truncated: points.length > TIMELINE_POINT_LIMIT,
  };
}

function getWorkspaceForProject(projectId: string) {
  return getDefaultWorkspace(projectId);
}

function resolveTimelinePointId(context: ProjectAssistantContextSnapshot | null | undefined) {
  return context?.activeTimelinePointId ?? ORIGIN_TIMELINE_POINT_ID;
}

function resolveActiveContentNodeId(
  context: ProjectAssistantContextSnapshot | null | undefined,
  fallbackContentRootId: string | null,
) {
  return context?.activeContentNodeId ?? fallbackContentRootId;
}

function resolveActiveAuxPath(context: ProjectAssistantContextSnapshot | null | undefined) {
  return context?.activeAuxPath ?? null;
}

function normalizeAuxPath(path: string, actionLabel: string) {
  const normalized = path.trim();
  invariant(normalized.length > 0, `${actionLabel}时路径不能为空。`);
  invariant(normalized.startsWith("/"), `${actionLabel}只支持以 / 开头的绝对路径。`);
  const segments = normalized.split("/").filter(Boolean);
  invariant(segments.length > 0, `${actionLabel}不能作用于辅助资料根目录。`);
  return `/${segments.join("/")}`;
}

function splitAuxPath(path: string, actionLabel: string) {
  const normalizedPath = normalizeAuxPath(path, actionLabel);
  return {
    normalizedPath,
    parentPath: dirname(normalizedPath),
    name: basename(normalizedPath),
  };
}

function resolveParentDirId(input: {
  workspaceId: string;
  timelinePointId: string;
  auxRootId: string | null;
  parentPath: string;
  actionLabel: string;
}) {
  if (input.parentPath === "/") {
    invariant(input.auxRootId, "当前工作区没有辅助资料根目录。");
    return input.auxRootId;
  }

  const parentNode = readAuxByPathAt(input.workspaceId, input.timelinePointId, input.parentPath);
  invariant(parentNode, `${input.actionLabel}失败：父目录不存在或在当前时间点不可见。`);
  invariant(parentNode.nodeType === "dir", `${input.actionLabel}失败：父路径不是辅助资料目录。`);
  return parentNode.id;
}

function resolveAuxNodeByPathOrThrow(input: {
  workspaceId: string;
  timelinePointId: string;
  path: string;
  actionLabel: string;
}) {
  const node = readAuxByPathAt(input.workspaceId, input.timelinePointId, input.path);
  invariant(node, `${input.actionLabel}失败：目标路径不存在或在当前时间点不可见。`);
  return node;
}

function failure(error: unknown): AssistantToolError {
  return {
    ok: false,
    error: getErrorMessage(error),
  };
}

function withEnvelope<T>(execute: () => AssistantToolSuccess<T>): AssistantToolEnvelope<T> {
  try {
    return execute();
  } catch (error) {
    return failure(error);
  }
}

function buildAssistantToolRegistry({
  projectId,
  context,
}: {
  projectId: string;
  context: ProjectAssistantContextSnapshot | null;
}) {
  const registry = {
    read_current_writing_context: tool({
      description:
        "读取当前正文节点的写作上下文，包括当前正文节点、其锚定时间点，以及该时间点下可见的辅助资料快照。",
      inputSchema: jsonSchema<{ contentNodeId?: string }>({
        type: "object",
        properties: {
          contentNodeId: {
            type: "string",
            description: "要读取写作上下文的正文节点 ID。省略时默认使用当前选中的正文节点。",
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
            contentNodeId ?? resolveActiveContentNodeId(context, workspace.contentRootId);
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
    read_content_subtree: tool({
      description: "读取正文树中的一个节点及其子树，适合分析章节结构、层级和相邻正文内容。",
      inputSchema: jsonSchema<{ rootNodeId?: string }>({
        type: "object",
        properties: {
          rootNodeId: {
            type: "string",
            description: "要读取的正文根节点 ID。省略时默认读取整个正文树根。",
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
    list_timeline_points: tool({
      description: "读取当前项目默认工作区的时间线列表。",
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
              points: limited.points,
            },
          };
        });
      },
    }),
    list_aux_dir: tool({
      description:
        "读取当前时间点下某个辅助资料目录的目录项摘要。省略路径时默认读取辅助资料根目录。",
      inputSchema: jsonSchema<{ path?: string }>({
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "辅助资料目录路径。省略时读取辅助资料根目录。",
          },
        },
      }),
      execute: async ({ path }) => {
        const workspace = getWorkspaceForProject(projectId);
        if (!workspace) {
          return failure(new Error("当前项目没有默认工作区。"));
        }

        return withEnvelope(() => {
          const dirNodes = listAuxDirAt(workspace.id, resolveTimelinePointId(context), {
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
    read_aux_path: tool({
      description: "读取当前时间点下某个辅助资料路径对应的节点。",
      inputSchema: jsonSchema<{ path?: string }>({
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "辅助资料路径。省略时默认使用当前选中的辅助资料路径。",
          },
        },
      }),
      execute: async ({ path }) => {
        const workspace = getWorkspaceForProject(projectId);
        if (!workspace) {
          return failure(new Error("当前项目没有默认工作区。"));
        }

        return withEnvelope(() => {
          const resolvedPath = path ?? resolveActiveAuxPath(context);
          if (!resolvedPath) {
            throw new Error("当前没有可读取的辅助资料路径。");
          }

          const node = readAuxByPathAt(workspace.id, resolveTimelinePointId(context), resolvedPath);
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
    mkdir_aux_dir: tool({
      description: "在当前时间点下创建一个辅助资料目录。只会创建目标路径的最后一级目录。",
      inputSchema: jsonSchema<{ path: string }>({
        type: "object",
        required: ["path"],
        properties: {
          path: {
            type: "string",
            description: "要创建的辅助资料目录绝对路径，例如 /设定/角色。",
          },
        },
      }),
      execute: async ({ path }) => {
        const workspace = getWorkspaceForProject(projectId);
        if (!workspace) {
          return failure(new Error("当前项目没有默认工作区。"));
        }

        return withEnvelope(() => {
          const timelinePointId = resolveTimelinePointId(context);
          const { normalizedPath, parentPath, name } = splitAuxPath(path, "创建辅助资料目录");
          const existing = readAuxByPathAt(workspace.id, timelinePointId, normalizedPath);
          invariant(existing == null, "创建辅助资料目录失败：目标路径已存在。");

          const parentDirId = resolveParentDirId({
            workspaceId: workspace.id,
            timelinePointId,
            auxRootId: workspace.auxRootId,
            parentPath,
            actionLabel: "创建辅助资料目录",
          });
          const node = mkdirAt({
            workspaceId: workspace.id,
            timelinePointId,
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
    write_aux_file: tool({
      description:
        "在当前时间点下创建或覆盖一个辅助资料文件。若文件已存在则整文件覆盖；若不存在则创建。",
      inputSchema: jsonSchema<{ path: string; content: string }>({
        type: "object",
        required: ["path", "content"],
        properties: {
          path: {
            type: "string",
            description: "要写入的辅助资料文件绝对路径，例如 /设定/角色/主角.md。",
          },
          content: {
            type: "string",
            description: "要写入文件的完整内容。",
          },
        },
      }),
      execute: async ({ path, content }) => {
        const workspace = getWorkspaceForProject(projectId);
        if (!workspace) {
          return failure(new Error("当前项目没有默认工作区。"));
        }

        return withEnvelope(() => {
          const timelinePointId = resolveTimelinePointId(context);
          const { normalizedPath, parentPath, name } = splitAuxPath(path, "写入辅助资料文件");
          const existing = readAuxByPathAt(workspace.id, timelinePointId, normalizedPath);

          if (existing) {
            invariant(existing.nodeType === "file", "写入辅助资料文件失败：目标路径不是文件。");
            const node = writeFileAt({
              workspaceId: workspace.id,
              timelinePointId,
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
            timelinePointId,
            auxRootId: workspace.auxRootId,
            parentPath,
            actionLabel: "写入辅助资料文件",
          });
          const node = writeFileAt({
            workspaceId: workspace.id,
            timelinePointId,
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
    move_aux_node: tool({
      description:
        "在当前时间点下移动或重命名一个辅助资料节点。支持文件、目录或符号链接，但不支持辅助资料根目录。",
      inputSchema: jsonSchema<{ path: string; newPath: string }>({
        type: "object",
        required: ["path", "newPath"],
        properties: {
          path: {
            type: "string",
            description: "要移动的辅助资料绝对路径，例如 /设定/角色.md。",
          },
          newPath: {
            type: "string",
            description: "移动后的目标绝对路径，例如 /资料库/人物/主角.md。",
          },
        },
      }),
      execute: async ({ path, newPath }) => {
        const workspace = getWorkspaceForProject(projectId);
        if (!workspace) {
          return failure(new Error("当前项目没有默认工作区。"));
        }

        return withEnvelope(() => {
          const timelinePointId = resolveTimelinePointId(context);
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
            timelinePointId,
            path: normalizedPath,
            actionLabel: "移动辅助资料",
          });
          const conflicting = readAuxByPathAt(workspace.id, timelinePointId, normalizedNewPath);
          invariant(conflicting == null, "移动辅助资料失败：目标路径已存在。");

          const newParentDirId = resolveParentDirId({
            workspaceId: workspace.id,
            timelinePointId,
            auxRootId: workspace.auxRootId,
            parentPath: newParentPath,
            actionLabel: "移动辅助资料",
          });
          const node = moveAuxNodeAt({
            workspaceId: workspace.id,
            timelinePointId,
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
    create_aux_symlink: tool({
      description:
        "在当前时间点下创建一个辅助资料符号链接。链接本身写入到指定路径，目标路径必须在当前时间点可见。",
      inputSchema: jsonSchema<{ path: string; targetPath: string }>({
        type: "object",
        required: ["path", "targetPath"],
        properties: {
          path: {
            type: "string",
            description: "要创建的符号链接绝对路径，例如 /索引/角色.md。",
          },
          targetPath: {
            type: "string",
            description: "符号链接目标绝对路径，例如 /设定/角色/主角.md。",
          },
        },
      }),
      execute: async ({ path, targetPath }) => {
        const workspace = getWorkspaceForProject(projectId);
        if (!workspace) {
          return failure(new Error("当前项目没有默认工作区。"));
        }

        return withEnvelope(() => {
          const timelinePointId = resolveTimelinePointId(context);
          const { normalizedPath, parentPath, name } = splitAuxPath(path, "创建辅助资料符号链接");
          const { normalizedPath: normalizedTargetPath } = splitAuxPath(
            targetPath,
            "创建辅助资料符号链接",
          );
          const existing = readAuxByPathAt(workspace.id, timelinePointId, normalizedPath);
          invariant(existing == null, "创建辅助资料符号链接失败：目标路径已存在。");

          const targetNode = resolveAuxNodeByPathOrThrow({
            workspaceId: workspace.id,
            timelinePointId,
            path: normalizedTargetPath,
            actionLabel: "创建辅助资料符号链接",
          });
          const parentDirId = resolveParentDirId({
            workspaceId: workspace.id,
            timelinePointId,
            auxRootId: workspace.auxRootId,
            parentPath,
            actionLabel: "创建辅助资料符号链接",
          });
          const node = linkAt({
            workspaceId: workspace.id,
            timelinePointId,
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
    create_content_node: tool({
      description:
        "在正文树中创建一个新的章节节点。若省略 afterSiblingId 则插入为父节点的第一个子节点。",
      inputSchema: jsonSchema<{
        parentId: string;
        afterSiblingId?: string;
        kind?: string;
        title?: string;
        body?: string;
      }>({
        type: "object",
        required: ["parentId"],
        properties: {
          parentId: {
            type: "string",
            description: "父正文节点 ID，新节点将作为其子节点。",
          },
          afterSiblingId: {
            type: "string",
            description: "插入到该兄弟节点之后。省略时新节点将成为父节点的第一个子节点。",
          },
          kind: {
            type: "string",
            description: "章节类型，例如 chapter、scene。省略时为 null。",
          },
          title: {
            type: "string",
            description: "章节标题。",
          },
          body: {
            type: "string",
            description: "章节正文内容。",
          },
        },
      }),
      execute: async ({ parentId, afterSiblingId, kind, title, body }) => {
        const workspace = getWorkspaceForProject(projectId);
        if (!workspace) {
          return failure(new Error("当前项目没有默认工作区。"));
        }

        return withEnvelope(() => {
          const node = createContentNode({
            workspaceId: workspace.id,
            parentId,
            afterSiblingId: afterSiblingId ?? undefined,
            kind: kind ?? undefined,
            title: title ?? undefined,
            body: body ?? undefined,
          });

          return {
            ok: true,
            truncated: false,
            data: {
              action: "created" as const,
              nodeId: node.id,
              parentId: node.parentId,
            },
          };
        });
      },
    }),
    update_content_node: tool({
      description: "更新正文节点的标题、正文、类型或锚定时间点。省略的字段不做修改。",
      inputSchema: jsonSchema<{
        nodeId: string;
        kind?: string;
        title?: string;
        body?: string;
        anchorPointId?: string;
      }>({
        type: "object",
        required: ["nodeId"],
        properties: {
          nodeId: {
            type: "string",
            description: "要更新的正文节点 ID。",
          },
          kind: {
            type: "string",
            description: "新的章节类型，传 null 可清除。",
          },
          title: {
            type: "string",
            description: "新的章节标题，传 null 可清除。",
          },
          body: {
            type: "string",
            description: "新的正文内容，传 null 可清除。",
          },
          anchorPointId: {
            type: "string",
            description: "新的锚定时间点 ID。",
          },
        },
      }),
      execute: async ({ nodeId, kind, title, body, anchorPointId }) => {
        const workspace = getWorkspaceForProject(projectId);
        if (!workspace) {
          return failure(new Error("当前项目没有默认工作区。"));
        }

        return withEnvelope(() => {
          const node = updateContentNode({
            workspaceId: workspace.id,
            nodeId,
            kind: kind === undefined ? undefined : (kind ?? null),
            title: title === undefined ? undefined : (title ?? null),
            body: body === undefined ? undefined : (body ?? null),
            anchorPointId: anchorPointId ?? undefined,
          });

          return {
            ok: true,
            truncated: false,
            data: {
              action: "updated" as const,
              nodeId: node.id,
            },
          };
        });
      },
    }),
    move_content_node: tool({
      description:
        "移动或重排序正文节点。将节点移动到新的父节点下，可选地插入到指定兄弟节点之后。若省略 afterSiblingId 则插入为新父节点的第一个子节点。",
      inputSchema: jsonSchema<{
        nodeId: string;
        newParentId: string;
        afterSiblingId?: string;
      }>({
        type: "object",
        required: ["nodeId", "newParentId"],
        properties: {
          nodeId: {
            type: "string",
            description: "要移动的正文节点 ID。",
          },
          newParentId: {
            type: "string",
            description: "新父正文节点 ID。",
          },
          afterSiblingId: {
            type: "string",
            description: "移动后插入到该兄弟节点之后。省略时新节点将成为新父节点的第一个子节点。",
          },
        },
      }),
      execute: async ({ nodeId, newParentId, afterSiblingId }) => {
        const workspace = getWorkspaceForProject(projectId);
        if (!workspace) {
          return failure(new Error("当前项目没有默认工作区。"));
        }

        return withEnvelope(() => {
          const node = moveContentNode({
            workspaceId: workspace.id,
            nodeId,
            newParentId,
            afterSiblingId: afterSiblingId ?? undefined,
          });

          return {
            ok: true,
            truncated: false,
            data: {
              action: "moved" as const,
              nodeId: node.id,
              newParentId: node.parentId,
            },
          };
        });
      },
    }),
    delete_content_node: tool({
      description: "删除正文节点。注意：删除非叶节点会连同所有子节点一起删除，此操作不可逆。",
      inputSchema: jsonSchema<{ nodeId: string }>({
        type: "object",
        required: ["nodeId"],
        properties: {
          nodeId: {
            type: "string",
            description: "要删除的正文节点 ID。",
          },
        },
      }),
      execute: async ({ nodeId }) => {
        const workspace = getWorkspaceForProject(projectId);
        if (!workspace) {
          return failure(new Error("当前项目没有默认工作区。"));
        }

        return withEnvelope(() => {
          deleteContentNode({
            workspaceId: workspace.id,
            nodeId,
          });

          return {
            ok: true,
            truncated: false,
            data: {
              action: "deleted" as const,
              nodeId,
            },
          };
        });
      },
    }),
    delete_aux_node: tool({
      description:
        "删除当前时间点下的一个辅助资料节点。若是目录会连同所有子项一起删除。此操作不可逆。",
      inputSchema: jsonSchema<{ path: string }>({
        type: "object",
        required: ["path"],
        properties: {
          path: {
            type: "string",
            description: "要删除的辅助资料绝对路径，例如 /设定/旧角色.md。",
          },
        },
      }),
      execute: async ({ path }) => {
        const workspace = getWorkspaceForProject(projectId);
        if (!workspace) {
          return failure(new Error("当前项目没有默认工作区。"));
        }

        return withEnvelope(() => {
          const timelinePointId = resolveTimelinePointId(context);
          const { normalizedPath } = splitAuxPath(path, "删除辅助资料");
          const node = resolveAuxNodeByPathOrThrow({
            workspaceId: workspace.id,
            timelinePointId,
            path: normalizedPath,
            actionLabel: "删除辅助资料",
          });

          deleteAuxNodeAt({
            workspaceId: workspace.id,
            timelinePointId,
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
    retarget_aux_symlink: tool({
      description: "修改辅助资料符号链接的目标路径。链接本身不变，只是指向新的目标。",
      inputSchema: jsonSchema<{ path: string; newTargetPath: string }>({
        type: "object",
        required: ["path", "newTargetPath"],
        properties: {
          path: {
            type: "string",
            description: "要重定向的符号链接绝对路径，例如 /索引/角色.md。",
          },
          newTargetPath: {
            type: "string",
            description: "新的目标绝对路径，例如 /设定/角色/主角.md。",
          },
        },
      }),
      execute: async ({ path, newTargetPath }) => {
        const workspace = getWorkspaceForProject(projectId);
        if (!workspace) {
          return failure(new Error("当前项目没有默认工作区。"));
        }

        return withEnvelope(() => {
          const timelinePointId = resolveTimelinePointId(context);
          const { normalizedPath } = splitAuxPath(path, "重定向辅助资料符号链接");
          const { normalizedPath: normalizedNewTargetPath } = splitAuxPath(
            newTargetPath,
            "重定向辅助资料符号链接",
          );

          const symlinkNode = resolveAuxNodeByPathOrThrow({
            workspaceId: workspace.id,
            timelinePointId,
            path: normalizedPath,
            actionLabel: "重定向辅助资料符号链接",
          });
          invariant(
            symlinkNode.nodeType === "symlink",
            "重定向辅助资料符号链接失败：指定路径不是符号链接。",
          );

          const targetNode = resolveAuxNodeByPathOrThrow({
            workspaceId: workspace.id,
            timelinePointId,
            path: normalizedNewTargetPath,
            actionLabel: "重定向辅助资料符号链接",
          });

          const node = retargetAuxSymlinkAt({
            workspaceId: workspace.id,
            timelinePointId,
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
  } satisfies Record<ProjectAssistantToolName, unknown>;

  return registry;
}

export function createAssistantTools({
  projectId,
  context,
  activeTools,
}: {
  projectId: string;
  context: ProjectAssistantContextSnapshot | null;
  activeTools: readonly ProjectAssistantToolName[];
}): Partial<Record<ProjectAssistantToolName, unknown>> {
  const registry = buildAssistantToolRegistry({ projectId, context });
  const tools: Partial<Record<ProjectAssistantToolName, unknown>> = {};

  for (const toolName of activeTools) {
    tools[toolName] = registry[toolName];
  }

  return tools;
}

export type AssistantToolSet = ReturnType<typeof createAssistantTools>;
