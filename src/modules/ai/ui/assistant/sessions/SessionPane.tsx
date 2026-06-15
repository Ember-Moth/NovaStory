import { AnimatePresence } from "motion/react";

import type { AiAssistantController } from "../runtime/useAiAssistantController";
import { ArchivedSectionToggleRow, AnimatedHeadRow } from "./SessionRow";
import { SessionStatusOverlay } from "./SessionStatusOverlay";

export function SessionPane({
  controller,
  onActivate,
}: {
  controller: AiAssistantController;
  onActivate: (_threadId: string) => void;
}) {
  return (
    <>
      <div className="flex min-h-full flex-col">
        <AnimatePresence initial={false} mode="popLayout">
          {controller.sessionRows.map((row) =>
            row.type === "archived-toggle" ? (
              <ArchivedSectionToggleRow
                key={row.key}
                count={row.count}
                expanded={controller.showArchivedThreads}
                onToggle={() => controller.setShowArchivedThreads((current: boolean) => !current)}
              />
            ) : (
              <AnimatedHeadRow
                key={row.key}
                thread={row.thread}
                isActive={row.thread.id === controller.activeThreadId}
                isEditing={controller.editingThread?.threadId === row.thread.id}
                editingName={
                  controller.editingThread?.threadId === row.thread.id
                    ? controller.editingThread.title
                    : ""
                }
                isBusy={controller.isThreadMutating}
                className={row.className}
                onActivate={() => onActivate(row.thread.id)}
                onEditingNameChange={(value) =>
                  controller.handleEditingThreadTitleChange(row.thread.id, value)
                }
                onRenameStart={() => controller.handleRenameStart(row.thread)}
                onRenameCancel={controller.handleRenameCancel}
                onRenameSubmit={() => void controller.handleRenameSubmit()}
                onArchive={() => void controller.handleArchiveToggle(row.thread, true)}
                onRestore={() => void controller.handleArchiveToggle(row.thread, false)}
              />
            ),
          )}
        </AnimatePresence>
      </div>
      <AnimatePresence initial={false}>
        {controller.sessionOverlayState ? (
          <SessionStatusOverlay
            key={controller.sessionOverlayState}
            state={controller.sessionOverlayState}
          />
        ) : null}
      </AnimatePresence>
    </>
  );
}
