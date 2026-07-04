import { type ComponentProps, type ReactNode, type UIEvent, useEffect } from "react";
import SimpleBar from "simplebar-react";

import { cn } from "../lib/cn";

export type OverlayScrollbarVariant = "panel" | "card" | "inline";

const VARIANT_CLASSES: Record<OverlayScrollbarVariant, string> = {
  panel: "scrollbar-panel",
  card: "scrollbar-card",
  inline: "scrollbar-inline",
};

export function OverlayScrollbar({
  children,
  variant = "panel",
  className,
  viewportRef,
  onViewportScroll,
  ...props
}: {
  children: ReactNode;
  variant?: OverlayScrollbarVariant;
  className?: string;
  viewportRef?: { current: HTMLElement | null };
  onViewportScroll?: (_event: Event) => void;
} & Omit<ComponentProps<"div">, "children" | "className" | "ref">) {
  const rootClassName = cn(
    variant === "inline" ? "w-full max-w-full min-w-0" : "h-full w-full min-h-0 flex-1",
    VARIANT_CLASSES[variant],
    className,
  );

  useEffect(() => {
    return () => {
      if (viewportRef) {
        viewportRef.current = null;
      }
    };
  }, [viewportRef]);

  return (
    <SimpleBar
      autoHide
      scrollableNodeProps={{
        ref(node: HTMLElement | null) {
          if (viewportRef) {
            viewportRef.current = node;
          }
        },
        onScroll(event: UIEvent<HTMLElement>) {
          if (viewportRef) {
            viewportRef.current = event.currentTarget;
          }
          onViewportScroll?.(event.nativeEvent);
        },
      }}
      className={rootClassName}
      {...props}
    >
      {children}
    </SimpleBar>
  );
}
