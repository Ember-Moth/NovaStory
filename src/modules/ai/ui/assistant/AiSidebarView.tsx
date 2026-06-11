import {
  autoUpdate,
  flip,
  FloatingFocusManager,
  FloatingList,
  FloatingPortal,
  offset,
  size,
  useClick,
  useDismiss,
  useFloating,
  useInteractions,
  useListItem,
  useListNavigation,
  useRole,
  useTypeahead,
} from "@floating-ui/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

import type { AgentThreadView } from "@/modules/ai/domain/types";
import { rpc } from "@/rpc/client";
import { InlineEditInput } from "@/shared/ui/InlineEditableText";
import { OverlayScrollbar } from "@/shared/ui/OverlayScrollbar";

import { HEAD_ROW_HEIGHT } from "./assistantSheetLayout";

type ConnectionModelGroup = NonNullable<
  ReturnType<typeof rpc.useQuery<"ai.listEnabledConnectionModels">>["data"]
>[number];
type ResolvedModel = ConnectionModelGroup["models"][number];
type AiConnection = ConnectionModelGroup["connection"];

export function ModelPicker({
  selectedConnectionId,
  selectedModelId,
  selectionHydrated,
  onSelectionChange,
  onSelectionCommit,
}: {
  selectedConnectionId: string;
  selectedModelId: string;
  selectionHydrated: boolean;
  onSelectionChange: (_connectionId: string, _modelId: string) => void;
  onSelectionCommit: (_connectionId: string, _modelId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const listRef = useRef<Array<HTMLElement | null>>([]);
  const labelsRef = useRef<Array<string | null>>([]);
  const groupsQuery = rpc.useQuery("ai.listEnabledConnectionModels");
  const groups = useMemo(
    () =>
      (groupsQuery.data ?? []).map((group) => ({
        connection: group.connection,
        models: group.models.filter((model) => model.isEnabled),
      })),
    [groupsQuery.data],
  );
  const groupedOptions = useMemo(() => {
    let optionIndex = 0;
    return groups.map((group) => ({
      connection: group.connection,
      models: group.models.map((model) => ({
        model,
        optionIndex: optionIndex++,
      })),
    }));
  }, [groups]);
  const selectableOptions = useMemo(
    () =>
      groupedOptions.flatMap((group) =>
        group.models.map((option) => ({
          connection: group.connection,
          model: option.model,
        })),
      ),
    [groupedOptions],
  );
  const selectedOption =
    selectableOptions.find(
      (option) =>
        option.connection.id === selectedConnectionId && option.model.id === selectedModelId,
    ) ?? null;
  const selectedModel = selectedOption?.model ?? null;
  const selectedConnection = selectedOption?.connection ?? null;
  const selectedIndex = selectedOption ? selectableOptions.indexOf(selectedOption) : null;
  const disabled = groupsQuery.isInitialLoading || selectableOptions.length === 0;
  const loadingEmpty = groupsQuery.isInitialLoading && groups.length === 0;
  const triggerLabel = loadingEmpty
    ? "加载连接和模型中..."
    : selectedOption
      ? (selectedModel?.displayName ?? "模型")
      : selectableOptions.length === 0
        ? "无可用连接模型"
        : "选择连接和模型";
  const effectiveOpen = open && !disabled;

  const {
    refs: { setReference, setFloating, domReference },
    floatingStyles,
    context,
  } = useFloating<HTMLButtonElement>({
    open: effectiveOpen,
    onOpenChange(nextOpen) {
      setOpen(disabled ? false : nextOpen);
    },
    placement: "top-start",
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(6),
      flip({ padding: 8 }),
      size({
        padding: 8,
        apply({ rects, availableHeight, elements }) {
          Object.assign(elements.floating.style, {
            minWidth: `${rects.reference.width}px`,
            maxWidth: "min(420px, calc(100vw - 16px))",
            maxHeight: `${Math.max(96, Math.min(260, availableHeight))}px`,
          });
        },
      }),
    ],
  });

  const click = useClick(context, { enabled: !disabled });
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: "listbox" });
  const listNavigation = useListNavigation(context, {
    listRef,
    activeIndex,
    selectedIndex,
    onNavigate: setActiveIndex,
    loop: true,
  });
  const typeahead = useTypeahead(context, {
    listRef: labelsRef,
    activeIndex,
    selectedIndex,
    onMatch: setActiveIndex,
    enabled: selectableOptions.length > 0,
  });
  const { getReferenceProps, getFloatingProps, getItemProps } = useInteractions([
    click,
    dismiss,
    role,
    listNavigation,
    typeahead,
  ]);

  useEffect(() => {
    if (!selectionHydrated) {
      return;
    }

    if (groupsQuery.data === undefined) {
      return;
    }

    if ((selectedConnectionId || selectedModelId) && !selectedOption) {
      onSelectionChange("", "");
    }
  }, [
    groupsQuery.data,
    onSelectionChange,
    selectionHydrated,
    selectedConnectionId,
    selectedModelId,
    selectedOption,
  ]);

  function selectModel(connection: AiConnection, model: ResolvedModel) {
    onSelectionCommit(connection.id, model.id);
    setOpen(false);
    domReference.current?.focus();
  }

  return (
    <>
      <button
        ref={setReference}
        type="button"
        disabled={disabled}
        title={
          selectedOption
            ? `${selectedConnection?.name ?? ""} / ${selectedModel?.displayName ?? ""} (${selectedModel?.modelId ?? ""})`
            : triggerLabel
        }
        aria-label="选择连接和模型"
        className="flex h-7 max-w-full min-w-0 flex-1 items-center gap-x-1.5 rounded-md border border-transparent px-1.5 text-left text-[12px] leading-4 font-medium transition outline-none hover:border-border hover:bg-list-hover-background focus:border-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
        {...getReferenceProps()}
      >
        <span className="icon-[material-symbols--token] shrink-0 text-sm text-accent-foreground" />
        <span className="min-w-0 flex-1 truncate">{triggerLabel}</span>
      </button>

      {effectiveOpen ? (
        <FloatingPortal>
          <FloatingFocusManager context={context} modal={false}>
            <div
              ref={setFloating}
              style={floatingStyles}
              className="z-50 flex min-h-0 flex-col overflow-hidden rounded-md border border-border bg-sidebar-background text-[12px] text-foreground outline-none"
              {...getFloatingProps()}
            >
              <OverlayScrollbar variant="panel">
                <FloatingList elementsRef={listRef} labelsRef={labelsRef}>
                  {loadingEmpty ? (
                    <div className="p-2 text-foreground-muted">加载连接和模型中...</div>
                  ) : selectableOptions.length === 0 ? (
                    <div className="p-2 text-foreground-muted">没有可用连接模型</div>
                  ) : (
                    groupedOptions.map((group) =>
                      group.models.length > 0 ? (
                        <div key={group.connection.id}>
                          <div className="sticky top-0 z-10 border-y border-border bg-sidebar-background px-2 py-1 text-[11px] font-medium text-foreground-muted first:border-t-0">
                            {group.connection.name}
                          </div>
                          {group.models.map(({ model, optionIndex }) => (
                            <ModelOption
                              key={`${group.connection.id}:${model.id}`}
                              connection={group.connection}
                              model={model}
                              selected={
                                group.connection.id === selectedConnectionId &&
                                model.id === selectedModelId
                              }
                              active={activeIndex === optionIndex}
                              getItemProps={getItemProps}
                              onSelect={selectModel}
                            />
                          ))}
                        </div>
                      ) : null,
                    )
                  )}
                </FloatingList>
              </OverlayScrollbar>
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      ) : null}
    </>
  );
}

