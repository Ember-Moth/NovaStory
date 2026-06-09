import type { PartialOptions } from "overlayscrollbars";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import { type ReactNode } from "react";

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
}: {
  children: ReactNode;
  variant?: OverlayScrollbarVariant;
  className?: string;
}) {
  const rootClassName = ["flex-1 min-h-0", className].filter(Boolean).join(" ");

  return (
    <OverlayScrollbarsComponent
      defer
      options={getScrollbarOptions(variant)}
      className={rootClassName}
      data-overlayscrollbars-initialize
    >
      {children}
    </OverlayScrollbarsComponent>
  );
}
