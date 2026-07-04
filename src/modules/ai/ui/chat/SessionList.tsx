import type { ProjectChatInfo } from "@/modules/ai/domain/project-chat";
import { cn } from "@/shared/lib/cn";
import { IconButton } from "@/shared/ui/IconButton";

function formatTimestamp(timestamp: number) {
  const date = new Date(timestamp);
  return `${date.getMonth() + 1}-${date.getDate()} ${date
    .getHours()
    .toString()
    .padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`;
}

export function SessionList({
  chats,
  activeChatId,
  showArchived,
  onActivate,
  onArchiveToggle,
  isMutating,
}: {
  chats: ProjectChatInfo[];
  activeChatId: string | null;
  showArchived: boolean;
  onActivate: (_chatId: string) => void;
  onArchiveToggle: (_chatId: string, _archived: boolean) => void;
  isMutating: boolean;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1 flex-col">
        {chats.length === 0 ? (
          <div className="px-3 py-3 text-[12px] text-foreground-muted">暂无会话。</div>
        ) : (
          chats.map((chat) => {
            const active = chat.id === activeChatId;
            const archived = chat.archivedAt != null;

            return (
              <div
                key={chat.id}
                onClick={() => onActivate(chat.id)}
                className={cn(
                  "group flex w-full cursor-pointer items-start gap-2 border-border/60 border-b px-3 py-2 text-left transition",
                  active
                    ? "bg-list-active-background text-foreground"
                    : "text-foreground-muted hover:bg-list-hover-background hover:text-foreground",
                  showArchived && archived && "opacity-50",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 shrink-0 text-base",
                    active
                      ? "icon-[material-symbols--chat-bubble] text-accent-foreground"
                      : "icon-[material-symbols--chat-bubble-outline]",
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-[12px]">{chat.title}</span>
                  <span className="mt-0.5 block text-[10px] text-foreground-muted">
                    {formatTimestamp(chat.updatedAt)}
                  </span>
                </span>
                <IconButton
                  icon={
                    archived
                      ? "icon-[material-symbols--unarchive]"
                      : "icon-[material-symbols--archive-outline]"
                  }
                  title={archived ? "恢复会话" : "归档会话"}
                  disabled={isMutating}
                  onClick={() => onArchiveToggle(chat.id, !archived)}
                  className="opacity-0 group-hover:opacity-100"
                />
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
