import { Reorder, useDragControls } from "motion/react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { InlineEditableText } from "@/shared/ui/InlineEditableText";
import { RefreshOverlay } from "@/shared/ui/RefreshOverlay";
import { RowActionButton, SidebarListRow } from "@/shared/ui/tree";
import { actionAnchorId } from "@/modules/workspace/ui/editor/model/action-error";
import { cn } from "@/shared/lib/cn";

import type { TimelinePointVM } from "@/modules/workspace/ui/editor/model/types";

export function TimelinePanel({
  points,
  activeId,
  anchoredPointId = null,
  canSetAnchor = false,
  isBusy,
  isPending = false,
  onSelect,
  onSetAnchor,
  onReorder,
  onDelete,
  onRename,
}: {
  points: TimelinePointVM[];
  activeId: string | null;
  anchoredPointId?: string | null;
  canSetAnchor?: boolean;
  isBusy: boolean;
  isPending?: boolean;
  onSelect: (_id: string) => void;
  onSetAnchor?: (_id: string, _anchorId: string) => void;
  onReorder: (_fromIndex: number, _toIndex: number) => void;
  onDelete: (_id: string, _anchorId: string) => void;
  onRename: (_pointId: string, _label: string) => Promise<boolean>;
}) {
  const pointById = useMemo(() => new Map(points.map((point) => [point.id, point])), [points]);
  const fixedPoints = useMemo(() => points.filter((point) => point.isImplicitOrigin), [points]);
  const draggableIds = useMemo(
    () => points.filter((point) => !point.isImplicitOrigin).map((point) => point.id),
    [points],
  );
  const draggableIdsKey = draggableIds.join("\u001f");
  const draggingIdRef = useRef<string | null>(null);
  const orderedIdsRef = useRef(draggableIds);
  const [orderedIds, setOrderedIds] = useState(draggableIds);

  useEffect(() => {
    orderedIdsRef.current = draggableIds;
    setOrderedIds(draggableIds);
  }, [draggableIds, draggableIdsKey]);

  const handleVisualReorder = (nextIds: string[]) => {
    const validIds = nextIds.filter((id) => {
      const point = pointById.get(id);
      return point && !point.isImplicitOrigin;
    });

    orderedIdsRef.current = validIds;
    setOrderedIds(validIds);
  };

  const handleDragStart = (pointId: string) => {
    draggingIdRef.current = pointId;
  };

  const handleDragEnd = (pointId: string) => {
    const movedPointId = draggingIdRef.current ?? pointId;
    draggingIdRef.current = null;

    const fromIndex = points.findIndex((point) => point.id === movedPointId);
    const toMovableIndex = orderedIdsRef.current.indexOf(movedPointId);
    const toIndex = fixedPoints.length + toMovableIndex;

    if (fromIndex < 0 || toMovableIndex < 0 || fromIndex === toIndex) {
      return;
    }

    onReorder(fromIndex, toIndex);
  };

  const renderPointRow = (point: TimelinePointVM, icon?: ReactNode) => {
    const isActive = activeId === point.id;
    const isAnchored = anchoredPointId === point.id;
    const showSetAnchor = canSetAnchor && !isAnchored && onSetAnchor;
    const showDelete = !point.isImplicitOrigin;
    const rowAnchorId = actionAnchorId("timeline", "row", point.id);
    const anchorActionId = actionAnchorId("timeline", "anchor", point.id);
    const deleteAnchorId = actionAnchorId("timeline", "delete", point.id);

    return (
      <SidebarListRow
        depth={0}
        isActive={isActive}
        group={!!showSetAnchor || !point.isImplicitOrigin}
        anchorId={rowAnchorId}
        className={point.isImplicitOrigin ? "opacity-90" : ""}
        onClick={() => onSelect(point.id)}
        icon={icon ?? <TimelinePointMarker />}
        label={
          <InlineEditableText
            value={point.label}
            editable={!point.isImplicitOrigin}
            disabled={isBusy}
            onEditStart={() => onSelect(point.id)}
            onCommit={(label) => onRename(point.id, label)}
            className={cn(
              "min-w-0 flex-1 truncate leading-5.5",
              isAnchored ? "font-bold text-accent-foreground" : "",
            )}
          />
        }
        trailing={point.description || undefined}
        actions={
          showSetAnchor || showDelete ? (
            <>
              {showSetAnchor ? (
                <RowActionButton
                  anchorId={anchorActionId}
                  onClick={() => onSetAnchor(point.id, anchorActionId)}
                  disabled={isBusy}
                  title="设为锚点"
                  icon="icon-[material-symbols--anchor]"
                />
              ) : null}
              {showDelete ? (
                <RowActionButton
                  anchorId={deleteAnchorId}
                  onClick={() => onDelete(point.id, deleteAnchorId)}
                  disabled={isBusy}
                  title="删除时间点"
                  icon="icon-[material-symbols--close]"
                />
              ) : null}
            </>
          ) : undefined
        }
      />
    );
  };

  return (
    <div className="relative pb-2" aria-busy={isPending}>
      <RefreshOverlay active={isPending} />
      <div
        inert={isPending}
        className={cn(
          "transition-opacity duration-150 ease-out motion-reduce:transition-none",
          isPending ? "pointer-events-none opacity-70 select-none" : "opacity-100",
        )}
      >
        {fixedPoints.map((point) => (
          <div key={point.id}>{renderPointRow(point)}</div>
        ))}
        <Reorder.Group
          as="div"
          axis="y"
          values={orderedIds}
          onReorder={handleVisualReorder}
          className="contents"
        >
          {orderedIds.map((pointId) => {
            const point = pointById.get(pointId);

            if (!point) {
              return null;
            }

            return (
              <TimelineReorderItem
                key={point.id}
                pointId={point.id}
                disabled={isBusy}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
              >
                {(icon) => renderPointRow(point, icon)}
              </TimelineReorderItem>
            );
          })}
        </Reorder.Group>
      </div>
    </div>
  );
}

