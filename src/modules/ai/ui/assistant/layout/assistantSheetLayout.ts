export const HEAD_ROW_HEIGHT = 44;
export const SHEET_HANDLE_HEIGHT = 16;
export const SESSION_PEEK_HEIGHT = HEAD_ROW_HEIGHT * 3;
export const PEEK_TO_EXPANDED_SNAP_RATIO = 0.3;
export const PEEK_TO_EXPANDED_SNAP_MAX_PX = 72;

export type SheetState = "closed" | "peek" | "expanded";

export type SheetAnchors = Record<SheetState, number>;

export function clampSessionSectionHeight(height: number, maxHeight: number) {
  return Math.min(Math.max(0, height), Math.max(0, maxHeight));
}

export function resolveNearestSheetState(height: number, anchors: SheetAnchors): SheetState {
  const orderedStates: SheetState[] = ["closed", "peek", "expanded"];

  return orderedStates.reduce((nearest, current) =>
    Math.abs(anchors[current] - height) < Math.abs(anchors[nearest] - height) ? current : nearest,
  );
}

export function resolveReleasedSheetState({
  height,
  anchors,
  startState,
}: {
  height: number;
  anchors: SheetAnchors;
  startState: SheetState;
}) {
  if (startState === "peek" && anchors.expanded > anchors.peek) {
    const expandedThresholdOffset = Math.min(
      anchors.expanded - anchors.peek,
      Math.min(
        PEEK_TO_EXPANDED_SNAP_MAX_PX,
        (anchors.expanded - anchors.peek) * PEEK_TO_EXPANDED_SNAP_RATIO,
      ),
    );
    const expandedThreshold = anchors.peek + expandedThresholdOffset;
    if (height >= expandedThreshold) {
      return "expanded";
    }
  }

  if (startState === "expanded" && anchors.expanded > anchors.peek) {
    const peekThresholdOffset = Math.min(
      anchors.expanded - anchors.peek,
      Math.min(
        PEEK_TO_EXPANDED_SNAP_MAX_PX,
        (anchors.expanded - anchors.peek) * PEEK_TO_EXPANDED_SNAP_RATIO,
      ),
    );
    const peekThreshold = anchors.expanded - peekThresholdOffset;
    if (height <= peekThreshold) {
      return "peek";
    }
  }

  return resolveNearestSheetState(height, anchors);
}

export function resolvePeekSessionHeight({ maxHeight }: { maxHeight: number }) {
  return clampSessionSectionHeight(SESSION_PEEK_HEIGHT, maxHeight);
}

export function resolveSheetAnchors({
  availableBodyHeight,
  hasMeasuredLayout,
}: {
  availableBodyHeight: number;
  hasMeasuredLayout: boolean;
}): SheetAnchors {
  if (!hasMeasuredLayout) {
    return {
      closed: 0,
      peek: SESSION_PEEK_HEIGHT,
      expanded: SESSION_PEEK_HEIGHT,
    };
  }

  return {
    closed: 0,
    peek: resolvePeekSessionHeight({ maxHeight: availableBodyHeight }),
    expanded: clampSessionSectionHeight(
      availableBodyHeight - SHEET_HANDLE_HEIGHT,
      availableBodyHeight,
    ),
  };
}

export function resolveSessionSectionHeight({
  requestedHeight,
  availableBodyHeight,
  hasMeasuredLayout,
}: {
  requestedHeight: number;
  availableBodyHeight: number;
  hasMeasuredLayout: boolean;
}) {
  if (!hasMeasuredLayout) {
    return requestedHeight;
  }

  return clampSessionSectionHeight(
    requestedHeight,
    resolveSheetAnchors({ availableBodyHeight, hasMeasuredLayout }).expanded,
  );
}
