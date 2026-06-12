import { basename, dirname } from "node:path/posix";

import { jsonSchema } from "ai";

import type { ProjectAssistantContextSnapshot } from "@/modules/ai/domain/types";
import type { ProjectAssistantToolName } from "@/modules/ai/domain/types";

export type ToolBuildContext = {
  projectId: string;
  context: ProjectAssistantContextSnapshot | null;
};

// --- Domain tool name partitions ---
// Each domain file provides a subset of all ProjectAssistantToolName values.
// The union of all domain tool names must equal ProjectAssistantToolName.
// This is verified at compile time in _registry.ts.

export const WRITING_CONTEXT_TOOL_NAMES = ["get_writing_context"] as const;
export const CONTENT_READ_TOOL_NAMES = ["get_manuscript_subtree"] as const;
export const CONTENT_WRITE_TOOL_NAMES = [
  "create_manuscript_node",
  "update_manuscript_node",
  "move_manuscript_node",
  "delete_manuscript_node",
] as const;
export const TIMELINE_TOOL_NAMES = [
  "list_story_timeline_points",
  "create_story_timeline_point",
  "update_story_timeline_point",
  "move_story_timeline_point",
  "delete_story_timeline_point",
] as const;
export const AUX_READ_TOOL_NAMES = ["list_reference_dir", "read_reference_path"] as const;
export const AUX_WRITE_TOOL_NAMES = [
  "create_reference_dir",
  "write_reference_file",
  "move_reference_node",
  "delete_reference_node",
  "create_reference_link",
  "retarget_reference_link",
] as const;

export type WritingContextToolName = (typeof WRITING_CONTEXT_TOOL_NAMES)[number];
export type ContentReadToolName = (typeof CONTENT_READ_TOOL_NAMES)[number];
export type ContentWriteToolName = (typeof CONTENT_WRITE_TOOL_NAMES)[number];
export type TimelineToolName = (typeof TIMELINE_TOOL_NAMES)[number];
export type AuxReadToolName = (typeof AUX_READ_TOOL_NAMES)[number];
export type AuxWriteToolName = (typeof AUX_WRITE_TOOL_NAMES)[number];

// Compile-time assertion: union of all domain partitions equals ProjectAssistantToolName
type _AllDomainToolNames =
  | WritingContextToolName
  | ContentReadToolName
  | ContentWriteToolName
  | TimelineToolName
  | AuxReadToolName
  | AuxWriteToolName;

// These conditional types produce `never` when the union is exhaustive,
// causing a compile error if any tool name is missing or extraneous.
type _MissingFromPartition = Exclude<ProjectAssistantToolName, _AllDomainToolNames>;
type _ExtraneousInPartition = Exclude<_AllDomainToolNames, ProjectAssistantToolName>;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _partitionCheck: _MissingFromPartition | _ExtraneousInPartition = undefined!;
import {
  getDefaultWorkspace,
  listTimelinePoints,
  ORIGIN_TIMELINE_POINT_ID,
  readAuxByPathAt,
} from "@/modules/workspace/domain";
import type {
  ExportedContentNode,
  ExportedContentSubtree,
  ResolvedAuxNode,
  TimelinePointView,
} from "@/modules/workspace/domain/types";
import { invariant } from "@/shared/lib/domain";

// --- Envelope types ---

export type AssistantToolSuccess<T> = {
  ok: true;
  truncated: boolean;
  data: T;
};

export type AssistantToolError = {
  ok: false;
  error: string;
};

export type AssistantToolEnvelope<T> = AssistantToolSuccess<T> | AssistantToolError;

// --- Limits ---

export const CONTENT_TITLE_CHAR_LIMIT = 240;
export const CONTENT_BODY_CHAR_LIMIT = 2_000;
export const WRITING_CONTEXT_AUX_LIMIT = 24;
export const CONTENT_SUBTREE_NODE_LIMIT = 40;
export const TIMELINE_POINT_LIMIT = 120;
export const AUX_DIR_ENTRY_LIMIT = 80;

// --- Helpers ---