function ModelOption({
  connection,
  model,
  selected,
  active,
  getItemProps,
  onSelect,
}: {
  connection: AiConnection;
  model: ResolvedModel;
  selected: boolean;
  active: boolean;
  getItemProps: ReturnType<typeof useInteractions>["getItemProps"];
  onSelect: (_connection: AiConnection, _model: ResolvedModel) => void;
}) {
  const { ref } = useListItem({
    label: `${connection.name} ${model.displayName}`,
  });
  const capabilities = getModelCapabilities(model);

  return (
    <button
      ref={ref}
      type="button"
      className={`flex w-full items-start gap-2 px-2 py-2 text-left ${
        active
          ? "bg-list-active-background text-foreground"
          : "text-foreground-muted hover:bg-list-hover-background hover:text-foreground"
      }`}
      {...getItemProps({
        onClick: () => onSelect(connection, model),
      })}
    >
      <span
        className={`mt-0.5 shrink-0 text-[16px] ${
          selected
            ? "icon-[material-symbols--radio-button-checked]"
            : "icon-[material-symbols--radio-button-unchecked]"
        } ${selected ? "text-accent-foreground" : "text-foreground-muted"}`}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] font-medium text-foreground">
          {model.displayName}
        </span>
        <span className="block truncate text-[11px]">{model.modelId}</span>
        {capabilities ? <span className="mt-1 block text-[10px]">{capabilities}</span> : null}
      </span>
    </button>
  );
}

