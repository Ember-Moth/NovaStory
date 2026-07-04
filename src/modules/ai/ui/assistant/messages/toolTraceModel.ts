import { Allow, parse as parsePartialJson } from "partial-json";

import type { AgentThreadNodeView, AgentToolTraceStatus } from "@/modules/ai/domain/types";

export interface AssistantToolTraceEntry {
  toolCallId: string | null;
  toolName: string;
  status: AgentToolTraceStatus | "pending";
  summary: string;
  nodeId: string;
  runId: string | null;
  requestPayload: unknown | null;
  responsePayload: unknown | null;
  streamingInputTextRaw: string | null;
  streamingRequestPayload: unknown | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function getToolPayloadField(payload: unknown, key: string) {
  if (!isRecord(payload)) {
    return null;
  }

  return payload[key] ?? null;
}

function getRecordField(payload: unknown, key: string) {
  if (!isRecord(payload)) {
    return null;
  }

  return payload[key] ?? null;
}

function getRecordString(payload: unknown, key: string) {
  const value = getRecordField(payload, key);
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function getToolPayloadString(payload: unknown, key: string) {
  const value = getToolPayloadField(payload, key);
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function formatToolTarget(value: string | null, fallback: string) {
  if (value == null) {
    return fallback;
  }

  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length <= 80) {
    return normalized;
  }

  return `${normalized.slice(0, 79)}…`;
}

function getStreamingToolField(input: unknown, key: string) {
  return getRecordString(input, key);
}

export function parseAssistantToolStreamingInput(inputText: string) {
  if (inputText.trim().length === 0) {
    return null;
  }

  try {
    const parsed = parsePartialJson(inputText, Allow.ALL);
    return Array.isArray(parsed) || (parsed && typeof parsed === "object") ? parsed : null;
  } catch {
    return null;
  }
}

export function buildStreamingAssistantToolTraceSummary({
  toolName,
  requestPayload,
}: {
  toolName: string;
  requestPayload: unknown;
}) {
  const fallback = `正在调用 ${toolName}`;
  const path = getStreamingToolField(requestPayload, "path");
  const newPath = getStreamingToolField(requestPayload, "newPath");
  const targetPath =
    getStreamingToolField(requestPayload, "targetPath") ??
    getStreamingToolField(requestPayload, "newTargetPath");
  const nodeId = getStreamingToolField(requestPayload, "nodeId");
  const title = getStreamingToolField(requestPayload, "title");
  const timelinePointId =
    getStreamingToolField(requestPayload, "timelinePointId") ??
    getStreamingToolField(requestPayload, "pointId");
  const label =
    getStreamingToolField(requestPayload, "label") ?? getFirstTimelinePointLabel(requestPayload);

  switch (toolName) {
    case "list_files":
      return `正在查看辅助信息 ${formatToolTarget(path, "/")}`;
    case "read_file":
      return `正在读取辅助信息 ${formatToolTarget(path, "当前选中")}`;
    case "create_dir":
      return path ? `正在创建辅助目录 ${formatToolTarget(path, "")}` : fallback;
    case "write_file":
      return path ? `正在写入辅助信息 ${formatToolTarget(path, "")}` : fallback;
    case "move_path":
      return path && newPath
        ? `正在移动辅助信息 ${formatToolTarget(path, "")} -> ${formatToolTarget(newPath, "")}`
        : fallback;
    case "delete_path":
      return path ? `正在删除辅助信息 ${formatToolTarget(path, "")}` : fallback;
    case "create_symlink":
      return path && targetPath
        ? `正在创建辅助链接 ${formatToolTarget(path, "")} -> ${formatToolTarget(targetPath, "")}`
        : fallback;
    case "retarget_symlink":
      return path && targetPath
        ? `正在重定向辅助链接 ${formatToolTarget(path, "")} -> ${formatToolTarget(targetPath, "")}`
        : fallback;
    case "read_manuscript_node":
      return (title ?? nodeId) ? `正在读取正文 ${formatToolTarget(title ?? nodeId, "")}` : fallback;
    case "update_manuscript_node":
      return (title ?? nodeId) ? `正在更新正文 ${formatToolTarget(title ?? nodeId, "")}` : fallback;
    case "move_manuscript_node":
      return (title ?? nodeId) ? `正在移动正文 ${formatToolTarget(title ?? nodeId, "")}` : fallback;
    case "set_current_timeline":
      return (label ?? timelinePointId)
        ? `正在切换时间点 ${formatToolTarget(label ?? timelinePointId, "")}`.trim()
        : fallback;
    case "create_story_timeline_points":
      return label ? `正在创建时间点 ${formatToolTarget(label, "")}` : fallback;
    case "update_story_timeline_point":
      return (label ?? timelinePointId)
        ? `正在更新时间点 ${formatToolTarget(label ?? timelinePointId, "")}`.trim()
        : fallback;
    case "move_story_timeline_point":
      return (label ?? timelinePointId)
        ? `正在移动时间点 ${formatToolTarget(label ?? timelinePointId, "")}`.trim()
        : fallback;
    case "delete_story_timeline_point":
      return (label ?? timelinePointId)
        ? `正在删除时间点 ${formatToolTarget(label ?? timelinePointId, "")}`.trim()
        : fallback;
    default:
      return fallback;
  }
}

function getTimelinePointCount(input: unknown) {
  const points = getRecordField(input, "points");
  return Array.isArray(points) ? points.length : null;
}

function getFirstTimelinePointLabel(input: unknown) {
  const points = getRecordField(input, "points");
  if (!Array.isArray(points) || points.length !== 1) {
    return null;
  }

  return getRecordString(points[0], "label");
}

function getToolResponseData(payload: unknown) {
  const value = getRecordField(payload, "value");
  const envelope = value && typeof value === "object" ? value : payload;
  const data = getRecordField(envelope, "data");
  return data && typeof data === "object" ? data : null;
}

function getToolResponseTitle(payload: unknown) {
  const data = getToolResponseData(payload);
  const node = getRecordField(data, "node");
  return getRecordString(data, "title") ?? getRecordString(node, "title");
}

function getToolResponseTimelineLabel(payload: unknown) {
  const data = getToolResponseData(payload);
  return getRecordString(data, "timelineLabel") ?? getRecordString(data, "label");
}

function getToolResponsePointCount(payload: unknown) {
  const points = getRecordField(getToolResponseData(payload), "points");
  return Array.isArray(points) ? points.length : null;
}

function getFirstToolResponsePointLabel(payload: unknown) {
  const points = getRecordField(getToolResponseData(payload), "points");
  if (!Array.isArray(points) || points.length !== 1) {
    return null;
  }

  return getRecordString(points[0], "label");
}

export function buildAssistantToolTraceSummary({
  toolName,
  requestPayload,
  responsePayload,
  status = "pending",
}: {
  toolName: string;
  requestPayload: unknown;
  responsePayload?: unknown;
  status?: AgentToolTraceStatus | "pending";
}) {
  const fallback = status === "error" ? `${toolName} 执行失败` : `调用 ${toolName}`;
  const responseTitle = getToolResponseTitle(responsePayload);
  const responseTimelineLabel = getToolResponseTimelineLabel(responsePayload);

  switch (toolName) {
    case "list_files":
      return `查看辅助信息 ${formatToolTarget(getRecordString(requestPayload, "path"), "/")}`;
    case "read_file":
      return `读取辅助信息 ${formatToolTarget(getRecordString(requestPayload, "path"), "当前选中")}`;
    case "create_dir":
      return `创建辅助目录 ${formatToolTarget(getRecordString(requestPayload, "path"), "")}`;
    case "write_file":
      return `写入辅助信息 ${formatToolTarget(getRecordString(requestPayload, "path"), "")}`;
    case "move_path":
      return `移动辅助信息 ${formatToolTarget(getRecordString(requestPayload, "path"), "")} -> ${formatToolTarget(getRecordString(requestPayload, "newPath"), "")}`;
    case "delete_path":
      return `删除辅助信息 ${formatToolTarget(getRecordString(requestPayload, "path"), "")}`;
    case "create_symlink":
      return `创建辅助链接 ${formatToolTarget(getRecordString(requestPayload, "path"), "")} -> ${formatToolTarget(getRecordString(requestPayload, "targetPath"), "")}`;
    case "retarget_symlink":
      return `重定向辅助链接 ${formatToolTarget(getRecordString(requestPayload, "path"), "")} -> ${formatToolTarget(getRecordString(requestPayload, "targetPath"), "")}`;
    case "list_manuscript_nodes":
      return "查看正文目录";
    case "read_manuscript_node": {
      const nodeId = getRecordString(requestPayload, "nodeId");
      return `读取正文 ${formatToolTarget(responseTitle ?? nodeId, nodeId == null ? "当前正文" : "")}`;
    }
    case "create_manuscript_node":
      return `创建正文 ${formatToolTarget(responseTitle ?? getRecordString(requestPayload, "title"), "")}`.trim();
    case "update_manuscript_node":
      return `更新正文 ${formatToolTarget(
        responseTitle ??
          getRecordString(requestPayload, "title") ??
          getRecordString(requestPayload, "nodeId"),
        "",
      )}`.trim();
    case "move_manuscript_node":
      return `移动正文 ${formatToolTarget(responseTitle ?? getRecordString(requestPayload, "nodeId"), "")}`.trim();
    case "delete_manuscript_node":
      return `删除正文 ${formatToolTarget(responseTitle ?? getRecordString(requestPayload, "nodeId"), "")}`.trim();
    case "list_story_timeline_points":
      return "查看故事时间线";
    case "list_current_timeline_aux_changes":
      return `查看时间点辅助变更 ${formatToolTarget(responseTimelineLabel ?? getRecordString(requestPayload, "timelinePointId"), "当前")}`;
    case "set_current_timeline":
      return `切换时间点 ${formatToolTarget(responseTimelineLabel ?? getRecordString(requestPayload, "timelinePointId"), "")}`.trim();
    case "create_story_timeline_points": {
      const label =
        getFirstToolResponsePointLabel(responsePayload) ??
        getFirstTimelinePointLabel(requestPayload);
      if (label != null) {
        return `创建时间点 ${formatToolTarget(label, "")}`;
      }

      const count =
        getToolResponsePointCount(responsePayload) ?? getTimelinePointCount(requestPayload);
      return count == null ? "创建时间点" : `创建时间点 ${count} 个`;
    }
    case "update_story_timeline_point":
      return `更新时间点 ${formatToolTarget(
        responseTimelineLabel ??
          getRecordString(requestPayload, "label") ??
          getRecordString(requestPayload, "pointId"),
        "",
      )}`.trim();
    case "move_story_timeline_point":
      return `移动时间点 ${formatToolTarget(responseTimelineLabel ?? getRecordString(requestPayload, "pointId"), "")}`.trim();
    case "delete_story_timeline_point":
      return `删除时间点 ${formatToolTarget(responseTimelineLabel ?? getRecordString(requestPayload, "pointId"), "")}`.trim();
    default:
      return fallback;
  }
}

function getToolResultStatus(payload: unknown, partKind: "tool-result" | "tool-error") {
  if (partKind === "tool-error") {
    return "error" as const;
  }

  const output = getToolPayloadField(payload, "output");
  if (isRecord(output)) {
    if (output.ok === false) {
      return "error" as const;
    }

    const nestedValue = output.value;
    if (isRecord(nestedValue)) {
      if (nestedValue.ok === false) {
        return "error" as const;
      }
    }
  }

  return "success" as const;
}

function createToolTraceEntry({
  node,
  payload,
}: {
  node: AgentThreadNodeView;
  payload: unknown;
}): AssistantToolTraceEntry {
  const toolName = getToolPayloadString(payload, "toolName") ?? "tool";
  const requestPayload = getToolPayloadField(payload, "input");
  return {
    toolCallId: getToolPayloadString(payload, "toolCallId"),
    toolName,
    status: "pending",
    summary: buildAssistantToolTraceSummary({ toolName, requestPayload }),
    nodeId: node.id,
    runId: node.createdByRunId ?? null,
    requestPayload,
    responsePayload: null,
    streamingInputTextRaw: null,
    streamingRequestPayload: null,
  };
}

export function getAssistantToolTrace(
  messages: AgentThreadNodeView[],
  messageIndex: number,
): AssistantToolTraceEntry[] {
  const node = messages[messageIndex];
  if (node?.role !== "assistant") {
    return [];
  }

  const entries: AssistantToolTraceEntry[] = [];
  const entryByCallId = new Map<string, AssistantToolTraceEntry>();

  node.parts.forEach((part) => {
    if (part.partKind !== "tool-call") {
      return;
    }

    const entry = createToolTraceEntry({ node, payload: part.payload });
    entries.push(entry);
    if (entry.toolCallId) {
      entryByCallId.set(entry.toolCallId, entry);
    }
  });

  for (let index = messageIndex + 1; index < messages.length; index += 1) {
    const toolNode = messages[index];
    if (toolNode?.role !== "tool") {
      break;
    }

    toolNode.parts.forEach((part) => {
      if (part.partKind !== "tool-result" && part.partKind !== "tool-error") {
        return;
      }

      const toolCallId = getToolPayloadString(part.payload, "toolCallId");
      const matchedEntry = toolCallId ? entryByCallId.get(toolCallId) : null;
      const targetEntry =
        matchedEntry ??
        (() => {
          const fallbackEntry = {
            ...createToolTraceEntry({ node, payload: part.payload }),
            status: getToolResultStatus(part.payload, part.partKind),
          } satisfies AssistantToolTraceEntry;
          fallbackEntry.summary = buildAssistantToolTraceSummary({
            toolName: fallbackEntry.toolName,
            requestPayload: fallbackEntry.requestPayload,
            responsePayload: fallbackEntry.responsePayload,
            status: fallbackEntry.status,
          });
          entries.push(fallbackEntry);
          if (fallbackEntry.toolCallId) {
            entryByCallId.set(fallbackEntry.toolCallId, fallbackEntry);
          }
          return fallbackEntry;
        })();

      targetEntry.status = getToolResultStatus(part.payload, part.partKind);
      targetEntry.responsePayload = getToolPayloadField(part.payload, "output");
      targetEntry.summary = buildAssistantToolTraceSummary({
        toolName: targetEntry.toolName,
        requestPayload: targetEntry.requestPayload,
        responsePayload: targetEntry.responsePayload,
        status: targetEntry.status,
      });
      targetEntry.streamingInputTextRaw = null;
      targetEntry.streamingRequestPayload = null;
    });
  }

  return entries;
}
