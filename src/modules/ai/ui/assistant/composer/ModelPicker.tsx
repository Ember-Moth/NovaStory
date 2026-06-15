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

import { rpc } from "@/rpc/client";
import { OverlayScrollbar } from "@/shared/ui/OverlayScrollbar";

import { formatModelCapabilities } from "../../shared/modelSelection/formatModelCapabilities";
import { normalizeConnectionModels } from "../../shared/modelSelection/normalizeConnectionModels";

type ConnectionModelGroup = NonNullable<
  ReturnType<typeof rpc.useQuery<"ai.listEnabledConnectionModels">>["data"]
>[number];
type ResolvedModel = ConnectionModelGroup["models"][number];
type AiConnection = ConnectionModelGroup["connection"];

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
  const capabilities = formatModelCapabilities(model);

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
      normalizeConnectionModels(groupsQuery.data) as Array<{
        connection: AiConnection;
        models: ResolvedModel[];
      }>,
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
    if (!selectionHydrated || groupsQuery.data === undefined) {
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