function getModelCapabilities(model: ResolvedModel) {
  const values = [
    model.family,
    model.contextWindow ? `${model.contextWindow.toLocaleString("zh-CN")} tokens` : null,
    model.supportsToolUse ? "工具" : null,
    model.supportsReasoning ? "推理" : null,
    model.supportsVision ? "视觉" : null,
  ].filter(Boolean);

  return values.length > 0 ? values.join(" · ") : null;
}

function SessionActionButton({
  icon,
  label,
  disabled,
  onClick,
}: {
  icon: string;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className="flex size-6 items-center justify-center rounded-md text-foreground-muted transition hover:bg-list-hover-background hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
    >
      <span className={`text-[16px] ${icon}`} />
    </button>
  );
}

function HeadRow({
  thread,
  isActive,
  isEditing,
  editingName,
  isBusy,
  onActivate,
  onEditingNameChange,
  onRenameStart,
  onRenameCancel,
  onRenameSubmit,
  onArchive,
  onRestore,
}: {
  thread: AgentThreadView;
  isActive: boolean;
  isEditing: boolean;
  editingName: string;
  isBusy: boolean;
  onActivate: () => void;
  onEditingNameChange: (_value: string) => void;
  onRenameStart: () => void;
  onRenameCancel: () => void;
  onRenameSubmit: () => void;
  onArchive: () => void;
  onRestore: () => void;
}) {
  const editingInputRef = useRef<HTMLInputElement>(null);
  const isArchived = thread.archivedAt != null;

  useEffect(() => {
    if (!isEditing) {
      return;
    }

    editingInputRef.current?.focus();
    editingInputRef.current?.select();
  }, [isEditing]);

  const titleLabel = isActive ? "当前会话" : isArchived ? "已归档" : "点击切换";
  const rowClassName = `group flex w-full items-center gap-2 overflow-hidden px-3 py-2 text-left transition ${
    isActive || isEditing
      ? "bg-list-active-background text-foreground"
      : "text-foreground-muted hover:bg-list-hover-background hover:text-foreground"
  } ${isBusy ? "opacity-50" : ""}`;
  const rowContentClassName = "flex min-w-0 flex-1 items-center gap-2 text-left";

  if (isEditing) {
    return (
      <div className={rowClassName} style={{ height: `${HEAD_ROW_HEIGHT}px` }}>
        <span
          className={`shrink-0 text-[16px] ${
            isArchived
              ? "icon-[material-symbols--inventory-2] text-foreground-muted"
              : isActive
                ? "icon-[material-symbols--chat] text-accent-foreground"
                : "icon-[material-symbols--chat-outline]"
          }`}
        />
        <InlineEditInput
          inputRef={editingInputRef}
          inputProps={{
            value: editingName,
            disabled: isBusy,
            onChange: (event) => onEditingNameChange(event.target.value),
            onBlur: () => void onRenameSubmit(),
            onClick: (event) => event.stopPropagation(),
            onDoubleClick: (event) => event.stopPropagation(),
            onKeyDown: (event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void onRenameSubmit();
              } else if (event.key === "Escape") {
                event.preventDefault();
                onRenameCancel();
              }
            },
          }}
          placeholder="会话名称"
          className="box-border h-5.5 min-w-0 flex-1 rounded border border-border bg-editor-background px-1.5 text-[12px] leading-5.5 text-foreground outline-none select-text focus:border-accent-foreground"
        />
      </div>
    );
  }

  return (
    <div style={{ height: `${HEAD_ROW_HEIGHT}px` }} className={rowClassName}>
      {isArchived ? (
        <div className={rowContentClassName}>
          <span className="icon-[material-symbols--inventory-2] shrink-0 text-[16px] text-foreground-muted" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12px] font-medium">{thread.title}</span>
            <span className="block text-[10px] text-foreground-muted">{titleLabel}</span>
          </span>
        </div>
      ) : (
        <button
          type="button"
          onClick={onActivate}
          disabled={isBusy}
          className={`${rowContentClassName} disabled:cursor-not-allowed`}
        >
          <span
            className={`shrink-0 text-[16px] ${
              isActive
                ? "icon-[material-symbols--chat] text-accent-foreground"
                : "icon-[material-symbols--chat-outline]"
            }`}
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12px] font-medium">{thread.title}</span>
            <span className="block text-[10px] text-foreground-muted">{titleLabel}</span>
          </span>
        </button>
      )}
      <div className="flex shrink-0 items-center gap-1 opacity-0 transition group-focus-within:opacity-100 group-hover:opacity-100">
        {!isArchived ? (
          <>
            <SessionActionButton
              icon="icon-[material-symbols--edit-outline]"
              label="重命名会话"
              disabled={isBusy}
              onClick={onRenameStart}
            />
            <SessionActionButton
              icon="icon-[material-symbols--archive-outline]"
              label="归档会话"
              disabled={isBusy}
              onClick={onArchive}
            />
          </>
        ) : (
          <SessionActionButton
            icon="icon-[material-symbols--unarchive-outline]"
            label="恢复会话"
            disabled={isBusy}
            onClick={onRestore}
          />
        )}
      </div>
    </div>
  );
}

