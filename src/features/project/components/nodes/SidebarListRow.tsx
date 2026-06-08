import { type DragEvent, type ReactNode } from "react";

import type { DragRowProps } from "./useDragReorder";

export const ROW_BASE = "flex w-full items-center gap-1 h-7 pr-4 text-[13px]";
export const ROW_ACTIVE = "bg-list-active-background text-foreground";
export const ROW_INACTIVE = "text-foreground hover:bg-list-hover-background";

export function rowPaddingLeft(depth: number) {
  return 8 + depth * 16;
}

export function SidebarListRow({
  depth = 0,
  isActive,
  group = false,
  className = "",
  onClick,
  draggable = false,
  dragProps,
  leading,
  icon,
  label,
  trailing,
  actions,
  anchorId,
}: {
  depth?: number;
  isActive: boolean;
  group?: boolean;
  className?: string;
  onClick?: () => void;
  draggable?: boolean;
  dragProps?: DragRowProps;
  leading?: ReactNode;
  icon?: ReactNode;
  label: ReactNode;
  trailing?: ReactNode;
  actions?: ReactNode;
  anchorId?: string;
}) {
  const stateClass = isActive ? ROW_ACTIVE : ROW_INACTIVE;
  const hasHoverSlot = trailing != null || actions != null;
  const groupClass = group || hasHoverSlot ? "group" : "";
  const interactiveClass = onClick ? "cursor-pointer" : "";

  const dragClass = dragProps?.isDragging
    ? "opacity-40"
    : dragProps?.isDragOver
      ? "border-t border-t-drag-border"
      : "";

  const handleDragStart = (event: DragEvent<HTMLDivElement>) => {
    dragProps?.onDragStart(event);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    dragProps?.onDragOver(event);
  };

  const handleDragLeave = () => {
    dragProps?.onDragLeave();
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    dragProps?.onDrop(event);
  };

  const handleDragEnd = () => {
    dragProps?.onDragEnd();
  };

  return (
    <div
      data-action-anchor={anchorId}
      className={`${ROW_BASE} ${stateClass} ${groupClass} ${interactiveClass} ${dragClass} ${className}`.trim()}
      style={{ paddingLeft: `${rowPaddingLeft(depth)}px` }}
      onClick={onClick}
      draggable={draggable}
      onDragStart={dragProps ? handleDragStart : undefined}
      onDragOver={dragProps ? handleDragOver : undefined}
      onDragLeave={dragProps ? handleDragLeave : undefined}
      onDrop={dragProps ? handleDrop : undefined}
      onDragEnd={dragProps ? handleDragEnd : undefined}
    >
      {leading}
      {icon}
      <div className="flex min-w-0 flex-1 items-center gap-1">{label}</div>
      <RowHoverSlot badge={trailing} actions={actions} />
    </div>
  );
}

function RowHoverSlot({ actions, badge }: { actions?: ReactNode; badge?: ReactNode }) {
  if (!actions && !badge) {
    return null;
  }

  return (
    <div className="grid h-5 shrink-0 items-center">
      {actions ? (
        <div className="pointer-events-none col-start-1 row-start-1 flex items-center justify-end gap-1 justify-self-end opacity-0 transition group-hover:pointer-events-auto group-hover:opacity-100">
          {actions}
        </div>
      ) : null}
      {badge ? (
        <span
          className={`col-start-1 row-start-1 justify-self-end self-center max-w-20 truncate text-[10px] leading-none text-accent-foreground opacity-70 transition${actions ? " group-hover:pointer-events-none group-hover:opacity-0" : ""}`}
        >
          {badge}
        </span>
      ) : null}
    </div>
  );
}
