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

import type { AiProjectHeadView } from "@/modules/ai/domain/types";
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
        className="grid h-11 max-w-full min-w-0 flex-1 grid-cols-[auto_minmax(0,1fr)_auto] grid-rows-2 items-center gap-x-2 rounded-md border border-transparent px-1.5 py-1 text-left transition outline-none hover:border-border hover:bg-list-hover-background focus:border-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
        {...getReferenceProps()}
      >
        <span className="col-start-1 row-span-2 row-start-1 icon-[material-symbols--token] shrink-0 text-base text-accent-foreground" />
        <span className="col-start-2 row-start-1 min-w-0 self-end truncate text-[11px] leading-4 text-foreground-muted">
          {selectedConnection?.name ?? "连接"}
        </span>
        <span className="col-start-2 row-start-2 min-w-0 self-start truncate text-[12px] leading-4 font-medium text-foreground">
          {triggerLabel}
        </span>
        <span
          className={`col-start-3 row-span-2 row-start-1 shrink-0 text-base text-foreground-muted ${effectiveOpen ? "icon-[material-symbols--keyboard-arrow-up]" : "icon-[material-symbols--keyboard-arrow-down]"}`}
        />
      </button>

      {effectiveOpen ? (
        <FloatingPortal>
          <FloatingFocusManager context={context} modal={false}>
            <div
              ref={setFloating}
              style={floatingStyles}
              className="z-50 flex min-h-0 flex-col overflow-hidden border border-border bg-sidebar-background text-[12px] text-foreground outline-none"
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

export function ModelHint({
  canSend,
  hasActiveHead,
  selectedConnectionId,
  selectedModelId,
  hasDraft,
  isLoadingSelection,
  isGenerating,
  isSessionBusy,
  hasPendingAttempt,
  errorMessage,
}: {
  canSend: boolean;
  hasActiveHead: boolean;
  selectedConnectionId: string;
  selectedModelId: string;
  hasDraft: boolean;
  isLoadingSelection: boolean;
  isGenerating: boolean;
  isSessionBusy: boolean;
  hasPendingAttempt: boolean;
  errorMessage: string | null;
}) {
  if (errorMessage) {
    return (
      <>
        <span className="icon-[material-symbols--warning]" />
        <span>{errorMessage}</span>
      </>
    );
  }

  if (isLoadingSelection) {
    return (
      <>
        <span className="icon-[material-symbols--progress-activity]" />
        <span>正在加载模型选择...</span>
      </>
    );
  }

  if (!hasActiveHead) {
    return (
      <>
        <span className="icon-[material-symbols--chat-add-on]" />
        <span>先新建或切换到一个会话。</span>
      </>
    );
  }

  if (isSessionBusy) {
    return (
      <>
        <span className="icon-[material-symbols--progress-activity]" />
        <span>正在同步当前会话...</span>
      </>
    );
  }

  if (isGenerating || hasPendingAttempt) {
    return (
      <>
        <span className="icon-[material-symbols--progress-activity]" />
        <span>正在生成回复...</span>
      </>
    );
  }

  if (canSend) {
    return (
      <>
        <span className="icon-[material-symbols--chat]" />
        <span>当前会话已就绪。</span>
      </>
    );
  }

  if (!selectedConnectionId || !selectedModelId) {
    return (
      <>
        <span className="icon-[material-symbols--info]" />
        <span>需要可用连接和模型才能输入。</span>
      </>
    );
  }

  if (!hasDraft) {
    return (
      <>
        <span className="icon-[material-symbols--edit-note]" />
        <span>输入消息后即可发送。</span>
      </>
    );
  }

  return (
    <>
      <span className="icon-[material-symbols--info]" />
      <span>当前暂时无法发送。</span>
    </>
  );
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
  head,
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
  head: AiProjectHeadView;
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

  useEffect(() => {
    if (!isEditing) {
      return;
    }

    editingInputRef.current?.focus();
    editingInputRef.current?.select();
  }, [isEditing]);

  const titleLabel = isActive ? "当前会话" : head.isArchived ? "已归档" : "点击切换";
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
            head.isArchived
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
      {head.isArchived ? (
        <div className={rowContentClassName}>
          <span className="icon-[material-symbols--inventory-2] shrink-0 text-[16px] text-foreground-muted" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12px] font-medium">{head.name}</span>
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
            <span className="block truncate text-[12px] font-medium">{head.name}</span>
            <span className="block text-[10px] text-foreground-muted">{titleLabel}</span>
          </span>
        </button>
      )}
      <div className="flex shrink-0 items-center gap-1 opacity-0 transition group-focus-within:opacity-100 group-hover:opacity-100">
        {!head.isArchived ? (
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
  head,
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
  head: AiProjectHeadView;
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
        head={head}
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
      <div className="border border-dashed border-border bg-editor-background/95 px-3 py-2 text-[12px] text-foreground-muted backdrop-blur-sm">
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

export function PendingAssistantBubble({ label }: { label: string }) {
  return (
    <div className="flex justify-start">
      <div className="max-w-[88%] rounded-lg border border-border bg-editor-background px-3 py-2 text-[12px] text-foreground-muted">
        <div className="flex items-center gap-2">
          <span className="icon-[material-symbols--progress-activity] animate-spin text-sm text-accent-foreground" />
          <span>{label}</span>
        </div>
      </div>
    </div>
  );
}

export function AttemptErrorCard({
  message,
  canRetry,
  isRetrying,
  onRetry,
}: {
  message: string;
  canRetry: boolean;
  isRetrying: boolean;
  onRetry: () => void;
}) {
  return (
    <div className="mt-2 flex justify-start">
      <div className="max-w-[88%] rounded-lg border border-red-500/30 bg-red-500/8 px-3 py-2 text-[12px] text-red-200">
        <div className="flex items-start gap-2">
          <span className="icon-[material-symbols--warning]" />
          <div className="min-w-0 flex-1">
            <p className="leading-5">{message}</p>
            {canRetry ? (
              <button
                type="button"
                onClick={onRetry}
                disabled={isRetrying}
                className="mt-2 inline-flex items-center gap-1 border border-red-400/30 px-2 py-1 text-[11px] text-red-100 transition hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span
                  className={
                    isRetrying
                      ? "icon-[material-symbols--progress-activity] animate-spin"
                      : "icon-[material-symbols--refresh]"
                  }
                />
                <span>{isRetrying ? "重试中..." : "重试"}</span>
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

export { AnimatePresence };
