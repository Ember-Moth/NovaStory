import type {
  ProjectAssistantContextSnapshot,
  TimelineSelectionUpdatedEvent,
  WorkspaceRefreshRequestedEvent,
} from "@/modules/ai/domain/types";

import { getMessagesViewportSessionKey } from "./aiSidebarModel";
import { ComposerPane } from "./composer/ComposerPane";
import { AiAssistantSheetLayout } from "./layout/AiAssistantSheetLayout";
import { useAssistantSheetLayout } from "./layout/useAssistantSheetLayout";
import { MessagesPane } from "./messages/MessagesPane";
import { SessionPane } from "./sessions/SessionPane";
import { useAiAssistantController } from "./runtime/useAiAssistantController";

export { getMessagesViewportSessionKey, shouldAnimateMessageMount } from "./aiSidebarModel";

export function AiSidebar({
  projectId,
  context,
  onWorkspaceRefreshRequested,
}: {
  projectId: string;
  context?: ProjectAssistantContextSnapshot | null;
  onWorkspaceRefreshRequested?: (
    _event: WorkspaceRefreshRequestedEvent | TimelineSelectionUpdatedEvent,
  ) => void;
}) {
  const controller = useAiAssistantController(projectId, onWorkspaceRefreshRequested, context);
  const layout = useAssistantSheetLayout({
    defaultState: "peek",
  });

  return (
    <aside className="flex h-full w-96 max-w-[42vw] min-w-72 shrink-0 flex-col overflow-hidden border-l border-border bg-sidebar-background">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-title-bar-background px-3">
        <span className="icon-[material-symbols--smart-toy] text-lg text-accent-foreground" />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
          AI 助手
        </span>
        <button
          type="button"
          onClick={() => void controller.handleCreateThread()}
          disabled={controller.isThreadMutating}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-[11px] text-foreground-muted transition hover:bg-list-hover-background hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span className="icon-[material-symbols--add]" />
          <span>新建会话</span>
        </button>
      </div>

      <AiAssistantSheetLayout
        layout={layout}
        sessionPane={
          <SessionPane
            controller={controller}
            onActivate={(threadId) => {
              if (layout.sheetState === "expanded") {
                layout.setSheetState("peek");
              }
              void controller.handleActivateThread(threadId);
            }}
          />
        }
        messagesViewportPane={
          <MessagesPane
            controller={controller}
            sessionKey={getMessagesViewportSessionKey(controller.activeThreadId)}
          />
        }
        composerPane={<ComposerPane controller={controller} />}
      />
    </aside>
  );
}
