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
import {
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type {
  AiProjectGenerationAttemptView,
  AiProjectHeadView,
  AiProjectMessageView,
} from "@/modules/ai/domain/types";
import { OverlayScrollbar } from "@/shared/ui/OverlayScrollbar";
import { rpc } from "@/rpc/client";

type ConnectionModelGroup = NonNullable<
  ReturnType<typeof rpc.useQuery<"ai.listEnabledConnectionModels">>["data"]
>[number];
type ResolvedModel = ConnectionModelGroup["models"][number];
type AiConnection = ConnectionModelGroup["connection"];

function ModelPicker({
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
    label: `${connection.name} ${model.displayName} ${model.modelId}`,
  });
  const capabilities = getModelCapabilities(model);

  return (
    <button
      ref={ref}
      type="button"
      role="option"
      aria-selected={selected}
      tabIndex={active ? 0 : -1}
      className={`flex w-full items-start gap-2 border-l-2 py-1.5 pr-6 pl-2 text-left outline-none ${
        active ? "bg-list-hover-background" : "bg-transparent"
      } ${
        selected
          ? "border-accent-foreground text-foreground"
          : "border-transparent text-foreground-muted"
      }`}
      {...getItemProps({
        onClick: () => onSelect(connection, model),
        onKeyDown: (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelect(connection, model);
          }
        },
      })}
    >
      <span
        className={`mt-0.5 w-4 shrink-0 text-sm ${
          selected ? "icon-[material-symbols--check] text-accent-foreground" : ""
        }`}
        aria-hidden
      />
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-[12px] ${selected ? "text-foreground" : ""}`}>
          {model.displayName}
        </span>
        <span className="mt-0.5 flex min-w-0 flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-foreground-muted">
          <span className="min-w-0 truncate font-mono">{model.modelId}</span>
          {capabilities.map((capability) => (
            <span key={capability}>{capability}</span>
          ))}
        </span>
      </span>
    </button>
  );
}

function getModelCapabilities(model: ResolvedModel) {
  return [
    model.supportsReasoning ? "推理" : null,
    model.supportsToolUse ? "工具" : null,
    model.supportsVision ? "视觉" : null,
  ].filter((capability): capability is string => capability !== null);
}

type AssistantState = {
  head: AiProjectHeadView | null;
  messages: AiProjectMessageView[];
  attempts: AiProjectGenerationAttemptView[];
};

type AssistantMutationContext = {
  previousState?: AssistantState;
};

type PendingAssistantAction =
  | {
      kind: "send";
      text: string;
    }
  | {
      kind: "retry";
      triggerMessageId: string;
    };

type EditingHeadState = {
  headId: string;
  name: string;
};

const EMPTY_ASSISTANT_STATE: AssistantState = {
  head: null,
  messages: [],
  attempts: [],
};

const EMPTY_HEADS: AiProjectHeadView[] = [];
const HEAD_ROW_HEIGHT = 44;
const SHEET_HANDLE_HEIGHT = 16;
const SESSION_PEEK_HEIGHT = HEAD_ROW_HEIGHT * 3;
const PEEK_TO_EXPANDED_SNAP_RATIO = 0.3;
const PEEK_TO_EXPANDED_SNAP_MAX_PX = 72;

export type SheetState = "closed" | "peek" | "expanded";

export type SheetAnchors = Record<SheetState, number>;

export function clampSessionSectionHeight(height: number, maxHeight: number) {
  return Math.min(Math.max(0, height), Math.max(0, maxHeight));
}

export function resolveNearestSheetState(height: number, anchors: SheetAnchors): SheetState {
  const orderedStates: SheetState[] = ["closed", "peek", "expanded"];

  return orderedStates.reduce((nearest, current) =>
    Math.abs(anchors[current] - height) < Math.abs(anchors[nearest] - height) ? current : nearest,
  );
}

export function resolveReleasedSheetState({
  height,
  anchors,
  startState,
}: {
  height: number;
  anchors: SheetAnchors;
  startState: SheetState;
}) {
  if (startState === "peek" && anchors.expanded > anchors.peek) {
    const expandedThresholdOffset = Math.min(
      anchors.expanded - anchors.peek,
      Math.min(
        PEEK_TO_EXPANDED_SNAP_MAX_PX,
        (anchors.expanded - anchors.peek) * PEEK_TO_EXPANDED_SNAP_RATIO,
      ),
    );
    const expandedThreshold = anchors.peek + expandedThresholdOffset;
    if (height >= expandedThreshold) {
      return "expanded";
    }
  }

  if (startState === "expanded" && anchors.expanded > anchors.peek) {
    const peekThresholdOffset = Math.min(
      anchors.expanded - anchors.peek,
      Math.min(
        PEEK_TO_EXPANDED_SNAP_MAX_PX,
        (anchors.expanded - anchors.peek) * PEEK_TO_EXPANDED_SNAP_RATIO,
      ),
    );
    const peekThreshold = anchors.expanded - peekThresholdOffset;
    if (height <= peekThreshold) {
      return "peek";
    }
  }

  return resolveNearestSheetState(height, anchors);
}

export function resolvePeekSessionHeight({ maxHeight }: { maxHeight: number }) {
  return clampSessionSectionHeight(SESSION_PEEK_HEIGHT, maxHeight);
}

function getMessageText(content: unknown) {
  if (!content || typeof content !== "object") {
    return "";
  }

  const text = Reflect.get(content as Record<string, unknown>, "text");
  return typeof text === "string" ? text : "";
}

function appendUniqueMessage(messages: AiProjectMessageView[], message: AiProjectMessageView) {
  if (messages.some((current) => current.id === message.id)) {
    return messages;
  }

  return [...messages, message];
}

function upsertAttempt(
  attempts: AiProjectGenerationAttemptView[],
  attempt: AiProjectGenerationAttemptView,
) {
  const filtered = attempts.filter((current) => current.id !== attempt.id);
  return [...filtered, attempt].sort((left, right) => left.createdAt - right.createdAt);
}

export function selectRetryableAttempt(
  state: AssistantState | null | undefined,
): AiProjectGenerationAttemptView | null {
  const latest = state?.attempts.at(-1) ?? null;
  if (!latest || latest.status !== "error" || !latest.triggerMessageId) {
    return null;
  }

  return latest;
}

export function selectPendingAttempt(
  state: AssistantState | null | undefined,
): AiProjectGenerationAttemptView | null {
  const latest = state?.attempts.at(-1) ?? null;
  if (!latest || latest.status !== "pending" || !latest.triggerMessageId) {
    return null;
  }

  return latest;
}

export function canSendAssistantMessage({
  draft,
  headId,
  selectedConnectionId,
  selectedModelId,
  selectionHydrated,
  isBusy,
  hasPendingAttempt,
}: {
  draft: string;
  headId: string | null;
  selectedConnectionId: string;
  selectedModelId: string;
  selectionHydrated: boolean;
  isBusy: boolean;
  hasPendingAttempt: boolean;
}) {
  return (
    selectionHydrated &&
    headId != null &&
    selectedConnectionId.length > 0 &&
    selectedModelId.length > 0 &&
    draft.trim().length > 0 &&
    !isBusy &&
    !hasPendingAttempt
  );
}

function applySendResultToState(
  state: AssistantState | null | undefined,
  result: {
    head: AiProjectHeadView;
    userMessage: AiProjectMessageView;
    assistantMessage: AiProjectMessageView;
    attempt: AiProjectGenerationAttemptView;
  },
): AssistantState {
  const base = state?.head?.id === result.head.id ? state : EMPTY_ASSISTANT_STATE;

  return {
    head: result.head,
    messages: appendUniqueMessage(
      appendUniqueMessage(base.messages, result.userMessage),
      result.assistantMessage,
    ),
    attempts: upsertAttempt(base.attempts, result.attempt),
  };
}

function applyRetryResultToState(
  state: AssistantState | null | undefined,
  result: {
    head: AiProjectHeadView;
    assistantMessage: AiProjectMessageView;
    attempt: AiProjectGenerationAttemptView;
  },
): AssistantState {
  const base = state?.head?.id === result.head.id ? state : EMPTY_ASSISTANT_STATE;

  return {
    head: result.head,
    messages: appendUniqueMessage(base.messages, result.assistantMessage),
    attempts: upsertAttempt(base.attempts, result.attempt),
  };
}

function getAttemptErrorMessage(error: unknown) {
  if (!error || typeof error !== "object") {
    return "AI 回复失败。";
  }

  const message = Reflect.get(error as Record<string, unknown>, "message");
  return typeof message === "string" && message.trim().length > 0 ? message : "AI 回复失败。";
}

function ModelHint({
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
      className="flex size-6 items-center justify-center text-foreground-muted transition hover:bg-list-hover-background hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
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
  if (isEditing) {
    return (
      <div
        className="flex items-center gap-2 overflow-hidden border border-border bg-editor-background px-2"
        style={{ height: `${HEAD_ROW_HEIGHT}px` }}
      >
        <input
          value={editingName}
          onChange={(event) => onEditingNameChange(event.target.value)}
          disabled={isBusy}
          autoFocus
          className="min-w-0 flex-1 border border-border bg-sidebar-background px-2 py-1 text-[12px] text-foreground outline-none focus:border-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
          placeholder="会话名称"
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onRenameSubmit();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              onRenameCancel();
            }
          }}
        />
        <SessionActionButton
          icon="icon-[material-symbols--check]"
          label="保存会话名称"
          disabled={isBusy}
          onClick={onRenameSubmit}
        />
        <SessionActionButton
          icon="icon-[material-symbols--close]"
          label="取消重命名"
          disabled={isBusy}
          onClick={onRenameCancel}
        />
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onActivate}
      disabled={isBusy || head.isArchived}
      style={{ height: `${HEAD_ROW_HEIGHT}px` }}
      className={`group flex w-full items-center gap-2 px-3 py-2 text-left transition ${
        isActive
          ? "bg-list-active-background text-foreground"
          : "text-foreground-muted hover:bg-list-hover-background hover:text-foreground"
      } overflow-hidden disabled:cursor-not-allowed disabled:opacity-50`}
    >
      <span
        className={`shrink-0 text-[16px] ${
          head.isArchived
            ? "icon-[material-symbols--inventory-2] text-foreground-muted"
            : isActive
              ? "icon-[material-symbols--chat] text-accent-foreground"
              : "icon-[material-symbols--chat-outline]"
        }`}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] font-medium">{head.name}</span>
        <span className="block text-[10px] text-foreground-muted">
          {isActive ? "当前会话" : head.isArchived ? "已归档" : "点击切换"}
        </span>
      </span>
      <div className="flex shrink-0 items-center gap-1 opacity-0 transition group-hover:opacity-100">
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
    </button>
  );
}

function PendingAssistantBubble({ label }: { label: string }) {
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

function AttemptErrorCard({
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

export function AiSidebar({ projectId }: { projectId: string }) {
  const [selectedConnectionId, setSelectedConnectionId] = useState("");
  const [selectedModelId, setSelectedModelId] = useState("");
  const [draft, setDraft] = useState("");
  const [selectionHydrated, setSelectionHydrated] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAssistantAction | null>(null);
  const [editingHead, setEditingHead] = useState<EditingHeadState | null>(null);
  const [showArchivedHeads, setShowArchivedHeads] = useState(false);
  const [expectedActiveHeadId, setExpectedActiveHeadId] = useState<string | null>(null);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [sheetState, setSheetState] = useState<SheetState>("peek");
  const [sessionSectionHeight, setSessionSectionHeight] = useState(0);
  const [availableBodyHeight, setAvailableBodyHeight] = useState(0);
  const [isDraggingSheet, setIsDraggingSheet] = useState(false);
  const bodyFrameRef = useRef<HTMLDivElement>(null);
  const sessionSectionHeightRef = useRef(0);
  const sheetDragRef = useRef<{
    pointerId: number;
    startY: number;
    startHeight: number;
    startState: SheetState;
  } | null>(null);
  const storedSelectionQuery = rpc.useQuery("config.getAiAssistantModelSelection");
  const projectHeadsQuery = rpc.useQuery("ai.listProjectHeads", { projectId });
  const assistantStateQuery = rpc.useQuery("ai.getProjectAssistantState", { projectId });
  const saveSelection = rpc.useMutation("config.setAiAssistantModelSelection", {
    onSuccess: (selection) => {
      rpc.setQueryData("config.getAiAssistantModelSelection", undefined, selection);
    },
  });
  const createSession = rpc.useMutation("ai.createProjectAssistantSession");
  const setActiveHead = rpc.useMutation("ai.setProjectAssistantActiveHead");
  const renameProjectHead = rpc.useMutation("ai.renameProjectHead");
  const archiveProjectHead = rpc.useMutation("ai.archiveHead");
  const sendMessage = rpc.useMutation<"ai.sendProjectAssistantMessage", AssistantMutationContext>(
    "ai.sendProjectAssistantMessage",
    {
      onMutate: () => ({
        previousState: rpc.getQueryData("ai.getProjectAssistantState", { projectId }),
      }),
      onSuccess: (result) => {
        const previousState = rpc.getQueryData("ai.getProjectAssistantState", { projectId });
        rpc.setQueryData(
          "ai.getProjectAssistantState",
          { projectId },
          applySendResultToState(previousState, result),
        );
      },
      onError: (_, __, context) => {
        if (context?.previousState) {
          rpc.setQueryData("ai.getProjectAssistantState", { projectId }, context.previousState);
        }
      },
    },
  );
  const retryMessage = rpc.useMutation<"ai.retryProjectAssistantMessage", AssistantMutationContext>(
    "ai.retryProjectAssistantMessage",
    {
      onMutate: () => ({
        previousState: rpc.getQueryData("ai.getProjectAssistantState", { projectId }),
      }),
      onSuccess: (result) => {
        const previousState = rpc.getQueryData("ai.getProjectAssistantState", { projectId });
        rpc.setQueryData(
          "ai.getProjectAssistantState",
          { projectId },
          applyRetryResultToState(previousState, result),
        );
      },
      onError: (_, __, context) => {
        if (context?.previousState) {
          rpc.setQueryData("ai.getProjectAssistantState", { projectId }, context.previousState);
        }
      },
    },
  );
  const isLoadingSelection = !selectionHydrated;
  const assistantState = assistantStateQuery.data ?? EMPTY_ASSISTANT_STATE;
  const activeHeadId = assistantState.head?.id ?? null;
  const heads = projectHeadsQuery.data ?? EMPTY_HEADS;
  const unarchivedHeads = useMemo(() => heads.filter((head) => !head.isArchived), [heads]);
  const archivedHeads = useMemo(() => heads.filter((head) => head.isArchived), [heads]);
  const retryableAttempt = selectRetryableAttempt(assistantStateQuery.data);
  const pendingAttempt = selectPendingAttempt(assistantStateQuery.data);
  const isGenerating = sendMessage.isPending || retryMessage.isPending;
  const isSessionMutating =
    createSession.isPending ||
    setActiveHead.isPending ||
    renameProjectHead.isPending ||
    archiveProjectHead.isPending;
  const isSessionBusy = isSessionMutating || expectedActiveHeadId !== null;
  const isBusy = isGenerating || isSessionBusy;
  const canSubmit = canSendAssistantMessage({
    draft,
    headId: activeHeadId,
    selectedConnectionId,
    selectedModelId,
    selectionHydrated,
    isBusy,
    hasPendingAttempt: pendingAttempt != null,
  });
  const messages = assistantState.messages;
  const showEmptyState = messages.length === 0 && pendingAction?.kind !== "send";
  const sheetAnchors = useMemo<SheetAnchors>(
    () => ({
      closed: 0,
      peek: resolvePeekSessionHeight({ maxHeight: availableBodyHeight }),
      expanded: clampSessionSectionHeight(
        availableBodyHeight - SHEET_HANDLE_HEIGHT,
        availableBodyHeight,
      ),
    }),
    [availableBodyHeight],
  );
  const clampedSessionSectionHeight = clampSessionSectionHeight(
    sessionSectionHeight,
    sheetAnchors.expanded,
  );
  const messageSheetHeight = clampSessionSectionHeight(
    availableBodyHeight - clampedSessionSectionHeight,
    availableBodyHeight,
  );
  const sectionHeightTransitionClass = isDraggingSheet
    ? ""
    : "transition-[height] duration-200 ease-out motion-reduce:transition-none";

  useEffect(() => {
    if (expectedActiveHeadId === null) {
      return;
    }

    if (
      (expectedActiveHeadId === "" && activeHeadId === null) ||
      expectedActiveHeadId === activeHeadId
    ) {
      setExpectedActiveHeadId(null);
    }
  }, [activeHeadId, expectedActiveHeadId]);

  useEffect(() => {
    if (selectionHydrated) {
      return;
    }

    const hasResolvedStoredSelection =
      storedSelectionQuery.data !== undefined || storedSelectionQuery.error !== null;
    if (!hasResolvedStoredSelection) {
      return;
    }

    setSelectedConnectionId(storedSelectionQuery.data?.connectionId ?? "");
    setSelectedModelId(storedSelectionQuery.data?.modelId ?? "");
    setSelectionHydrated(true);
  }, [selectionHydrated, storedSelectionQuery.data, storedSelectionQuery.error]);

  useEffect(() => {
    sessionSectionHeightRef.current = clampedSessionSectionHeight;
  }, [clampedSessionSectionHeight]);

  useEffect(() => {
    const frame = bodyFrameRef.current;
    if (!frame) {
      return;
    }

    const measureLayout = () => {
      setAvailableBodyHeight(Math.round(frame.getBoundingClientRect().height));
    };

    measureLayout();

    const observer = new ResizeObserver(() => {
      measureLayout();
    });
    observer.observe(frame);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (isDraggingSheet) {
      return;
    }

    setSessionSectionHeight(sheetAnchors[sheetState]);
  }, [isDraggingSheet, sheetAnchors, sheetState]);

  useEffect(() => {
    return () => {
      document.body.style.cursor = "";
    };
  }, []);

  const handleSelectionChange = useCallback((connectionId: string, modelId: string) => {
    setSelectedConnectionId(connectionId);
    setSelectedModelId(modelId);
  }, []);

  const handleSelectionCommit = useCallback(
    (connectionId: string, modelId: string) => {
      handleSelectionChange(connectionId, modelId);
      void saveSelection.mutate(
        connectionId && modelId
          ? {
              connectionId,
              modelId,
            }
          : null,
      );
    },
    [handleSelectionChange, saveSelection],
  );

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!canSubmit || !activeHeadId) {
        return;
      }

      const text = draft.trim();
      setComposerError(null);
      setPendingAction({ kind: "send", text });
      setDraft("");

      try {
        await sendMessage.mutate({ projectId, headId: activeHeadId, text });
      } catch (error) {
        setDraft(text);
        setComposerError(error instanceof Error ? error.message : "发送消息失败。");
      } finally {
        setPendingAction(null);
      }
    },
    [activeHeadId, canSubmit, draft, projectId, sendMessage],
  );

  const handleRetry = useCallback(
    async (triggerMessageId: string) => {
      if (!activeHeadId) {
        return;
      }

      setComposerError(null);
      setPendingAction({ kind: "retry", triggerMessageId });

      try {
        await retryMessage.mutate({ projectId, headId: activeHeadId, triggerMessageId });
      } catch (error) {
        setComposerError(error instanceof Error ? error.message : "重试失败。");
      } finally {
        setPendingAction(null);
      }
    },
    [activeHeadId, projectId, retryMessage],
  );

  const handleCreateSession = useCallback(async () => {
    setComposerError(null);
    setEditingHead(null);

    try {
      const head = await createSession.mutate({ projectId });
      setExpectedActiveHeadId(head.id);
    } catch (error) {
      setComposerError(error instanceof Error ? error.message : "新建会话失败。");
    }
  }, [createSession, projectId]);

  const handleActivateHead = useCallback(
    async (headId: string) => {
      if (headId === activeHeadId || isSessionBusy) {
        return;
      }

      setComposerError(null);
      setEditingHead(null);
      setExpectedActiveHeadId(headId);

      try {
        await setActiveHead.mutate({ projectId, headId });
      } catch (error) {
        setExpectedActiveHeadId(null);
        setComposerError(error instanceof Error ? error.message : "切换会话失败。");
      }
    },
    [activeHeadId, isSessionBusy, projectId, setActiveHead],
  );

  const handleRenameSubmit = useCallback(async () => {
    if (!editingHead) {
      return;
    }

    setComposerError(null);

    try {
      await renameProjectHead.mutate({
        headId: editingHead.headId,
        name: editingHead.name,
      });
      setEditingHead(null);
    } catch (error) {
      setComposerError(error instanceof Error ? error.message : "重命名会话失败。");
    }
  }, [editingHead, renameProjectHead]);

  const handleArchiveToggle = useCallback(
    async (head: AiProjectHeadView, archived: boolean) => {
      setComposerError(null);
      setEditingHead((current) => (current?.headId === head.id ? null : current));

      if (archived && head.id === activeHeadId) {
        const fallbackHead = unarchivedHeads.find((current) => current.id !== head.id) ?? null;
        setExpectedActiveHeadId(fallbackHead?.id ?? "");
      }

      if (!archived && activeHeadId == null) {
        setExpectedActiveHeadId(head.id);
      }

      try {
        await archiveProjectHead.mutate({ headId: head.id, archived });
      } catch (error) {
        setExpectedActiveHeadId(null);
        setComposerError(error instanceof Error ? error.message : "更新会话状态失败。");
      }
    },
    [activeHeadId, archiveProjectHead, unarchivedHeads],
  );

  const handleSheetPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (availableBodyHeight <= 0) {
        return;
      }

      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      sheetDragRef.current = {
        pointerId: event.pointerId,
        startY: event.clientY,
        startHeight: sessionSectionHeightRef.current,
        startState: sheetState,
      };
      setIsDraggingSheet(true);
      document.body.style.cursor = "row-resize";
    },
    [availableBodyHeight, sheetState],
  );

  const handleSheetPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const dragState = sheetDragRef.current;
      if (!dragState || dragState.pointerId !== event.pointerId) {
        return;
      }

      setSessionSectionHeight(
        clampSessionSectionHeight(
          dragState.startHeight + (event.clientY - dragState.startY),
          sheetAnchors.expanded,
        ),
      );
    },
    [sheetAnchors.expanded],
  );

  const finishSheetDrag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const dragState = sheetDragRef.current;
      if (!dragState || dragState.pointerId !== event.pointerId) {
        return;
      }

      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }

      sheetDragRef.current = null;
      setIsDraggingSheet(false);
      document.body.style.cursor = "";

      const nextHeight = clampSessionSectionHeight(
        sessionSectionHeightRef.current,
        sheetAnchors.expanded,
      );
      const nextState = resolveReleasedSheetState({
        height: nextHeight,
        anchors: sheetAnchors,
        startState: dragState.startState,
      });
      setSheetState(nextState);
      setSessionSectionHeight(sheetAnchors[nextState]);
    },
    [sheetAnchors],
  );

  const handleHeadActivate = useCallback(
    (headId: string) => {
      if (sheetState === "expanded") {
        setSheetState("peek");
      }
      void handleActivateHead(headId);
    },
    [handleActivateHead, sheetState],
  );

  return (
    <aside className="flex h-full w-80 max-w-[38vw] min-w-72 shrink-0 flex-col overflow-hidden border-l border-border bg-sidebar-background">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-title-bar-background px-3">
        <span className="icon-[material-symbols--smart-toy] text-lg text-accent-foreground" />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
          AI 助手
        </span>
        <button
          type="button"
          onClick={() => void handleCreateSession()}
          disabled={isSessionMutating}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-[11px] text-foreground-muted transition hover:bg-list-hover-background hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span className="icon-[material-symbols--add]" />
          <span>新建会话</span>
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div
          ref={bodyFrameRef}
          className="flex min-h-0 flex-1 flex-col overflow-hidden bg-editor-background"
        >
          <div
            style={{ height: `${clampedSessionSectionHeight}px` }}
            className={`min-h-0 shrink-0 overflow-hidden ${sectionHeightTransitionClass}`}
          >
            <div className="flex h-full min-h-0 flex-col bg-editor-background">
              <OverlayScrollbar variant="panel">
                <div className="flex min-h-full flex-col">
                  {projectHeadsQuery.isInitialLoading && heads.length === 0 ? (
                    <div className="px-3 py-1.5 text-[12px] text-foreground-muted">
                      正在加载会话...
                    </div>
                  ) : null}

                  {unarchivedHeads.length === 0 ? (
                    <div className="mx-3 border border-dashed border-border px-3 py-2 text-[12px] text-foreground-muted">
                      还没有可用会话。点击右上角新建会话开始。
                    </div>
                  ) : (
                    unarchivedHeads.map((head) => (
                      <div key={head.id}>
                        <HeadRow
                          head={head}
                          isActive={head.id === activeHeadId}
                          isEditing={editingHead?.headId === head.id}
                          editingName={editingHead?.headId === head.id ? editingHead.name : ""}
                          isBusy={isSessionMutating}
                          onActivate={() => handleHeadActivate(head.id)}
                          onEditingNameChange={(value) =>
                            setEditingHead({ headId: head.id, name: value })
                          }
                          onRenameStart={() => setEditingHead({ headId: head.id, name: head.name })}
                          onRenameCancel={() => setEditingHead(null)}
                          onRenameSubmit={() => void handleRenameSubmit()}
                          onArchive={() => void handleArchiveToggle(head, true)}
                          onRestore={() => void handleArchiveToggle(head, false)}
                        />
                      </div>
                    ))
                  )}

                  {archivedHeads.length > 0 ? (
                    <div className="mt-1 border-t border-border pt-1.5">
                      <button
                        type="button"
                        onClick={() => setShowArchivedHeads((current) => !current)}
                        className="flex w-full items-center justify-between px-3 py-1.5 text-[11px] text-foreground-muted transition hover:bg-list-hover-background hover:text-foreground"
                      >
                        <span>归档会话</span>
                        <span className="flex items-center gap-1">
                          <span>{archivedHeads.length}</span>
                          <span
                            className={
                              showArchivedHeads
                                ? "icon-[material-symbols--expand-less]"
                                : "icon-[material-symbols--expand-more]"
                            }
                          />
                        </span>
                      </button>
                      {showArchivedHeads ? (
                        <div className="mt-1 flex flex-col gap-1 pb-1">
                          {archivedHeads.map((head) => (
                            <div key={head.id}>
                              <HeadRow
                                head={head}
                                isActive={head.id === activeHeadId}
                                isEditing={editingHead?.headId === head.id}
                                editingName={
                                  editingHead?.headId === head.id ? editingHead.name : ""
                                }
                                isBusy={isSessionMutating}
                                onActivate={() => handleHeadActivate(head.id)}
                                onEditingNameChange={(value) =>
                                  setEditingHead({ headId: head.id, name: value })
                                }
                                onRenameStart={() =>
                                  setEditingHead({ headId: head.id, name: head.name })
                                }
                                onRenameCancel={() => setEditingHead(null)}
                                onRenameSubmit={() => void handleRenameSubmit()}
                                onArchive={() => void handleArchiveToggle(head, true)}
                                onRestore={() => void handleArchiveToggle(head, false)}
                              />
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </OverlayScrollbar>
            </div>
          </div>

          <div
            style={{ height: `${messageSheetHeight}px` }}
            className={`min-h-0 shrink-0 overflow-hidden bg-editor-background ${
              clampedSessionSectionHeight > 0 && messageSheetHeight > 0
                ? "border-t border-border"
                : ""
            } ${sectionHeightTransitionClass}`}
          >
            <div className="flex h-full min-h-0 flex-col bg-editor-background">
              <div
                aria-label="调整会话列表和消息区域"
                className="flex h-4 shrink-0 cursor-row-resize touch-none items-center justify-center border-b border-border bg-sidebar-background"
                onPointerDown={handleSheetPointerDown}
                onPointerMove={handleSheetPointerMove}
                onPointerUp={finishSheetDrag}
                onPointerCancel={finishSheetDrag}
              >
                <span
                  className={`h-px w-8 ${isDraggingSheet ? "bg-accent-foreground" : "bg-foreground-muted"}`}
                />
              </div>

              <div className="min-h-0 flex-1 overflow-hidden">
                <OverlayScrollbar variant="panel">
                  <div className="flex min-h-full flex-col gap-2.5 px-2.5 py-2">
                    {assistantStateQuery.isInitialLoading && showEmptyState ? (
                      <div className="border border-border bg-sidebar-background px-3 py-2 text-[12px] text-foreground-muted">
                        正在加载会话...
                      </div>
                    ) : null}

                    {showEmptyState ? (
                      <div className="border border-border bg-sidebar-background px-3 py-2">
                        <div className="mb-2 flex items-center gap-2 text-[12px] text-foreground-muted">
                          <span className="icon-[material-symbols--auto-awesome] text-sm text-accent-foreground" />
                          <span>{activeHeadId ? "这个会话还没有对话内容" : "还没有当前会话"}</span>
                        </div>
                        <p className="text-[12px] leading-5 text-foreground-muted">
                          {activeHeadId
                            ? "选择模型后可以直接开始对话。"
                            : "先新建一个会话，或从上方切换到已有会话。"}
                        </p>
                      </div>
                    ) : null}

                    {messages.map((message) => {
                      const text = getMessageText(message.content);
                      const isUser = message.role === "user";
                      const showRetryError = retryableAttempt?.triggerMessageId === message.id;
                      const showServerPending = pendingAttempt?.triggerMessageId === message.id;
                      const showLocalRetryPending =
                        pendingAction?.kind === "retry" &&
                        pendingAction.triggerMessageId === message.id;

                      return (
                        <div key={message.id}>
                          <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
                            <div
                              className={`max-w-[88%] rounded-lg px-3 py-2 text-[13px] leading-5 whitespace-pre-wrap ${
                                isUser
                                  ? "bg-accent-foreground text-sidebar-background"
                                  : "border border-border bg-sidebar-background text-foreground"
                              }`}
                            >
                              {text || " "}
                            </div>
                          </div>

                          {showRetryError ? (
                            <AttemptErrorCard
                              message={getAttemptErrorMessage(retryableAttempt.error)}
                              canRetry={!isBusy}
                              isRetrying={retryMessage.isPending}
                              onRetry={() => void handleRetry(message.id)}
                            />
                          ) : null}

                          {showServerPending || showLocalRetryPending ? (
                            <div className="mt-2">
                              <PendingAssistantBubble label="正在生成回复..." />
                            </div>
                          ) : null}
                        </div>
                      );
                    })}

                    {pendingAction?.kind === "send" ? (
                      <>
                        <div className="flex justify-end">
                          <div className="max-w-[88%] rounded-lg bg-accent-foreground px-3 py-2 text-[13px] leading-5 whitespace-pre-wrap text-sidebar-background">
                            {pendingAction.text}
                          </div>
                        </div>
                        <PendingAssistantBubble label="正在生成回复..." />
                      </>
                    ) : null}
                  </div>
                </OverlayScrollbar>
              </div>

              <form
                className="shrink-0 border-t border-border"
                aria-label="AI 对话输入"
                onSubmit={handleSubmit}
              >
                <div className="space-y-2 p-2">
                  <div className="overflow-hidden rounded-lg border border-border bg-editor-background focus-within:border-accent-foreground">
                    <textarea
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      disabled={
                        isLoadingSelection ||
                        !selectedModelId ||
                        !selectedConnectionId ||
                        activeHeadId == null ||
                        isBusy
                      }
                      rows={3}
                      className="min-h-16 w-full resize-none border-none bg-transparent px-2.5 py-2 text-[13px] leading-5 text-editor-foreground outline-none placeholder:text-foreground-muted/70 disabled:cursor-not-allowed disabled:opacity-70"
                      placeholder={
                        isLoadingSelection
                          ? "加载模型选择中..."
                          : activeHeadId == null
                            ? "先新建或切换到一个会话..."
                            : selectedConnectionId && selectedModelId
                              ? "输入消息..."
                              : "选择可用模型后输入..."
                      }
                    />
                    <div className="flex min-w-0 items-center gap-2 border-t border-border p-1.5">
                      <ModelPicker
                        selectedConnectionId={selectedConnectionId}
                        selectedModelId={selectedModelId}
                        selectionHydrated={selectionHydrated}
                        onSelectionChange={handleSelectionChange}
                        onSelectionCommit={handleSelectionCommit}
                      />
                      <button
                        type="submit"
                        disabled={!canSubmit}
                        title={canSubmit ? "发送" : "当前无法发送"}
                        aria-label="发送"
                        className="flex size-9 shrink-0 items-center justify-center rounded-md text-foreground-muted transition hover:bg-list-hover-background disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <span
                          className={`text-xl ${
                            isBusy
                              ? "icon-[material-symbols--progress-activity] animate-spin"
                              : "icon-[material-symbols--send]"
                          }`}
                        />
                      </button>
                    </div>
                  </div>

                  <div
                    className={`flex items-center gap-1.5 text-[11px] ${
                      canSubmit ? "text-foreground-muted" : "text-accent-foreground"
                    }`}
                  >
                    <ModelHint
                      canSend={canSubmit}
                      hasActiveHead={activeHeadId != null}
                      selectedConnectionId={selectedConnectionId}
                      selectedModelId={selectedModelId}
                      hasDraft={draft.trim().length > 0}
                      isLoadingSelection={isLoadingSelection}
                      isGenerating={isGenerating}
                      isSessionBusy={isSessionBusy}
                      hasPendingAttempt={pendingAttempt != null}
                      errorMessage={composerError}
                    />
                  </div>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
