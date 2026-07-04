import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/shared/lib/cn";
import {
  type AssistantToolTraceContentPreview,
  type AssistantToolTraceSection,
  type AssistantToolTraceTreeGroup,
  type AssistantToolTraceTreeNode,
  buildAssistantToolTraceDisplayModel,
  hasAssistantToolTraceSectionContent,
} from "./toolTraceDisplayModel";
import type { AssistantToolTraceEntry } from "./toolTraceModel";

function formatToolTracePayload(payload: unknown) {
  if (typeof payload === "string") {
    return payload;
  }
  if (payload == null) {
    return "null";
  }

  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
}

function RawPayloadBlock({ label, payload }: { label: string; payload: unknown }) {
  return (
    <div className="space-y-1">
      <div className="font-medium text-[10px] tracking-[0.08em] opacity-70">{label}</div>
      <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded bg-sidebar-background/70 px-2 py-1 text-[10px] text-foreground leading-4">
        {formatToolTracePayload(payload)}
      </pre>
    </div>
  );
}

function SectionRows({ section }: { section: AssistantToolTraceSection }) {
  if (section.summaryRows.length === 0) {
    return null;
  }

  return (
    <div
      className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-2 gap-y-1"
      data-ai-tool-trace="rows"
    >
      {section.summaryRows.map((row) => (
        <FragmentRow key={`${row.label}:${row.value}`} label={row.label} value={row.value} />
      ))}
    </div>
  );
}

function FragmentRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <div className="text-foreground-muted">{label}</div>
      <div className="min-w-0 break-words text-foreground">{value}</div>
    </>
  );
}

function ContentPreviewBlock({ preview }: { preview: AssistantToolTraceContentPreview }) {
  return (
    <div className="space-y-1" data-ai-tool-trace="content-preview">
      <div className="flex items-center justify-between gap-2">
        <div className="font-medium text-foreground">{preview.label}</div>
        <div className="text-foreground-muted">
          {preview.characterCount} 字 / {preview.lineCount} 行
        </div>
      </div>
      <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded bg-sidebar-background/70 px-2 py-1 text-[10px] text-foreground leading-4">
        {preview.preview}
      </pre>
      {preview.truncated ? (
        <details className="text-foreground-muted">
          <summary className="cursor-pointer select-none">展开完整内容</summary>
          <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words rounded bg-sidebar-background/70 px-2 py-1 text-[10px] text-foreground leading-4">
            {preview.fullContent}
          </pre>
        </details>
      ) : null}
    </div>
  );
}

function TreeGroupBlock({ group }: { group: AssistantToolTraceTreeGroup }) {
  const visibleNodes = group.nodes.slice(0, 8);
  const hiddenNodes = group.nodes.slice(8);

  return (
    <div className="space-y-1" data-ai-tool-trace="tree-group">
      <div className="flex items-center justify-between gap-2">
        <div className="font-medium text-foreground">{group.label}</div>
        <div className="text-foreground-muted">
          {group.totalCount} 项{group.truncated ? " / 已截断" : ""}
        </div>
      </div>
      <TreeNodesList nodes={visibleNodes} />
      {hiddenNodes.length > 0 ? (
        <details className="text-foreground-muted">
          <summary className="cursor-pointer select-none">展开剩余 {hiddenNodes.length} 项</summary>
          <div className="mt-1">
            <TreeNodesList nodes={hiddenNodes} />
          </div>
        </details>
      ) : null}
    </div>
  );
}

