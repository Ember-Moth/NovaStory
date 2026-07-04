import type { AgentToolTraceStatus } from "@/modules/ai/domain/types";

export interface AssistantToolTraceRow {
  label: string;
  value: string;
}

export interface AssistantToolTraceContentPreview {
  label: string;
  preview: string;
  fullContent: string;
  lineCount: number;
  characterCount: number;
  truncated: boolean;
}

export interface AssistantToolTraceTreeNode {
  id: string;
  label: string;
  meta: string[];
  children: AssistantToolTraceTreeNode[];
}

export interface AssistantToolTraceTreeGroup {
  label: string;
  nodes: AssistantToolTraceTreeNode[];
  totalCount: number;
  truncated?: boolean;
}

export interface AssistantToolTraceSection {
  summaryRows: AssistantToolTraceRow[];
  contentPreviews: AssistantToolTraceContentPreview[];
  treeGroups: AssistantToolTraceTreeGroup[];
  warningItems: string[];
  errorMessage: string | null;
  errorContextRows: AssistantToolTraceRow[];
}

export interface AssistantToolTraceDisplayModel {
  request: AssistantToolTraceSection | null;
  response: AssistantToolTraceSection | null;
}

const PREVIEW_MAX_LINES = 8;
const PREVIEW_MAX_CHARS = 400;
const TREE_GROUP_VISIBLE_ITEMS = 8;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function getRecordField(value: unknown, key: string) {
  return asRecord(value)?.[key] ?? null;
}

function getRecordString(value: unknown, key: string) {
  const field = getRecordField(value, key);
  return typeof field === "string" && field.trim().length > 0 ? field : null;
}

function getRecordBoolean(value: unknown, key: string) {
  const field = getRecordField(value, key);
  return typeof field === "boolean" ? field : null;
}

function getRecordNumber(value: unknown, key: string) {
  const field = getRecordField(value, key);
  return typeof field === "number" && Number.isFinite(field) ? field : null;
}

function getRecordArray(value: unknown, key: string) {
  const field = getRecordField(value, key);
  return Array.isArray(field) ? field : null;
}