function TimelineReorderItem({
  pointId,
  disabled,
  onDragStart,
  onDragEnd,
  children,
}: {
  pointId: string;
  disabled: boolean;
  onDragStart: (_pointId: string) => void;
  onDragEnd: (_pointId: string) => void;
  children: (_icon: ReactNode) => ReactNode;
}) {
  const dragControls = useDragControls();

  const icon = (
    <TimelinePointMarker>
      <span
        title="拖动排序"
        aria-label="拖动排序"
        role="button"
        tabIndex={disabled ? -1 : 0}
        className={cn(
          "absolute inset-0 icon-[material-symbols--drag-indicator] touch-none text-base leading-none opacity-0 transition group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-drag-border",
          disabled
            ? "cursor-not-allowed group-hover:opacity-30"
            : "cursor-grab active:cursor-grabbing",
        )}
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => {
          if (disabled) {
            return;
          }

          event.preventDefault();
          event.stopPropagation();
          dragControls.start(event);
        }}
      />
    </TimelinePointMarker>
  );

  return (
    <Reorder.Item
      as="div"
      value={pointId}
      dragControls={dragControls}
      dragListener={false}
      layout="position"
      className="relative list-none"
      onDragStart={() => onDragStart(pointId)}
      onDragEnd={() => onDragEnd(pointId)}
    >
      {children(icon)}
    </Reorder.Item>
  );
}

function TimelinePointMarker({ children }: { children?: ReactNode }) {
  return (
    <span className="relative grid size-4 shrink-0 place-items-center text-foreground-muted">
      <span
        className={cn(
          "icon-[material-symbols--radio-button-checked] text-sm transition",
          children ? "group-hover:opacity-0" : "",
        )}
      />
      {children}
    </span>
  );
}
