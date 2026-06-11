import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";

export const ROW_GESTURE_DRAG_THRESHOLD_PX = 4;
export const ROW_GESTURE_DOUBLE_CLICK_INTERVAL_MS = 300;
export const ROW_GESTURE_DOUBLE_CLICK_DISTANCE_PX = 5;
export const ROW_GESTURE_HIT_AREA_ATTRIBUTE = "data-inline-edit-hit-area";
export const ROW_GESTURE_EXCLUDE_ATTRIBUTE = "data-no-row-gesture";

export type RowGestureHitArea = "label";

export type RowGestureClickCandidate = {
  scope: string;
  rowId: string;
  hitArea: RowGestureHitArea;
  timeStamp: number;
  x: number;
  y: number;
};

export type ActiveRowPointerGesture = {
  pointerId: number;
  scope: string;
  rowId: string;
  hitArea: RowGestureHitArea | null;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  dragging: boolean;
};

export function canStartRowPointerGesture(input: {
  pointerType: string;
  button: number;
  buttons: number;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}) {
  return (
    input.pointerType === "mouse" &&
    input.button === 0 &&
    input.buttons === 1 &&
    !input.altKey &&
    !input.ctrlKey &&
    !input.metaKey &&
    !input.shiftKey
  );
}

export function beginRowPointerGesture(input: {
  pointerId: number;
  scope: string;
  rowId: string;
  hitArea: RowGestureHitArea | null;
  x: number;
  y: number;
}) {
  return {
    pointerId: input.pointerId,
    scope: input.scope,
    rowId: input.rowId,
    hitArea: input.hitArea,
    startX: input.x,
    startY: input.y,
    lastX: input.x,
    lastY: input.y,
    dragging: false,
  } satisfies ActiveRowPointerGesture;
}

export function updateRowPointerGesture(
  active: ActiveRowPointerGesture,
  input: { x: number; y: number },
  dragThresholdPx = ROW_GESTURE_DRAG_THRESHOLD_PX,
) {
  const next = {
    ...active,
    lastX: input.x,
    lastY: input.y,
  };
  const distance = Math.hypot(input.x - active.startX, input.y - active.startY);
  const startedDrag = !active.dragging && distance > dragThresholdPx;
  return {
    next: startedDrag ? { ...next, dragging: true } : next,
    startedDrag,
  };
}

export function resolveRowPointerRelease(input: {
  active: ActiveRowPointerGesture;
  previousClickCandidate: RowGestureClickCandidate | null;
  x: number;
  y: number;
  timeStamp: number;
  doubleClickIntervalMs?: number;
  doubleClickDistancePx?: number;
}) {
  const {
    active,
    previousClickCandidate,
    x,
    y,
    timeStamp,
    doubleClickIntervalMs = ROW_GESTURE_DOUBLE_CLICK_INTERVAL_MS,
    doubleClickDistancePx = ROW_GESTURE_DOUBLE_CLICK_DISTANCE_PX,
  } = input;

  if (active.dragging) {
    return {
      kind: "drag-end" as const,
      nextClickCandidate: null,
    };
  }

  if (active.hitArea == null) {
    return {
      kind: "none" as const,
      nextClickCandidate: null,
    };
  }

  const matchesPrevious =
    previousClickCandidate &&
    previousClickCandidate.scope === active.scope &&
    previousClickCandidate.rowId === active.rowId &&
    previousClickCandidate.hitArea === active.hitArea &&
    timeStamp - previousClickCandidate.timeStamp <= doubleClickIntervalMs &&
    Math.hypot(x - previousClickCandidate.x, y - previousClickCandidate.y) <= doubleClickDistancePx;

  if (matchesPrevious) {
    return {
      kind: "double-click" as const,
      nextClickCandidate: null,
    };
  }

  return {
    kind: "click-candidate" as const,
    nextClickCandidate: {
      scope: active.scope,
      rowId: active.rowId,
      hitArea: active.hitArea,
      timeStamp,
      x,
      y,
    } satisfies RowGestureClickCandidate,
  };
}

function resolveGestureHitArea(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return null;
  }

  const hitAreaElement = target.closest<HTMLElement>(`[${ROW_GESTURE_HIT_AREA_ATTRIBUTE}]`);
  const hitArea = hitAreaElement?.dataset.inlineEditHitArea;
  return hitArea === "label" ? ("label" as const) : null;
}

function isExcludedGestureTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement && target.closest(`[${ROW_GESTURE_EXCLUDE_ATTRIBUTE}]`) != null
  );
}

let sharedClickCandidate: RowGestureClickCandidate | null = null;

export function useRowPointerGesture({
  scope,
  rowId,
  canStartDrag,
  onClick,
  onDoubleClickLabel,
  onDragStart,
  onDragMove,
  onDragEnd,
}: {
  scope: string;
  rowId: string;
  canStartDrag: boolean;
  onClick: () => void;
  onDoubleClickLabel: () => void;
  onDragStart: (_rowId: string) => void;
  onDragMove: (_rowId: string, _point: { x: number; y: number }) => void;
  onDragEnd: (_rowId: string, _point: { x: number; y: number }) => void;
}) {
  const activeGestureRef = useRef<ActiveRowPointerGesture | null>(null);
  const suppressNextClickRef = useRef(false);
  const onClickRef = useRef(onClick);
  const onDoubleClickLabelRef = useRef(onDoubleClickLabel);
  const onDragStartRef = useRef(onDragStart);
  const onDragMoveRef = useRef(onDragMove);
  const onDragEndRef = useRef(onDragEnd);
  const canStartDragRef = useRef(canStartDrag);
  const [isTracking, setIsTracking] = useState(false);
  const [startEditingSignal, setStartEditingSignal] = useState(0);

  onClickRef.current = onClick;
  onDoubleClickLabelRef.current = onDoubleClickLabel;
  onDragStartRef.current = onDragStart;
  onDragMoveRef.current = onDragMove;
  onDragEndRef.current = onDragEnd;
  canStartDragRef.current = canStartDrag;

  useEffect(() => {
    if (!isTracking) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const active = activeGestureRef.current;
      if (!active || active.pointerId !== event.pointerId) {
        return;
      }

      const { next, startedDrag } = updateRowPointerGesture(active, {
        x: event.clientX,
        y: event.clientY,
      });
      activeGestureRef.current =
        startedDrag && !canStartDragRef.current ? { ...next, dragging: false } : next;

      if (startedDrag && canStartDragRef.current) {
        suppressNextClickRef.current = true;
        sharedClickCandidate = null;
        onDragStartRef.current(rowId);
      }

      if (activeGestureRef.current.dragging) {
        event.preventDefault();
        onDragMoveRef.current(rowId, { x: event.clientX, y: event.clientY });
      }
    };

    const handlePointerEnd = (event: PointerEvent) => {
      const active = activeGestureRef.current;
      if (!active || active.pointerId !== event.pointerId) {
        return;
      }

      activeGestureRef.current = null;
      setIsTracking(false);
      if (event.type === "pointercancel") {
        sharedClickCandidate = null;
        if (active.dragging) {
          suppressNextClickRef.current = true;
          onDragEndRef.current(rowId, { x: active.lastX, y: active.lastY });
        }
        return;
      }

      const result = resolveRowPointerRelease({
        active,
        previousClickCandidate: sharedClickCandidate,
        x: event.clientX,
        y: event.clientY,
        timeStamp: event.timeStamp,
      });

      sharedClickCandidate = result.nextClickCandidate;

      if (result.kind === "drag-end") {
        suppressNextClickRef.current = true;
        event.preventDefault();
        onDragEndRef.current(rowId, { x: event.clientX, y: event.clientY });
        return;
      }

      if (result.kind === "double-click") {
        setStartEditingSignal((previous) => previous + 1);
        onDoubleClickLabelRef.current();
      }
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerEnd);
    window.addEventListener("pointercancel", handlePointerEnd);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerEnd);
      window.removeEventListener("pointercancel", handlePointerEnd);
    };
  }, [isTracking, rowId]);

  useEffect(() => {
    return () => {
      activeGestureRef.current = null;
    };
  }, []);

  return {
    startEditingSignal,
    handleClick: () => {
      if (suppressNextClickRef.current) {
        suppressNextClickRef.current = false;
        return;
      }

      onClickRef.current();
    },
    handlePointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      if (!canStartRowPointerGesture(event)) {
        return;
      }

      if (isExcludedGestureTarget(event.target)) {
        return;
      }

      const hitArea = resolveGestureHitArea(event.target);
      activeGestureRef.current = beginRowPointerGesture({
        pointerId: event.pointerId,
        scope,
        rowId,
        hitArea,
        x: event.clientX,
        y: event.clientY,
      });
      setIsTracking(true);
    },
  };
}
