import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/shared/lib/cn";
import { OverlayScrollbar } from "@/shared/ui/OverlayScrollbar";

export function MarkdownTable({
  children,
  className,
  node: _node,
  ...props
}: ComponentProps<"table"> & {
  children?: ReactNode;
  node?: unknown;
}) {
  return (
    <div
      className="my-4 overflow-hidden rounded-md border border-border bg-editor-background"
      data-streamdown="table-wrapper"
    >
      <OverlayScrollbar variant="inline" className="ai-table-scrollbar">
        <table
          {...props}
          className={cn("w-full min-w-full border-separate border-spacing-0", className)}
          data-streamdown="table"
        >
          {children}
        </table>
      </OverlayScrollbar>
    </div>
  );
}
