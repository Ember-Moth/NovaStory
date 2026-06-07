import { type DragEvent, type ReactNode } from "react";

import type { DragRowProps } from "./useDragReorder";

export const ROW_BASE = "flex w-full items-center gap-1 h-7 pr-2 text-[13px]";
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
}) {
  const stateClass = isActive ? ROW_ACTIVE : ROW_INACTIVE;
  const groupClass = group ? "group" : "";
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
      {trailing}
      {actions}
    </div>
  );
}
