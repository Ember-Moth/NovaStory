import { basename, dirname } from "node:path/posix";

import { jsonSchema, tool } from "ai";

import type {
  ProjectAssistantContextSnapshot,
  ProjectAssistantToolName,
} from "@/modules/ai/domain/types";
import {
  composeWritingContext,
  exportContentSubtree,
  getDefaultWorkspace,
  listAuxDirAt,
  listTimelinePoints,
  mkdirAt,
  ORIGIN_TIMELINE_POINT_ID,
  readAuxByPathAt,
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
const AUX_FILE_CHAR_LIMIT = 3_000;
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
  const content = trimText(node.content, AUX_FILE_CHAR_LIMIT);

  return {
    node: {
      ...node,
      content: content.value,
    },
    truncated: content.truncated,
  };
}

function limitAuxNodes(nodes: ResolvedAuxNode[], maxEntries: number) {
  let truncated = false;
  const limited = nodes.slice(0, maxEntries).map((node) => {
    const sanitized = sanitizeAuxNode(node);
    if (sanitized.truncated) {
      truncated = true;
    }
    return sanitized.node;
  });

  if (limited.length < nodes.length) {
    truncated = true;
  }

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
      description: "读取当前时间点下某个辅助资料路径对应的节点。读取文件时会返回截断后的文件内容。",
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
