import type { PartialOptions } from "overlayscrollbars";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import { type ReactNode, useEffect } from "react";

export type OverlayScrollbarVariant = "panel" | "card";

const VARIANT_THEMES: Record<OverlayScrollbarVariant, string> = {
  panel: "os-theme-panel",
  card: "os-theme-card",
};

function getScrollbarOptions(variant: OverlayScrollbarVariant): PartialOptions {
  return {
    overflow: {
      x: "scroll",
      y: "scroll",
    },
    scrollbars: {
      theme: VARIANT_THEMES[variant],
      visibility: "auto",
      autoHide: "leave",
      autoHideDelay: 700,
      dragScroll: true,
      pointers: ["mouse", "pen"],
    },
  };
}

export function OverlayScrollbar({
  children,
  variant = "panel",
  className,
  viewportRef,
  onViewportScroll,
}: {
  children: ReactNode;
  variant?: OverlayScrollbarVariant;
  className?: string;
  viewportRef?: { current: HTMLElement | null };
  onViewportScroll?: (_event: Event) => void;
}) {
  const rootClassName = ["h-full w-full min-h-0 flex-1", className].filter(Boolean).join(" ");

  useEffect(() => {
    return () => {
      if (viewportRef) {
        viewportRef.current = null;
      }
    };
  }, [viewportRef]);

  return (
    <OverlayScrollbarsComponent
      defer
      options={getScrollbarOptions(variant)}
      events={{
        initialized(instance) {
          if (viewportRef) {
            viewportRef.current = instance.elements().viewport;
          }
        },
        scroll(instance, event) {
          if (viewportRef) {
            viewportRef.current = instance.elements().viewport;
          }
          onViewportScroll?.(event);
        },
      }}
      className={rootClassName}
      data-overlayscrollbars-initialize
    >
      {children}
    </OverlayScrollbarsComponent>
  );
}
