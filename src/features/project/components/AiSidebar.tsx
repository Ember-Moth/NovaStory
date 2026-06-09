import {
  FloatingFocusManager,
  FloatingList,
  FloatingPortal,
  autoUpdate,
  flip,
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

import { OverlayScrollbar } from "@/features/project/components/OverlayScrollbar";
import { rpc } from "@/server/rpc/client";

type ConnectionModelGroup = NonNullable<
  ReturnType<typeof rpc.useQuery<"ai.listEnabledConnectionModels">>["data"]
>[number];
type ResolvedModel = ConnectionModelGroup["models"][number];
type AiConnection = ConnectionModelGroup["connection"];

function ModelPicker({
  selectedConnectionId,
  selectedModelId,
  onSelectionChange,
}: {
  selectedConnectionId: string;
  selectedModelId: string;
  onSelectionChange: (_connectionId: string, _modelId: string) => void;
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
  const disabled = groupsQuery.isLoading || selectableOptions.length === 0;
  const loadingEmpty = groupsQuery.isLoading && groups.length === 0;
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
    if (groupsQuery.isLoading && selectableOptions.length === 0) {
      return;
    }

    if (selectableOptions.length === 0) {
      if (selectedConnectionId || selectedModelId) onSelectionChange("", "");
      return;
    }

    if (selectedOption) {
      return;
    }

    const firstOption = selectableOptions[0];
    onSelectionChange(firstOption?.connection.id ?? "", firstOption?.model.id ?? "");
  }, [
    groupsQuery.isLoading,
    onSelectionChange,
    selectableOptions,
    selectedConnectionId,
    selectedModelId,
    selectedOption,
  ]);

  function selectModel(connection: AiConnection, model: ResolvedModel) {
    onSelectionChange(connection.id, model.id);
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
        className="grid h-11 min-w-0 max-w-full flex-1 grid-cols-[auto_minmax(0,1fr)_auto] grid-rows-2 items-center gap-x-2 rounded border border-transparent px-1.5 py-1 text-left outline-none transition hover:border-border hover:bg-list-hover-background focus:border-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
        {...getReferenceProps()}
      >
        <span className="icon-[material-symbols--token] col-start-1 row-span-2 row-start-1 shrink-0 text-base text-accent-foreground" />
        <span className="col-start-2 row-start-1 min-w-0 self-end truncate text-[11px] leading-4 text-foreground-muted">
          {selectedConnection?.name ?? "连接"}
        </span>
        <span className="col-start-2 row-start-2 min-w-0 self-start truncate text-[12px] font-medium leading-4 text-foreground">
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
              className="z-50 flex min-h-0 flex-col overflow-hidden border border-border bg-sidebar-background text-[12px] text-foreground shadow-[0_6px_18px_rgb(0_0_0/0.35)] outline-none"
              {...getFloatingProps()}
            >
              <OverlayScrollbar variant="panel">
                <FloatingList elementsRef={listRef} labelsRef={labelsRef}>
                  {loadingEmpty ? (
                    <div className="px-2 py-2 text-foreground-muted">加载连接和模型中...</div>
                  ) : selectableOptions.length === 0 ? (
                    <div className="px-2 py-2 text-foreground-muted">没有可用连接模型</div>
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
      className={`flex w-full items-start gap-2 border-l-2 py-1.5 pl-2 pr-6 text-left outline-none ${
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

function ModelHint({ canType, selectedModelId }: { canType: boolean; selectedModelId: string }) {
  if (canType) {
    return (
      <>
        <span className="icon-[material-symbols--edit-note]" />
        <span>草稿仅保存在当前页面。</span>
      </>
    );
  }

  if (!selectedModelId) {
    return (
      <>
        <span className="icon-[material-symbols--info]" />
        <span>需要可用连接和模型才能输入。</span>
      </>
    );
  }

  return (
    <>
      <span className="icon-[material-symbols--info]" />
      <span>需要可用连接才能输入。</span>
    </>
  );
}

export function AiSidebar() {
  const [selectedConnectionId, setSelectedConnectionId] = useState("");
  const [selectedModelId, setSelectedModelId] = useState("");
  const [draft, setDraft] = useState("");
  const canType = Boolean(selectedConnectionId && selectedModelId);

  return (
    <aside className="flex h-full w-80 max-w-[38vw] min-w-72 shrink-0 flex-col overflow-hidden border-l border-border bg-sidebar-background">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-title-bar-background px-3">
        <span className="icon-[material-symbols--smart-toy] text-lg text-accent-foreground" />
        <span className="min-w-0 truncate text-[13px] font-medium text-foreground">AI 助手</span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-3">
        <div className="flex min-h-0 flex-1 flex-col justify-end gap-3 overflow-hidden">
          <div className="rounded-md border border-border bg-editor-background px-3 py-2">
            <div className="mb-2 flex items-center gap-2 text-[12px] text-foreground-muted">
              <span className="icon-[material-symbols--auto-awesome] text-sm text-accent-foreground" />
              <span>还没有对话内容</span>
            </div>
            <p className="text-[12px] leading-5 text-foreground-muted">
              选择模型后可以先输入提示词草稿，发送功能稍后接入。
            </p>
          </div>
        </div>

        <form className="shrink-0" aria-label="AI 对话输入">
          <div className="space-y-2">
            <div className="rounded-md border border-border bg-editor-background focus-within:border-accent-foreground">
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                disabled={!canType}
                rows={3}
                className="min-h-16 w-full resize-none border-none bg-transparent px-2.5 py-2 text-[13px] leading-5 text-editor-foreground outline-none placeholder:text-foreground-muted/70 disabled:cursor-not-allowed disabled:opacity-70"
                placeholder={canType ? "输入消息..." : "选择可用模型后输入..."}
              />
              <div className="flex min-w-0 items-center gap-2 border-t border-border px-1.5 py-1.5">
                <ModelPicker
                  selectedConnectionId={selectedConnectionId}
                  selectedModelId={selectedModelId}
                  onSelectionChange={(connectionId, modelId) => {
                    setSelectedConnectionId(connectionId);
                    setSelectedModelId(modelId);
                  }}
                />
                <button
                  type="button"
                  disabled
                  title="发送功能尚未接入"
                  aria-label="发送"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded text-foreground-muted transition disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <span className="icon-[material-symbols--send] text-xl" />
                </button>
              </div>
            </div>

            <div
              className={`flex items-center gap-1.5 text-[11px] ${
                canType ? "text-foreground-muted" : "text-accent-foreground"
              }`}
            >
              <ModelHint canType={canType} selectedModelId={selectedModelId} />
            </div>
          </div>
        </form>
      </div>
    </aside>
  );
}
