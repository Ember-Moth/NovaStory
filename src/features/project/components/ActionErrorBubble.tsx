import { useLayoutEffect, useReducer } from "react";
import { createPortal } from "react-dom";

import type { ActionError } from "@/features/project/model/action-error";

const GAP_PX = 4;
const ESTIMATED_HEIGHT_PX = 48;

type BubblePosition = {
  top: number;
  right: number;
  placement: "above" | "below";
};

function resolveAnchorElement(anchorId: string) {
  return document.querySelector<HTMLElement>(`[data-action-anchor="${anchorId}"]`);
}

function measureBubblePosition(anchorId: string): BubblePosition | null {
  const anchor = resolveAnchorElement(anchorId);
  if (!anchor) {
    return null;
  }

  const rect = anchor.getBoundingClientRect();
  const placeAbove = rect.bottom + GAP_PX + ESTIMATED_HEIGHT_PX > window.innerHeight;

  return {
    top: placeAbove ? rect.top - GAP_PX : rect.bottom + GAP_PX,
    right: window.innerWidth - rect.right,
    placement: placeAbove ? "above" : "below",
  };
}

export function ActionErrorBubble({
  error,
  onDismiss,
  size = "xs",
}: {
  error: ActionError;
  onDismiss: () => void;
  size?: "xs" | "sm";
}) {
  const [, forceUpdate] = useReducer((count: number) => count + 1, 0);

  useLayoutEffect(() => {
    if (!error) {
      return;
    }

    const updatePosition = () => {
      forceUpdate();
    };

    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [error]);

  if (!error) {
    return null;
  }

  const position = measureBubblePosition(error.anchorId);
  if (!position) {
    return null;
  }

  const textClass = size === "sm" ? "text-sm" : "text-xs";
  const iconClass = size === "sm" ? "text-base" : "text-sm";

  return createPortal(
    <div
      role="alert"
      className={`fixed z-50 flex max-w-[min(24rem,calc(100vw-1rem))] items-start gap-2 rounded-md border border-border bg-editor-background px-3 py-2 shadow-lg ${textClass} text-accent-foreground`}
      style={{
        top: position.top,
        right: position.right,
        transform: position.placement === "above" ? "translateY(-100%)" : undefined,
      }}
    >
      <span className={`icon-[material-symbols--warning] mt-0.5 shrink-0 ${iconClass}`} />
      <span className="min-w-0 flex-1 whitespace-pre-line leading-snug">{error.message}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="关闭"
        className="shrink-0 rounded p-0.5 text-foreground-muted transition hover:bg-button-hover-background hover:text-foreground"
      >
        <span className="icon-[material-symbols--close] text-sm leading-none" />
      </button>
    </div>,
    document.body,
  );
}
