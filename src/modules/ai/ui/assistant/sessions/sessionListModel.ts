import type { AgentThreadView } from "@/modules/ai/domain/types";

export type SessionListRow =
  | {
      key: string;
      type: "thread";
      thread: AgentThreadView;
      className?: string;
    }
  | {
      key: "archived-toggle";
      type: "archived-toggle";
      count: number;
    };

export function buildSessionRows({
  unarchivedThreads,
  archivedThreads,
  showArchivedThreads,
}: {
  unarchivedThreads: AgentThreadView[];
  archivedThreads: AgentThreadView[];
  showArchivedThreads: boolean;
}): SessionListRow[] {
  const rows: SessionListRow[] = [];

  rows.push(
    ...unarchivedThreads.map((thread) => ({
      key: thread.id,
      type: "thread" as const,
      thread,
    })),
  );

  if (archivedThreads.length === 0) {
    return rows;
  }

  rows.push({
    key: "archived-toggle",
    type: "archived-toggle",
    count: archivedThreads.length,
  });

  if (!showArchivedThreads) {
    return rows;
  }

  archivedThreads.forEach((thread, index) => {
    const classNames = [
      index === 0 ? "mt-1" : "",
      index === archivedThreads.length - 1 ? "pb-1" : "",
    ]
      .filter(Boolean)
      .join(" ");

    rows.push({
      key: thread.id,
      type: "thread",
      thread,
      className: classNames || undefined,
    });
  });

  return rows;
}

export function resolveExpectedActiveThreadAfterArchiveToggle({
  activeThreadId,
  thread,
  archived,
  unarchivedThreads,
}: {
  activeThreadId: string | null;
  thread: AgentThreadView;
  archived: boolean;
  unarchivedThreads: AgentThreadView[];
}) {
  if (archived && thread.id === activeThreadId) {
    const fallbackThread = unarchivedThreads.find((current) => current.id !== thread.id) ?? null;
    return fallbackThread?.id ?? "";
  }

  if (!archived && activeThreadId == null) {
    return thread.id;
  }

  return null;
}
