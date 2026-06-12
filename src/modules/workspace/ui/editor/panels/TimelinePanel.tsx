import { AnimatePresence, motion } from "motion/react";
import { type ReactNode, useLayoutEffect, useMemo, useRef, useState } from "react";

import {
  resolveTimelineMoveAfterPointId,
  type TimelineDropPosition,
} from "@/modules/workspace/ui/editor/model/timeline";
import { actionAnchorId } from "@/modules/workspace/ui/editor/model/action-error";
import type { TimelinePointVM } from "@/modules/workspace/ui/editor/model/types";
import { cn } from "@/shared/lib/cn";
import { InlineEditableText } from "@/shared/ui/InlineEditableText";
import { RefreshOverlay } from "@/shared/ui/RefreshOverlay";
import {
  rowPaddingLeft,
  RowActionButton,
  SidebarListRow,
  useRowPointerGesture,
} from "@/shared/ui/tree";

const TIMELINE_ROW_SELECTOR = "[data-row-id]";

type TimelineDropIntent = {
  pointId: string;
  targetId: string | null;
  position: TimelineDropPosition;
  afterPointId: string;
};

type DropIndicatorRect = {
  top: number;
  left: number;
  width: number;
};

function dropPositionFromPointer(clientY: number, row: HTMLElement) {
  const rect = row.getBoundingClientRect();
  return clientY < rect.top + rect.height / 2 ? ("before" as const) : ("after" as const);
}

function DropIndicatorOverlay({ rect }: { rect: DropIndicatorRect }) {
  return (
    <motion.span
      className="pointer-events-none absolute z-30 block"
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{
        opacity: 1,
        scale: 1,
        top: rect.top - 6,
        left: rect.left,
        width: rect.width,
        height: 12,
      }}
      exit={{
        opacity: 0,
        scale: 0.96,
        top: rect.top - 6,
        left: rect.left,
        width: rect.width,
        height: 12,
      }}
      transition={{ duration: 0.14, ease: "easeOut" }}
      style={{
        top: rect.top - 6,
        left: rect.left,
        width: rect.width,
        height: 12,
        originX: 0,
        originY: 0.5,
      }}
    >
      <motion.span
        className="absolute top-1/2 left-0 size-1.5 -translate-y-1/2 rounded-full bg-drag-border"
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.12, ease: "easeOut" }}
      />
      <motion.span
        className="absolute top-1/2 right-0 left-1.5 h-0.5 -translate-y-1/2 rounded-full bg-drag-border"
        animate={{ opacity: 1, scaleX: 1 }}
        transition={{ duration: 0.12, ease: "easeOut" }}
        style={{ originX: 0 }}
      />
    </motion.span>
  );
}

