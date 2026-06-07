import { type PointerEvent as ReactPointerEvent, useRef, useState } from "react";

export function ResizeHandle({
  interactive,
  onResizeStart,
  onResize,
  onResizeEnd,
}: {
  interactive: boolean;
  onResizeStart: () => void;
  onResize: (_deltaPx: number) => void;
  onResizeEnd: () => void;
}) {
  const [dragging, setDragging] = useState(false);
  const startYRef = useRef(0);

  if (!interactive) {
    return (
      <div className="relative z-10 -my-0.75 h-1.75 shrink-0">
        <div className="absolute inset-x-0 top-0.75 h-px bg-border" />
      </div>
    );
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    startYRef.current = event.clientY;
    setDragging(true);
    document.body.style.cursor = "row-resize";
    onResizeStart();
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging) {
      return;
    }
    onResize(event.clientY - startYRef.current);
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging) {
      return;
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragging(false);
    document.body.style.cursor = "";
    onResizeEnd();
  };

  return (
    <div
      className="group relative z-10 -my-0.75 h-1.75 shrink-0 cursor-row-resize"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <div className="absolute inset-x-0 top-0.75 h-px bg-border" />
      <div
        className={`absolute inset-x-0 top-[2.5px] h-0.5 bg-drag-border transition-opacity ${
          dragging ? "opacity-100" : "opacity-0 group-hover:opacity-100"
        }`}
      />
    </div>
  );
}