export function AnimatedHeadRow({
  thread,
  isActive,
  isEditing,
  editingName,
  isBusy,
  className,
  onActivate,
  onEditingNameChange,
  onRenameStart,
  onRenameCancel,
  onRenameSubmit,
  onArchive,
  onRestore,
}: {
  thread: AgentThreadView;
  isActive: boolean;
  isEditing: boolean;
  editingName: string;
  isBusy: boolean;
  className?: string;
  onActivate: () => void;
  onEditingNameChange: (_value: string) => void;
  onRenameStart: () => void;
  onRenameCancel: () => void;
  onRenameSubmit: () => void;
  onArchive: () => void;
  onRestore: () => void;
}) {
  return (
    <motion.div
      className={className}
      layout="position"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16, ease: "easeOut" }}
    >
      <HeadRow
        thread={thread}
        isActive={isActive}
        isEditing={isEditing}
        editingName={editingName}
        isBusy={isBusy}
        onActivate={onActivate}
        onEditingNameChange={onEditingNameChange}
        onRenameStart={onRenameStart}
        onRenameCancel={onRenameCancel}
        onRenameSubmit={onRenameSubmit}
        onArchive={onArchive}
        onRestore={onRestore}
      />
    </motion.div>
  );
}

export function ArchivedSectionToggleRow({
  count,
  expanded,
  onToggle,
}: {
  count: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16, ease: "easeOut" }}
      className="mt-1 border-t border-border pt-1.5"
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-3 py-1.5 text-[11px] text-foreground-muted transition hover:bg-list-hover-background hover:text-foreground"
      >
        <span>归档会话</span>
        <span className="flex items-center gap-1">
          <span>{count}</span>
          <span
            className={
              expanded
                ? "icon-[material-symbols--expand-less]"
                : "icon-[material-symbols--expand-more]"
            }
          />
        </span>
      </button>
    </motion.div>
  );
}

export function SessionStatusOverlay({ state }: { state: "loading" | "empty" }) {
  const content =
    state === "loading" ? (
      <div className="px-3 py-1.5 text-[12px] text-foreground-muted">正在加载会话...</div>
    ) : (
      <div className="rounded-md border border-dashed border-border bg-editor-background/95 px-3 py-2 text-[12px] text-foreground-muted backdrop-blur-sm">
        还没有可用会话。点击右上角新建会话开始。
      </div>
    );

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16, ease: "easeOut" }}
      className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-3"
    >
      {content}
    </motion.div>
  );
}