function TimelinePointRow({
  point,
  isActive,
  isAnchored,
  canSetAnchor,
  isBusy,
  isDragging,
  onSelect,
  onSetAnchor,
  onDelete,
  onRename,
  onDragStart,
  onDragMove,
  onDragEnd,
}: {
  point: TimelinePointVM;
  isActive: boolean;
  isAnchored: boolean;
  canSetAnchor: boolean;
  isBusy: boolean;
  isDragging: boolean;
  onSelect: (_id: string) => void;
  onSetAnchor?: (_id: string, _anchorId: string) => void;
  onDelete: (_id: string, _anchorId: string) => void;
  onRename: (_pointId: string, _label: string) => Promise<boolean>;
  onDragStart: (_pointId: string) => void;
  onDragMove: (_pointId: string, _point: { x: number; y: number }) => void;
  onDragEnd: (_pointId: string, _point: { x: number; y: number }) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const dragDisabled = point.isImplicitOrigin || isBusy || isEditing;
  const showSetAnchor = canSetAnchor && !isAnchored && onSetAnchor;
  const showDelete = !point.isImplicitOrigin;
  const rowAnchorId = actionAnchorId("timeline", "row", point.id);
  const anchorActionId = actionAnchorId("timeline", "anchor", point.id);
  const deleteAnchorId = actionAnchorId("timeline", "delete", point.id);
  const gesture = useRowPointerGesture({
    scope: "timeline",
    rowId: point.id,
    canStartDrag: !dragDisabled,
    onClick: () => onSelect(point.id),
    onDoubleClickLabel: () => {},
    onDragStart,
    onDragMove,
    onDragEnd,
  });

  return (
    <SidebarListRow
      layout="position"
      depth={0}
      isActive={isActive}
      group={!!showSetAnchor || showDelete}
      anchorId={rowAnchorId}
      dataRowId={point.id}
      multiline={!!point.description}
      className={cn(
        point.isImplicitOrigin ? "opacity-90" : "",
        isDragging ? "pointer-events-none z-10 opacity-75 shadow-sm" : "",
      )}
      onClick={gesture.handleClick}
      onPointerDown={gesture.handlePointerDown}
      icon={<TimelinePointMarker />}
      label={
        <InlineEditableText
          value={point.label}
          editable={!point.isImplicitOrigin}
          disabled={isBusy}
          onEditStart={() => onSelect(point.id)}
          onEditingChange={setIsEditing}
          onCommit={(label) => onRename(point.id, label)}
          className={cn(
            "min-w-0 flex-1 truncate",
            isAnchored ? "font-bold text-accent-foreground" : "",
          )}
        />
      }
      description={
        point.description ? (
          <span className="block truncate leading-4">{point.description}</span>
        ) : undefined
      }
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
}

export function TimelinePanel({
  points,
  activeId,
  anchoredPointId = null,
  canSetAnchor = false,
  isBusy,
  isPending = false,
  onSelect,
  onSetAnchor,
  onMove,
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
  onMove: (_pointId: string, _afterPointId: string) => void;
  onDelete: (_id: string, _anchorId: string) => void;
  onRename: (_pointId: string, _label: string) => Promise<boolean>;
}) {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropIntent, setDropIntent] = useState<TimelineDropIntent | null>(null);
  const [dropIndicatorRect, setDropIndicatorRect] = useState<DropIndicatorRect | null>(null);
  const [panelMinHeight, setPanelMinHeight] = useState<number | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const pointById = useMemo(() => new Map(points.map((point) => [point.id, point])), [points]);

  useLayoutEffect(() => {
    const panelElement = panelRef.current;
    const viewportElement = panelElement?.closest(".simplebar-content")?.parentElement;
    if (!(panelElement instanceof HTMLElement) || !(viewportElement instanceof HTMLElement)) {
      setPanelMinHeight(null);
      return;
    }

    const updateMinHeight = () => {
      setPanelMinHeight(viewportElement.clientHeight);
    };

    updateMinHeight();
    const observer = new ResizeObserver(() => {
      updateMinHeight();
    });
    observer.observe(viewportElement);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (!dropIntent) {
      setDropIndicatorRect(null);
      return;
    }

    const panelElement = panelRef.current;
    if (!(panelElement instanceof HTMLElement)) {
      setDropIndicatorRect(null);
      return;
    }

    const panelRect = panelElement.getBoundingClientRect();
    const anchorElement =
      dropIntent.targetId === null
        ? panelElement
            .querySelectorAll(TIMELINE_ROW_SELECTOR)
            .item(panelElement.querySelectorAll(TIMELINE_ROW_SELECTOR).length - 1)
        : panelElement.querySelector(`[data-row-id="${CSS.escape(dropIntent.targetId)}"]`);

    if (!(anchorElement instanceof HTMLElement)) {
      setDropIndicatorRect(null);
      return;
    }

    const anchorRect = anchorElement.getBoundingClientRect();
    const targetPoint = dropIntent.targetId ? pointById.get(dropIntent.targetId) : null;
    const top =
      dropIntent.targetId === null ||
      dropIntent.position === "after" ||
      targetPoint?.isImplicitOrigin
        ? anchorRect.bottom - panelRect.top
        : anchorRect.top - panelRect.top;
    const clampedTop = Math.min(Math.max(top, 1), Math.max(panelRect.height - 1, 1));
    const left = Math.max(rowPaddingLeft(0) + 8, 8);
    const width = Math.max(panelRect.width - left, 24);

    setDropIndicatorRect({
      top: clampedTop,
      left,
      width,
    });
  }, [dropIntent, pointById]);

  const findBlankAreaDropIntent = (pointId: string, point: { x: number; y: number }) => {
    const panelElement = panelRef.current;
    if (!(panelElement instanceof HTMLElement)) {
      return null;
    }

    const panelRect = panelElement.getBoundingClientRect();
    if (
      point.x < panelRect.left ||
      point.x > panelRect.right ||
      point.y < panelRect.top ||
      point.y > panelRect.bottom
    ) {
      return null;
    }

    const visibleRows = panelElement.querySelectorAll(TIMELINE_ROW_SELECTOR);
    const lastVisibleRow = visibleRows.item(visibleRows.length - 1);
    if (!(lastVisibleRow instanceof HTMLElement)) {
      return null;
    }

    if (point.y < lastVisibleRow.getBoundingClientRect().bottom) {
      return null;
    }

    const afterPointId = resolveTimelineMoveAfterPointId({
      points,
      pointId,
      targetId: null,
      position: "after",
    });
    if (!afterPointId) {
      return null;
    }

    return {
      pointId,
      targetId: null,
      position: "after" as const,
      afterPointId,
    } satisfies TimelineDropIntent;
  };

  const findDropIntent = (pointId: string, point: { x: number; y: number }) => {
    const source = document.elementFromPoint(point.x, point.y);
    const row = source?.closest(TIMELINE_ROW_SELECTOR);

    if (!(row instanceof HTMLElement)) {
      return findBlankAreaDropIntent(pointId, point);
    }

    const targetId = row.dataset.rowId;
    if (!targetId || targetId === pointId) {
      return null;
    }

    const targetPoint = pointById.get(targetId);
    const position =
      targetPoint?.isImplicitOrigin === true ? "after" : dropPositionFromPointer(point.y, row);
    const afterPointId = resolveTimelineMoveAfterPointId({
      points,
      pointId,
      targetId,
      position,
    });
    if (!afterPointId) {
      return null;
    }

    return {
      pointId,
      targetId,
      position,
      afterPointId,
    } satisfies TimelineDropIntent;
  };

  const handleDragStart = (pointId: string) => {
    setDraggedId(pointId);
    setDropIntent(null);
    setDropIndicatorRect(null);
  };

  const handleDragMove = (pointId: string, point: { x: number; y: number }) => {
    setDropIntent(findDropIntent(pointId, point));
  };

  const handleDragEnd = (pointId: string, point: { x: number; y: number }) => {
    const finalIntent = findDropIntent(pointId, point) ?? dropIntent;
    setDraggedId(null);
    setDropIntent(null);
    setDropIndicatorRect(null);

    if (finalIntent) {
      onMove(pointId, finalIntent.afterPointId);
    }
  };

  return (
    <div
      ref={panelRef}
      className="relative min-h-full pb-2"
      style={panelMinHeight == null ? undefined : { minHeight: panelMinHeight }}
      aria-busy={isPending}
    >
      <RefreshOverlay active={isPending} />
      <div
        inert={isPending}
        className={cn(
          "transition-opacity duration-150 ease-out motion-reduce:transition-none",
          isPending ? "pointer-events-none opacity-70 select-none" : "opacity-100",
        )}
      >
        <AnimatePresence initial={false} mode="popLayout">
          {points.map((point) => (
            <motion.div
              key={point.id}
              layout="position"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.14, ease: "easeOut" }}
            >
              <TimelinePointRow
                point={point}
                isActive={activeId === point.id}
                isAnchored={anchoredPointId === point.id}
                canSetAnchor={canSetAnchor}
                isBusy={isBusy}
                isDragging={draggedId === point.id}
                onSelect={onSelect}
                onSetAnchor={onSetAnchor}
                onDelete={onDelete}
                onRename={onRename}
                onDragStart={handleDragStart}
                onDragMove={handleDragMove}
                onDragEnd={handleDragEnd}
              />
            </motion.div>
          ))}
        </AnimatePresence>
        <AnimatePresence>
          {dropIndicatorRect ? (
            <DropIndicatorOverlay key="timeline-drop-indicator" rect={dropIndicatorRect} />
          ) : null}
        </AnimatePresence>
      </div>
    </div>
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
