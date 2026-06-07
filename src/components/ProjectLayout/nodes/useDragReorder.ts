import { type DragEvent, useState } from "react";

export interface DragRowProps {
  isDragging: boolean;
  isDragOver: boolean;
  onDragStart: (_event: DragEvent<HTMLElement>) => void;
  onDragOver: (_event: DragEvent<HTMLElement>) => void;
  onDragLeave: () => void;
  onDrop: (_event: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
}

export function useDragReorder({
  isBusy,
  onReorder,
}: {
  isBusy?: boolean;
  onReorder?: (_fromIndex: number, _toIndex: number) => void;
}) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const getRowDragProps = (
    index: number,
    { disabled = false }: { disabled?: boolean } = {},
  ): DragRowProps | undefined => {
    if (!onReorder || disabled || isBusy) {
      return undefined;
    }

    const isDragging = dragIndex === index;
    const isDragOver = dragOverIndex === index;

    return {
      isDragging,
      isDragOver,
      onDragStart: (event) => {
        setDragIndex(index);
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", String(index));
      },
      onDragOver: (event) => {
        if (dragIndex === null || dragIndex === index) {
          return;
        }

        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setDragOverIndex(index);
      },
      onDragLeave: () => {
        setDragOverIndex(null);
      },
      onDrop: (event) => {
        event.preventDefault();
        if (dragIndex !== null && dragIndex !== index) {
          onReorder(dragIndex, index);
        }
        setDragIndex(null);
        setDragOverIndex(null);
      },
      onDragEnd: () => {
        setDragIndex(null);
        setDragOverIndex(null);
      },
    };
  };

  return { getRowDragProps };
}