function TreeNodesList({ nodes }: { nodes: AssistantToolTraceTreeNode[] }) {
  return (
    <ul className="space-y-1">
      {nodes.map((node) => (
        <li key={node.id} className="min-w-0">
          <div className="flex items-start gap-1.5">
            <span className="icon-[material-symbols--subdirectory-arrow-right] mt-0.5 shrink-0 text-[12px] text-accent-foreground" />
            <div className="min-w-0">
              <div className="break-words text-foreground">{node.label}</div>
              {node.meta.length > 0 ? (
                <div className="break-words text-foreground-muted">{node.meta.join(" / ")}</div>
              ) : null}
              {node.children.length > 0 ? (
                <div className="mt-1 border-current/10 border-l pl-2">
                  <TreeNodesList nodes={node.children} />
                </div>
              ) : null}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function SectionWarnings({ section }: { section: AssistantToolTraceSection }) {
  if (section.warningItems.length === 0) {
    return null;
  }

  return (
    <div className="space-y-1" data-ai-tool-trace="warnings">
      <div className="font-medium text-foreground">提示</div>
      <ul className="space-y-1 text-foreground-muted">
        {section.warningItems.map((item) => (
          <li key={item} className="flex items-start gap-1.5">
            <span className="icon-[material-symbols--info-outline] mt-0.5 shrink-0 text-[12px] text-accent-foreground" />
            <span className="min-w-0 break-words">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SectionError({ section }: { section: AssistantToolTraceSection }) {
  if (section.errorMessage == null && section.errorContextRows.length === 0) {
    return null;
  }

  return (
    <div className="space-y-1" data-ai-tool-trace="error">
      {section.errorMessage ? (
        <div className="rounded bg-accent-foreground/10 px-2 py-1 text-accent-foreground">
          {section.errorMessage}
        </div>
      ) : null}
      {section.errorContextRows.length > 0 ? (
        <div className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-2 gap-y-1">
          {section.errorContextRows.map((row) => (
            <FragmentRow
              key={`error:${row.label}:${row.value}`}
              label={row.label}
              value={row.value}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ToolTraceSectionBlock({
  label,
  section,
}: {
  label: string;
  section: AssistantToolTraceSection | null;
}) {
  if (!hasAssistantToolTraceSectionContent(section)) {
    return null;
  }

  return (
    <div className="space-y-2 pb-2 last:pb-0" data-ai-tool-trace="section">
      <div className="font-medium text-[10px] tracking-[0.08em] opacity-70">{label}</div>
      <div className="space-y-2 rounded bg-sidebar-background/35 px-2 py-1.5 text-[10px] leading-4">
        <SectionError section={section} />
        <SectionRows section={section} />
        {section.contentPreviews.map((preview) => (
          <ContentPreviewBlock
            key={`${preview.label}:${preview.characterCount}`}
            preview={preview}
          />
        ))}
        {section.treeGroups.map((group) => (
          <TreeGroupBlock key={group.label} group={group} />
        ))}
        <SectionWarnings section={section} />
      </div>
    </div>
  );
}

function RawTraceDisclosure({
  requestPayload,
  responsePayload,
}: {
  requestPayload: unknown;
  responsePayload: unknown;
}) {
  if (requestPayload == null && responsePayload == null) {
    return null;
  }

  return (
    <details className="mt-1 text-[10px] leading-4" data-ai-tool-trace="raw-disclosure">
      <summary className="cursor-pointer select-none text-foreground-muted">原始数据</summary>
      <div className="mt-1 space-y-2">
        {requestPayload != null ? <RawPayloadBlock label="请求" payload={requestPayload} /> : null}
        {responsePayload != null ? (
          <RawPayloadBlock label="响应" payload={responsePayload} />
        ) : null}
      </div>
    </details>
  );
}

export function ToolTraceCard({
  entry,
  expanded,
  onToggle,
  forceExpanded = false,
  hideToggle = false,
}: {
  entry: AssistantToolTraceEntry;
  expanded: boolean;
  onToggle: () => void;
  forceExpanded?: boolean;
  hideToggle?: boolean;
}) {
  const displayModel = buildAssistantToolTraceDisplayModel({
    toolName: entry.toolName,
    requestPayload: entry.requestPayload,
    responsePayload: entry.responsePayload,
    streamingRequestPayload: entry.streamingRequestPayload,
    status: entry.status,
  });
  const requestRawPayload =
    entry.requestPayload ?? entry.streamingInputTextRaw ?? entry.streamingRequestPayload;
  const hasDetails =
    hasAssistantToolTraceSectionContent(displayModel.request) ||
    hasAssistantToolTraceSectionContent(displayModel.response) ||
    requestRawPayload != null ||
    entry.responsePayload != null;
  const statusLabel =
    entry.status === "error" ? "失败" : entry.status === "success" ? "已返回" : "处理中";
  const toneClassName =
    entry.status === "error"
      ? "border-accent-foreground/30 bg-accent-foreground/5 text-accent-foreground"
      : "border-border bg-editor-background text-foreground-muted";
  const isExpanded = forceExpanded || expanded;

  return (
    <div className={cn("overflow-hidden rounded-md border", toneClassName)}>
      <button
        type="button"
        disabled={!hasDetails || forceExpanded}
        onClick={hasDetails && !forceExpanded ? onToggle : undefined}
        className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-[11px] leading-4 disabled:cursor-default"
      >
        <span className="icon-[material-symbols--build-outline] shrink-0 text-[13px]" />
        <span className="min-w-0 flex-1 truncate">{entry.summary}</span>
        <span className="shrink-0 text-[10px] uppercase tracking-[0.08em] opacity-70">
          {statusLabel}
        </span>
        {hasDetails && !hideToggle ? (
          <span
            className={cn(
              "shrink-0 text-[14px]",
              isExpanded
                ? "icon-[material-symbols--keyboard-arrow-up]"
                : "icon-[material-symbols--keyboard-arrow-down]",
            )}
          />
        ) : null}
      </button>

      <AnimatePresence initial={false}>
        {isExpanded ? (
          <motion.div
            className="border-current/10 border-t px-2 py-1.5 text-[10px] leading-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
          >
            <ToolTraceSectionBlock label="请求" section={displayModel.request} />
            <ToolTraceSectionBlock label="响应" section={displayModel.response} />
            <RawTraceDisclosure
              requestPayload={requestRawPayload}
              responsePayload={entry.responsePayload}
            />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