export function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "工具执行失败。";
}

export function trimText(
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

export function limitContentNode(
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

export function limitContentSubtree(
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

export function sanitizeAuxNode(node: ResolvedAuxNode) {
  return {
    node,
    truncated: false,
  };
}

export function limitAuxNodes(nodes: ResolvedAuxNode[], maxEntries: number) {
  const limited = nodes.slice(0, maxEntries).map((node) => sanitizeAuxNode(node).node);
  const truncated = limited.length < nodes.length;

  return {
    nodes: limited,
    truncated,
  };
}

export function limitTimelinePoints(points: TimelinePointView[]) {
  return {
    points: points.slice(0, TIMELINE_POINT_LIMIT),
    truncated: points.length > TIMELINE_POINT_LIMIT,
  };
}

export function getWorkspaceForProject(projectId: string) {
  return getDefaultWorkspace(projectId);
}

export function resolveTimelinePointId(
  context: ProjectAssistantContextSnapshot | null | undefined,
) {
  return context?.activeTimelinePointId ?? ORIGIN_TIMELINE_POINT_ID;
}

/**
 * Resolve a timeline point ID from tool input.
 *
 * - If `inputTimelinePointId` is provided and equals `"origin"`, returns the origin ID.
 * - If `inputTimelinePointId` is provided as a real ID, validates it exists on the workspace
 *   and returns it.
 * - If `inputTimelinePointId` is omitted/undefined, falls back to the context's active
 *   timeline point (or origin if none is set).
 */
export function resolveTimelinePointIdFromInput(
  workspaceId: string,
  context: ProjectAssistantContextSnapshot | null | undefined,
  inputTimelinePointId: string | undefined,
): string {
  if (inputTimelinePointId === undefined) {
    return resolveTimelinePointId(context);
  }
  if (inputTimelinePointId === "origin") {
    return ORIGIN_TIMELINE_POINT_ID;
  }
  const points = listTimelinePoints(workspaceId);
  const found = points.find((p) => p.id === inputTimelinePointId);
  invariant(found, "指定的时间点不存在。");
  return inputTimelinePointId;
}

export function resolveActiveContentNodeId(
  context: ProjectAssistantContextSnapshot | null | undefined,
  fallbackContentRootId: string | null,
) {
  return context?.activeContentNodeId ?? fallbackContentRootId;
}

export function resolveActiveAuxPath(context: ProjectAssistantContextSnapshot | null | undefined) {
  return context?.activeAuxPath ?? null;
}

export function normalizeAuxPath(path: string, actionLabel: string) {
  const normalized = path.trim();
  invariant(normalized.length > 0, `${actionLabel}时路径不能为空。`);
  invariant(normalized.startsWith("/"), `${actionLabel}只支持以 / 开头的绝对路径。`);
  const segments = normalized.split("/").filter(Boolean);
  invariant(segments.length > 0, `${actionLabel}不能作用于辅助资料根目录。`);
  return `/${segments.join("/")}`;
}

export function splitAuxPath(path: string, actionLabel: string) {
  const normalizedPath = normalizeAuxPath(path, actionLabel);
  return {
    normalizedPath,
    parentPath: dirname(normalizedPath),
    name: basename(normalizedPath),
  };
}

export function resolveParentDirId(input: {
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

export function resolveAuxNodeByPathOrThrow(input: {
  workspaceId: string;
  timelinePointId: string;
  path: string;
  actionLabel: string;
}) {
  const node = readAuxByPathAt(input.workspaceId, input.timelinePointId, input.path);
  invariant(node, `${input.actionLabel}失败：目标路径不存在或在当前时间点不可见。`);
  return node;
}

export function failure(error: unknown): AssistantToolError {
  return {
    ok: false,
    error: getErrorMessage(error),
  };
}

export function withEnvelope<T>(execute: () => AssistantToolSuccess<T>): AssistantToolEnvelope<T> {
  try {
    return execute();
  } catch (error) {
    return failure(error);
  }
}

// Re-export jsonSchema for convenience
export { jsonSchema };
