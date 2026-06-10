import {
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  clampSessionSectionHeight,
  resolveReleasedSheetState,
  resolveSessionSectionHeight,
  resolveSheetAnchors,
  SESSION_PEEK_HEIGHT,
  type SheetState,
} from "./assistantSheetLayout";

export type AssistantSheetLayout = {
  bodyFrameRef: RefObject<HTMLDivElement | null>;
  hasMeasuredLayout: boolean;
  isDraggingSheet: boolean;
  sessionSectionHeight: number;
  sectionHeightTransitionClass: string;
  sheetState: SheetState;
  setSheetState: (_state: SheetState) => void;
  handleSheetPointerDown: (_event: ReactPointerEvent<HTMLDivElement>) => void;
  handleSheetPointerMove: (_event: ReactPointerEvent<HTMLDivElement>) => void;
  handleSheetPointerUp: (_event: ReactPointerEvent<HTMLDivElement>) => void;
  handleSheetPointerCancel: (_event: ReactPointerEvent<HTMLDivElement>) => void;
};

export function useAssistantSheetLayout({
  defaultState = "peek",
}: {
  defaultState?: SheetState;
} = {}): AssistantSheetLayout {
  const [sheetState, setSheetState] = useState<SheetState>(defaultState);
  const [sessionSectionHeight, setSessionSectionHeight] = useState(() =>
    defaultState === "closed" ? 0 : SESSION_PEEK_HEIGHT,
  );
  const [availableBodyHeight, setAvailableBodyHeight] = useState(0);
  const [hasMeasuredLayout, setHasMeasuredLayout] = useState(false);
  const [isDraggingSheet, setIsDraggingSheet] = useState(false);
  const bodyFrameRef = useRef<HTMLDivElement>(null);
  const sessionSectionHeightRef = useRef(sessionSectionHeight);
  const sheetDragRef = useRef<{
    pointerId: number;
    startY: number;
    startHeight: number;
    startState: SheetState;
  } | null>(null);
  const sheetAnchors = useMemo(
    () => resolveSheetAnchors({ availableBodyHeight, hasMeasuredLayout }),
    [availableBodyHeight, hasMeasuredLayout],
  );
  const clampedSessionSectionHeight = resolveSessionSectionHeight({
    requestedHeight: sessionSectionHeight,
    availableBodyHeight,
    hasMeasuredLayout,
  });
  const sectionHeightTransitionClass =
    !hasMeasuredLayout || isDraggingSheet
      ? ""
      : "transition-[height] duration-200 ease-out motion-reduce:transition-none";

  useEffect(() => {
    sessionSectionHeightRef.current = clampedSessionSectionHeight;
  }, [clampedSessionSectionHeight]);

  useLayoutEffect(() => {
    const frame = bodyFrameRef.current;
    if (!frame) {
      return;
    }

    const measureLayout = () => {
      setAvailableBodyHeight(Math.round(frame.getBoundingClientRect().height));
      setHasMeasuredLayout(true);
    };

    measureLayout();

    const observer = new ResizeObserver(() => {
      measureLayout();
    });
    observer.observe(frame);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (isDraggingSheet) {
      return;
    }

    setSessionSectionHeight(sheetAnchors[sheetState]);
  }, [isDraggingSheet, sheetAnchors, sheetState]);

  useEffect(() => {
    return () => {
      document.body.style.cursor = "";
    };
  }, []);

  const handleSheetPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (availableBodyHeight <= 0) {
        return;
      }

      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      sheetDragRef.current = {
        pointerId: event.pointerId,
        startY: event.clientY,
        startHeight: sessionSectionHeightRef.current,
        startState: sheetState,
      };
      setIsDraggingSheet(true);
      document.body.style.cursor = "row-resize";
    },
    [availableBodyHeight, sheetState],
  );

  const handleSheetPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const dragState = sheetDragRef.current;
      if (!dragState || dragState.pointerId !== event.pointerId) {
        return;
      }

      setSessionSectionHeight(
        clampSessionSectionHeight(
          dragState.startHeight + (event.clientY - dragState.startY),
          sheetAnchors.expanded,
        ),
      );
    },
    [sheetAnchors.expanded],
  );

  const finishSheetDrag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const dragState = sheetDragRef.current;
      if (!dragState || dragState.pointerId !== event.pointerId) {
        return;
      }

      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }

      sheetDragRef.current = null;
      setIsDraggingSheet(false);
      document.body.style.cursor = "";

      const nextHeight = clampSessionSectionHeight(
        sessionSectionHeightRef.current,
        sheetAnchors.expanded,
      );
      const nextState = resolveReleasedSheetState({
        height: nextHeight,
        anchors: sheetAnchors,
        startState: dragState.startState,
      });
      setSheetState(nextState);
      setSessionSectionHeight(sheetAnchors[nextState]);
    },
    [sheetAnchors],
  );

  return {
    bodyFrameRef,
    hasMeasuredLayout,
    isDraggingSheet,
    sessionSectionHeight: clampedSessionSectionHeight,
    sectionHeightTransitionClass,
    sheetState,
    setSheetState,
    handleSheetPointerDown,
    handleSheetPointerMove,
    handleSheetPointerUp: finishSheetDrag,
    handleSheetPointerCancel: finishSheetDrag,
  };
}