export function RunSummaryRow({
  status,
  stepCount,
  totalTokens,
  durationMs,
  errorMessage,
  canRetry,
  isRetrying,
  onRetry,
  expanded,
  onToggle,
}: {
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  stepCount: number;
  totalTokens: number | null;
  durationMs: number | null;
  errorMessage: string | null;
  canRetry?: boolean;
  isRetrying?: boolean;
  onRetry?: () => void;
  expanded?: boolean;
  onToggle?: () => void;
}) {
  const isRunning = status === "running" || status === "queued";
  const isFailed = status === "failed";
  const canExpand = isFailed && typeof errorMessage === "string" && errorMessage.trim().length > 0;
  const toneClassName = isFailed
    ? "border-accent-foreground/30 bg-accent-foreground/5 text-accent-foreground"
    : "border-border bg-editor-background text-foreground-muted";
  const statusIcon = isRunning
    ? "icon-[material-symbols--progress-activity] animate-spin text-accent-foreground"
    : isFailed
      ? "icon-[material-symbols--warning]"
      : status === "cancelled"
        ? "icon-[material-symbols--block]"
        : "icon-[material-symbols--check-circle]";
  const label = isRunning
    ? "正在生成回复..."
    : isFailed
      ? "生成失败"
      : status === "cancelled"
        ? "已取消"
        : "生成完成";
  const metrics = [
    durationMs != null ? formatDuration(durationMs) : null,
    stepCount > 0 ? `${stepCount} 步` : null,
    totalTokens != null ? `${totalTokens.toLocaleString("zh-CN")} tokens` : null,
  ].filter(Boolean);

  return (
    <div className={`overflow-hidden rounded-md border ${toneClassName}`}>
      <div className="flex min-h-8 items-center gap-2 px-2 py-1 text-[11px] leading-4">
        {canExpand ? (
          <button
            type="button"
            onClick={onToggle}
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
          >
            <span className={`shrink-0 text-[14px] ${statusIcon}`} />
            <span className="min-w-0 shrink-0">{label}</span>
            <span className="min-w-0 flex-1 truncate opacity-80">
              {metrics.length > 0 ? metrics.join(" / ") : "统计信息暂不可用"}
            </span>
            <span
              className={`shrink-0 text-[14px] ${
                expanded
                  ? "icon-[material-symbols--keyboard-arrow-up]"
                  : "icon-[material-symbols--keyboard-arrow-down]"
              }`}
            />
          </button>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className={`shrink-0 text-[14px] ${statusIcon}`} />
            <span className="min-w-0 shrink-0">{label}</span>
            <span className="min-w-0 flex-1 truncate opacity-80">
              {metrics.length > 0 ? metrics.join(" / ") : "统计信息暂不可用"}
            </span>
          </div>
        )}
        {canRetry && onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            disabled={isRetrying}
            className="inline-flex size-6 shrink-0 items-center justify-center rounded text-[14px] transition hover:bg-current/10 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label={isRetrying ? "重试中" : "重试"}
            title={isRetrying ? "重试中" : "重试"}
          >
            <span
              className={
                isRetrying
                  ? "icon-[material-symbols--progress-activity] animate-spin"
                  : "icon-[material-symbols--refresh]"
              }
            />
          </button>
        ) : null}
      </div>
      {canExpand && expanded ? (
        <div className="border-t border-current/10 px-2 py-1.5 text-[10px] leading-4 break-all whitespace-pre-wrap">
          {errorMessage}
        </div>
      ) : null}
    </div>
  );
}

function formatDuration(durationMs: number) {
  if (durationMs < 1000) {
    return `${Math.max(0, Math.round(durationMs))}ms`;
  }
  if (durationMs < 10_000) {
    return `${(durationMs / 1000).toFixed(1)}s`;
  }
  return `${Math.round(durationMs / 1000)}s`;
}

export { AnimatePresence };
