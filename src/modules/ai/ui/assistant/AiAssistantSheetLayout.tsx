import type { ReactNode } from "react";

import { OverlayScrollbar } from "@/shared/ui/OverlayScrollbar";

import type { AssistantSheetLayout } from "./useAssistantSheetLayout";

export type AiAssistantSheetLayoutProps = {
  layout: AssistantSheetLayout;
  sessionPane: ReactNode;
  messagesPane: ReactNode;
  composerPane: ReactNode;
};

export function AiAssistantSheetLayout({
  layout,
  sessionPane,
  messagesPane,
  composerPane,
}: AiAssistantSheetLayoutProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div
        ref={layout.bodyFrameRef}
        className="flex min-h-0 flex-1 flex-col overflow-hidden bg-editor-background"
      >
        <div
          style={{ height: `${layout.sessionSectionHeight}px` }}
          className={`min-h-0 shrink-0 overflow-hidden ${layout.sectionHeightTransitionClass}`}
        >
          <div className="flex h-full min-h-0 flex-col bg-editor-background">
            <div className="relative min-h-0 flex-1">
              <OverlayScrollbar variant="panel">{sessionPane}</OverlayScrollbar>
            </div>
          </div>
        </div>

        <div
          className={`flex min-h-0 flex-1 flex-col overflow-hidden bg-editor-background ${
            layout.sessionSectionHeight > 0 ? "border-t border-border" : ""
          }`}
        >
          <div
            aria-label="调整会话列表和消息区域"
            className="flex h-4 shrink-0 cursor-row-resize touch-none items-center justify-center border-b border-border bg-sidebar-background"
            onPointerDown={layout.handleSheetPointerDown}
            onPointerMove={layout.handleSheetPointerMove}
            onPointerUp={layout.handleSheetPointerUp}
            onPointerCancel={layout.handleSheetPointerCancel}
          >
            <span
              className={`h-px w-8 ${
                layout.isDraggingSheet ? "bg-accent-foreground" : "bg-foreground-muted"
              }`}
            />
          </div>

          <div className="min-h-0 flex-1 overflow-hidden">
            <OverlayScrollbar variant="panel">{messagesPane}</OverlayScrollbar>
          </div>

          <div className="shrink-0 border-t border-border">{composerPane}</div>
        </div>
      </div>
    </div>
  );
}
