import { type ReactNode } from "react";

import type { DragRowProps } from "./useDragReorder";
import { useDragReorder } from "./useDragReorder";

export interface FlatRowContext<T> {
  item: T;
  index: number;
  isActive: boolean;
  draggable: boolean;
  dragProps?: DragRowProps;
}

export function FlatListPanel<T>({
  items,
  activeId,
  isBusy,
  getId,
  onReorder,
  isDragDisabled,
  renderRow,
}: {
  items: T[];
  activeId: string | null;
  isBusy?: boolean;
  getId: (_item: T) => string;
  onReorder?: (_fromIndex: number, _toIndex: number) => void;
  isDragDisabled?: (_item: T, _index: number) => boolean;
  renderRow: (_ctx: FlatRowContext<T>) => ReactNode;
}) {
  const { getRowDragProps } = useDragReorder({ isBusy, onReorder });

  return (
    <>
      {items.map((item, index) => {
        const isActive = getId(item) === activeId;
        const dragDisabled = isDragDisabled?.(item, index) ?? false;
        const draggable = !!onReorder && !dragDisabled && !isBusy;

        return (
          <div key={getId(item)}>
            {renderRow({
              item,
              index,
              isActive,
              draggable,
              dragProps: getRowDragProps(index, { disabled: dragDisabled }),
            })}
          </div>
        );
      })}
    </>
  );
}