function formatScalar(value: unknown) {
  if (typeof value === "string") {
    return value.trim().length > 0 ? value : "空字符串";
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "NaN";
  }
  if (typeof value === "boolean") {
    return value ? "是" : "否";
  }
  if (value == null) {
    return "null";
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function formatCountSummary(value: {
  added?: number | null;
  modified?: number | null;
  deleted?: number | null;
  total?: number | null;
}) {
  const parts = [
    value.added != null ? `新增 ${value.added}` : null,
    value.modified != null ? `修改 ${value.modified}` : null,
    value.deleted != null ? `删除 ${value.deleted}` : null,
    value.total != null ? `共 ${value.total}` : null,
  ].filter((part): part is string => part != null);
  return parts.join(" / ");
}

function buildRows(values: Array<[string, unknown]>) {
  return values.flatMap(([label, value]) =>
    value === null || value === undefined || value === ""
      ? []
      : [{ label, value: formatScalar(value) } satisfies AssistantToolTraceRow],
  );
}

function buildContentPreview(label: string, content: string | null | undefined) {
  if (typeof content !== "string") {
    return null;
  }
  const lineCount = content.length === 0 ? 0 : content.split("\n").length;
  const lines = content.split("\n");
  const byLines = lines.slice(0, PREVIEW_MAX_LINES).join("\n");
  const preview =
    byLines.length > PREVIEW_MAX_CHARS ? byLines.slice(0, PREVIEW_MAX_CHARS) : byLines;
  const truncated = lineCount > PREVIEW_MAX_LINES || content.length > PREVIEW_MAX_CHARS;
  return {
    label,
    preview: truncated ? `${preview}…` : preview,
    fullContent: content,
    lineCount,
    characterCount: content.length,
    truncated,
  } satisfies AssistantToolTraceContentPreview;
}

function buildWarningItems(value: unknown) {
  const warnings = getRecordArray(value, "warnings");
  if (!warnings) {
    return [];
  }
  return warnings.flatMap((warning) => {
    const message = getRecordString(warning, "message");
    const code = getRecordString(warning, "code");
    if (message == null) {
      return [];
    }
    return [code ? `${message} (${code})` : message];
  });
}

function buildGenericTreeNodes(
  value: unknown,
  parentId: string,
  depth = 0,
): AssistantToolTraceTreeNode[] {
  if (depth >= 4) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.slice(0, TREE_GROUP_VISIBLE_ITEMS).map((item, index) => {
      const id = `${parentId}:${index}`;
      const children = buildGenericTreeNodes(item, id, depth + 1);
      return {
        id,
        label: `[${index}]`,
        meta: children.length === 0 ? [formatScalar(item)] : [],
        children,
      };
    });
  }

  const record = asRecord(value);
  if (!record) {
    return [];
  }

  return Object.entries(record)
    .slice(0, TREE_GROUP_VISIBLE_ITEMS)
    .map(([key, fieldValue]) => {
      const id = `${parentId}:${key}`;
      const children = buildGenericTreeNodes(fieldValue, id, depth + 1);
      return {
        id,
        label: key,
        meta: children.length === 0 ? [formatScalar(fieldValue)] : [],
        children,
      };
    });
}

function buildGenericTreeGroup(label: string, value: unknown) {
  const nodes = buildGenericTreeNodes(value, label);
  if (nodes.length === 0) {
    return [] as AssistantToolTraceTreeGroup[];
  }
  return [
    {
      label,
      nodes,
      totalCount: Array.isArray(value)
        ? value.length
        : asRecord(value)
          ? Object.keys(asRecord(value)!).length
          : nodes.length,
    } satisfies AssistantToolTraceTreeGroup,
  ];
}

function buildAuxTreeNodes(nodes: unknown[], parentId: string): AssistantToolTraceTreeNode[] {
  return nodes.map((node, index) => {
    const path = getRecordString(node, "path") ?? `item:${index}`;
    const id = `${parentId}:${path}:${index}`;
    const nodeType = getRecordString(node, "nodeType");
    const targetPath =
      getRecordString(node, "targetPath") ??
      getRecordString(node, "symlinkTargetPath") ??
      getRecordString(node, "newTargetPath");
    const hiddenChildrenCount = getRecordNumber(node, "hiddenChildrenCount");
    const meta = [
      nodeType,
      path,
      targetPath ? `-> ${targetPath}` : null,
      hiddenChildrenCount != null ? `还有 ${hiddenChildrenCount} 个子项` : null,
    ].filter((item): item is string => item != null);
    return {
      id,
      label: getRecordString(node, "name") ?? path,
      meta,
      children: buildAuxTreeNodes(getRecordArray(node, "children") ?? [], id),
    };
  });
}

function buildManuscriptTreeNodes(
  nodes: unknown[],
  parentId: string,
): AssistantToolTraceTreeNode[] {
  return nodes.map((node, index) => {
    const nodeId = getRecordString(node, "id") ?? `node:${index}`;
    const id = `${parentId}:${nodeId}`;
    const hiddenChildrenCount = getRecordNumber(node, "hiddenChildrenCount");
    const meta = [
      nodeId,
      getRecordString(node, "anchorTimelinePointId"),
      hiddenChildrenCount != null ? `还有 ${hiddenChildrenCount} 个子节点` : null,
    ].filter((item): item is string => item != null);
    return {
      id,
      label: getRecordString(node, "title") ?? "未命名章节",
      meta,
      children: buildManuscriptTreeNodes(getRecordArray(node, "children") ?? [], id),
    };
  });
}

function buildTimelinePointNodes(
  points: unknown[],
  parentId: string,
): AssistantToolTraceTreeNode[] {
  return points.map((point, index) => {
    const pointId = getRecordString(point, "pointId") ?? getRecordString(point, "id") ?? `${index}`;
    const summary = asRecord(getRecordField(point, "auxChangeSummary"));
    const meta = [
      pointId,
      getRecordString(point, "description"),
      summary ? formatCountSummary(summary) : null,
    ].filter((item): item is string => item != null && item.length > 0);
    return {
      id: `${parentId}:${pointId}`,
      label: getRecordString(point, "label") ?? pointId,
      meta,
      children: [],
    };
  });
}

function buildTimelineChangeNodes(
  changes: unknown[],
  parentId: string,
): AssistantToolTraceTreeNode[] {
  return changes.map((change, index) => {
    const path = getRecordString(change, "path") ?? `change:${index}`;
    const changedAspects = getRecordArray(change, "changedAspects");
    const meta = [
      getRecordString(change, "kind"),
      getRecordString(change, "nodeType"),
      getRecordString(change, "previousPath")
        ? `原路径 ${getRecordString(change, "previousPath")}`
        : null,
      getRecordString(change, "symlinkTargetPath")
        ? `目标 ${getRecordString(change, "symlinkTargetPath")}`
        : null,
      Array.isArray(changedAspects) && changedAspects.length > 0
        ? changedAspects.map((item) => formatScalar(item)).join(", ")
        : null,
    ].filter((item): item is string => item != null && item.length > 0);
    return {
      id: `${parentId}:${path}:${index}`,
      label: path,
      meta,
      children: [],
    };
  });
}

function getResponseEnvelope(payload: unknown) {
  const topLevel = asRecord(payload);
  const nested = asRecord(getRecordField(payload, "value")) ?? topLevel;
  const data = asRecord(nested?.data) ?? asRecord(topLevel?.data);
  const context = asRecord(nested?.context) ?? asRecord(topLevel?.context);
  return {
    ok:
      typeof nested?.ok === "boolean"
        ? nested.ok
        : typeof topLevel?.ok === "boolean"
          ? topLevel.ok
          : null,
    truncated:
      typeof nested?.truncated === "boolean"
        ? nested.truncated
        : typeof topLevel?.truncated === "boolean"
          ? topLevel.truncated
          : null,
    data,
    error:
      (typeof nested?.error === "string" && nested.error) ||
      (typeof topLevel?.error === "string" && topLevel.error) ||
      null,
    context,
  };
}

function createEmptySection(): AssistantToolTraceSection {
  return {
    summaryRows: [],
    contentPreviews: [],
    treeGroups: [],
    warningItems: [],
    errorMessage: null,
    errorContextRows: [],
  };
}

function appendResponseMeta(section: AssistantToolTraceSection, payload: unknown) {
  const envelope = getResponseEnvelope(payload);
  if (envelope.truncated === true) {
    section.summaryRows.push({
      label: "截断",
      value: formatScalar(envelope.truncated),
    });
  }
  if (envelope.error) {
    section.errorMessage = envelope.error;
  }
  if (envelope.context) {
    section.errorContextRows.push(
      ...buildRows(
        Object.entries(envelope.context).map(([key, value]) => [key, value] as [string, unknown]),
      ),
    );
  }
  section.warningItems.push(...buildWarningItems(envelope.data));
  return envelope;
}

function withGenericFallback(section: AssistantToolTraceSection, label: string, payload: unknown) {
  if (payload == null) {
    return section;
  }
  if (
    section.summaryRows.length > 0 ||
    section.contentPreviews.length > 0 ||
    section.treeGroups.length > 0 ||
    section.warningItems.length > 0 ||
    section.errorMessage != null ||
    section.errorContextRows.length > 0
  ) {
    return section;
  }
  section.treeGroups.push(...buildGenericTreeGroup(label, payload));
  return section;
}

function buildRequestSection(
  toolName: string,
  requestPayload: unknown,
): AssistantToolTraceSection | null {
  if (requestPayload == null) {
    return null;
  }

  const section = createEmptySection();

  switch (toolName) {
    case "list_files":
      section.summaryRows.push(
        ...buildRows([
          ["路径", getRecordString(requestPayload, "path") ?? "/"],
          ["深度", getRecordNumber(requestPayload, "depth")],
        ]),
      );
      break;
    case "read_file":
      section.summaryRows.push(...buildRows([["路径", getRecordString(requestPayload, "path")]]));
      break;
    case "create_dir":
    case "delete_path":
      section.summaryRows.push(...buildRows([["路径", getRecordString(requestPayload, "path")]]));
      break;
    case "move_path":
      section.summaryRows.push(
        ...buildRows([
          ["原路径", getRecordString(requestPayload, "path")],
          ["新路径", getRecordString(requestPayload, "newPath")],
        ]),
      );
      break;
    case "create_symlink":
      section.summaryRows.push(
        ...buildRows([
          ["路径", getRecordString(requestPayload, "path")],
          ["目标路径", getRecordString(requestPayload, "targetPath")],
        ]),
      );
      break;
    case "retarget_symlink":
      section.summaryRows.push(
        ...buildRows([
          ["路径", getRecordString(requestPayload, "path")],
          ["新目标路径", getRecordString(requestPayload, "newTargetPath")],
        ]),
      );
      break;
    case "write_file": {
      section.summaryRows.push(...buildRows([["路径", getRecordString(requestPayload, "path")]]));
      const preview = buildContentPreview("内容预览", getRecordString(requestPayload, "content"));
      if (preview) {
        section.contentPreviews.push(preview);
      }
      break;
    }
    case "list_manuscript_nodes":
      section.summaryRows.push(
        ...buildRows([
          ["根节点", getRecordString(requestPayload, "rootNodeId")],
          ["深度", getRecordNumber(requestPayload, "depth")],
        ]),
      );
      break;
    case "read_manuscript_node":
      section.summaryRows.push(
        ...buildRows([["节点 ID", getRecordString(requestPayload, "nodeId")]]),
      );
      break;
    case "create_manuscript_node": {
      section.summaryRows.push(
        ...buildRows([
          ["标题", getRecordString(requestPayload, "title")],
          ["父节点", getRecordString(requestPayload, "parentId")],
          ["插入位置", getRecordString(requestPayload, "afterSiblingId")],
        ]),
      );
      const preview = buildContentPreview("正文预览", getRecordString(requestPayload, "body"));
      if (preview) {
        section.contentPreviews.push(preview);
      }
      break;
    }
    case "update_manuscript_node": {
      section.summaryRows.push(
        ...buildRows([
          ["节点 ID", getRecordString(requestPayload, "nodeId")],
          ["标题", getRecordString(requestPayload, "title")],
          ["锚点", getRecordString(requestPayload, "anchorPointId")],
        ]),
      );
      const body = getRecordField(requestPayload, "body");
      if (typeof body === "string") {
        const preview = buildContentPreview("正文预览", body);
        if (preview) {
          section.contentPreviews.push(preview);
        }
      } else if (body === null) {
        section.summaryRows.push({ label: "正文", value: "清空" });
      }
      break;
    }
    case "move_manuscript_node":
      section.summaryRows.push(
        ...buildRows([
          ["节点 ID", getRecordString(requestPayload, "nodeId")],
          ["新父节点", getRecordString(requestPayload, "newParentId")],
          ["插入位置", getRecordString(requestPayload, "afterSiblingId")],
        ]),
      );
      break;
    case "delete_manuscript_node":
      section.summaryRows.push(
        ...buildRows([["节点 ID", getRecordString(requestPayload, "nodeId")]]),
      );
      break;
    case "list_current_timeline_aux_changes":
      section.summaryRows.push(
        ...buildRows([["时间点", getRecordString(requestPayload, "timelinePointId")]]),
      );
      break;
    case "set_current_timeline":
      section.summaryRows.push(
        ...buildRows([["目标时间点", getRecordString(requestPayload, "timelinePointId")]]),
      );
      break;
    case "create_story_timeline_points": {
      section.summaryRows.push(
        ...buildRows([["插入到", getRecordString(requestPayload, "afterPointId")]]),
      );
      const points = getRecordArray(requestPayload, "points") ?? [];
      section.treeGroups.push({
        label: "待创建时间点",
        nodes: buildTimelinePointNodes(points, "request:timeline-points"),
        totalCount: points.length,
      });
      break;
    }
    case "update_story_timeline_point":
      section.summaryRows.push(
        ...buildRows([
          ["时间点 ID", getRecordString(requestPayload, "pointId")],
          ["标签", getRecordString(requestPayload, "label")],
          ["说明", getRecordString(requestPayload, "description")],
        ]),
      );
      break;
    case "move_story_timeline_point":
      section.summaryRows.push(
        ...buildRows([
          ["时间点 ID", getRecordString(requestPayload, "pointId")],
          ["移动到之后", getRecordString(requestPayload, "afterPointId")],
        ]),
      );
      break;
    case "delete_story_timeline_point":
      section.summaryRows.push(
        ...buildRows([
          ["时间点 ID", getRecordString(requestPayload, "pointId")],
          ["清理辅助层", getRecordBoolean(requestPayload, "purgeAuxLayers")],
        ]),
      );
      break;
    default:
      break;
  }

  return withGenericFallback(section, "参数结构", requestPayload);
}

function buildResponseSection(
  toolName: string,
  responsePayload: unknown,
): AssistantToolTraceSection | null {
  if (responsePayload == null) {
    return null;
  }

  const section = createEmptySection();
  const envelope = appendResponseMeta(section, responsePayload);
  const data = envelope.data;

  switch (toolName) {
    case "list_files": {
      const entries = getRecordArray(data, "entries") ?? [];
      section.summaryRows.push(
        ...buildRows([
          ["路径", getRecordString(data, "path")],
          ["深度", getRecordNumber(data, "depth")],
        ]),
      );
      section.treeGroups.push({
        label: "条目",
        nodes: buildAuxTreeNodes(entries, "response:list-files"),
        totalCount: entries.length,
        truncated: envelope.truncated ?? undefined,
      });
      break;
    }
    case "read_file": {
      const node = getRecordField(data, "node");
      section.summaryRows.push(
        ...buildRows([
          ["路径", getRecordString(data, "path") ?? getRecordString(node, "path")],
          ["节点类型", getRecordString(node, "nodeType")],
          ["时间点", getRecordString(node, "timelinePointId")],
          ["目标路径", getRecordString(node, "symlinkTargetPath")],
        ]),
      );
      const contentPreview = buildContentPreview("内容预览", getRecordString(node, "content"));
      if (contentPreview) {
        section.contentPreviews.push(contentPreview);
      }
      const children = getRecordArray(node, "children") ?? [];
      if (children.length > 0) {
        section.treeGroups.push({
          label: "子项",
          nodes: buildAuxTreeNodes(children, "response:read-file"),
          totalCount: children.length,
        });
      }
      break;
    }
    case "create_dir":
    case "write_file":
    case "move_path":
    case "delete_path":
    case "create_symlink":
    case "retarget_symlink":
      section.summaryRows.push(
        ...buildRows([
          ["动作", getRecordString(data, "action")],
          ["路径", getRecordString(data, "path")],
          ["原路径", getRecordString(data, "previousPath")],
          ["目标路径", getRecordString(data, "targetPath")],
          ["新目标路径", getRecordString(data, "newTargetPath")],
          ["时间点", getRecordString(data, "timelinePointId")],
        ]),
      );
      break;
    case "list_manuscript_nodes": {
      const entries = getRecordArray(data, "entries") ?? [];
      section.summaryRows.push(...buildRows([["深度", getRecordNumber(data, "depth")]]));
      section.treeGroups.push({
        label: "章节",
        nodes: buildManuscriptTreeNodes(entries, "response:list-manuscript"),
        totalCount: entries.length,
        truncated: envelope.truncated ?? undefined,
      });
      break;
    }
    case "read_manuscript_node": {
      const node = getRecordField(data, "node");
      section.summaryRows.push(
        ...buildRows([
          ["标题", getRecordString(node, "title")],
          ["节点 ID", getRecordString(node, "id")],
          ["锚点时间", getRecordString(node, "anchorTimelinePointId")],
        ]),
      );
      const preview = buildContentPreview("正文预览", getRecordString(node, "body"));
      if (preview) {
        section.contentPreviews.push(preview);
      }
      const children = getRecordArray(node, "children") ?? [];
      if (children.length > 0) {
        section.treeGroups.push({
          label: "直接子章节",
          nodes: buildManuscriptTreeNodes(children, "response:read-manuscript"),
          totalCount: children.length,
        });
      }
      break;
    }
    case "create_manuscript_node":
    case "update_manuscript_node":
    case "move_manuscript_node":
    case "delete_manuscript_node":
      section.summaryRows.push(
        ...buildRows([
          ["动作", getRecordString(data, "action")],
          ["标题", getRecordString(data, "title")],
          ["节点 ID", getRecordString(data, "nodeId")],
          ["父节点", getRecordString(data, "parentId") ?? getRecordString(data, "newParentId")],
          ["时间点", getRecordString(data, "timelinePointId")],
        ]),
      );
      break;
    case "list_story_timeline_points": {
      const points = getRecordArray(data, "points") ?? [];
      section.treeGroups.push({
        label: "时间点",
        nodes: buildTimelinePointNodes(points, "response:list-timeline-points"),
        totalCount: points.length,
        truncated: envelope.truncated ?? undefined,
      });
      break;
    }
    case "list_current_timeline_aux_changes": {
      const changes = getRecordArray(data, "changes") ?? [];
      const summary = asRecord(getRecordField(data, "summary"));
      section.summaryRows.push(
        ...buildRows([
          [
            "当前时间点",
            getRecordString(data, "timelineLabel") ?? getRecordString(data, "timelinePointId"),
          ],
          [
            "前一时间点",
            getRecordString(data, "previousTimelineLabel") ??
              getRecordString(data, "previousTimelinePointId"),
          ],
          ["变更摘要", summary ? formatCountSummary(summary) : null],
        ]),
      );
      section.treeGroups.push({
        label: "变更项",
        nodes: buildTimelineChangeNodes(changes, "response:timeline-changes"),
        totalCount: changes.length,
        truncated: envelope.truncated ?? undefined,
      });
      break;
    }
    case "set_current_timeline":
      section.summaryRows.push(
        ...buildRows([
          ["动作", getRecordString(data, "action")],
          ["时间点", getRecordString(data, "timelineLabel")],
          ["时间点 ID", getRecordString(data, "timelinePointId")],
        ]),
      );
      break;
    case "create_story_timeline_points": {
      const points = getRecordArray(data, "points") ?? [];
      section.summaryRows.push(...buildRows([["动作", getRecordString(data, "action")]]));
      section.treeGroups.push({
        label: "已创建时间点",
        nodes: buildTimelinePointNodes(points, "response:create-timeline-points"),
        totalCount: points.length,
      });
      break;
    }
    case "update_story_timeline_point":
    case "move_story_timeline_point":
    case "delete_story_timeline_point":
      section.summaryRows.push(
        ...buildRows([
          ["动作", getRecordString(data, "action")],
          ["标签", getRecordString(data, "label")],
          ["时间点 ID", getRecordString(data, "pointId")],
        ]),
      );
      break;
    default:
      break;
  }

  return withGenericFallback(section, "结果结构", envelope.data ?? responsePayload);
}

export function hasAssistantToolTraceSectionContent(
  section: AssistantToolTraceSection | null,
): section is AssistantToolTraceSection {
  return Boolean(
    section &&
      (section.summaryRows.length > 0 ||
        section.contentPreviews.length > 0 ||
        section.treeGroups.length > 0 ||
        section.warningItems.length > 0 ||
        section.errorMessage != null ||
        section.errorContextRows.length > 0),
  );
}

export function buildAssistantToolTraceDisplayModel({
  toolName,
  requestPayload,
  responsePayload,
  streamingRequestPayload,
}: {
  toolName: string;
  requestPayload: unknown | null;
  responsePayload: unknown | null;
  streamingRequestPayload?: unknown | null;
  status?: AgentToolTraceStatus | "pending";
}): AssistantToolTraceDisplayModel {
  const effectiveRequestPayload = requestPayload ?? streamingRequestPayload ?? null;
  return {
    request: buildRequestSection(toolName, effectiveRequestPayload),
    response: buildResponseSection(toolName, responsePayload),
  };
}
