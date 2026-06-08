import type { PartialOptions } from "overlayscrollbars";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import { type ReactNode } from "react";

const SCROLLBAR_OPTIONS: PartialOptions = {
  overflow: {
    x: "scroll",
    y: "scroll",
  },
  scrollbars: {
    theme: "os-theme-panel",
    visibility: "auto",
    autoHide: "leave",
    autoHideDelay: 700,
    dragScroll: true,
    pointers: ["mouse", "pen"],
  },
};

export function OverlayScrollbar({ children }: { children: ReactNode }) {
  return (
    <OverlayScrollbarsComponent
      defer
      options={SCROLLBAR_OPTIONS}
      className="flex-1 min-h-0"
      data-overlayscrollbars-initialize
    >
      {children}
    </OverlayScrollbarsComponent>
  );
}
