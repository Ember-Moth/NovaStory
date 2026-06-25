export function resolveSidebarActiveChat(input: {
  activeChatId: string | null;
  visibleChatIds: string[];
}) {
  const { activeChatId, visibleChatIds } = input;

  if (activeChatId && visibleChatIds.includes(activeChatId)) {
    return {
      nextActiveChatId: activeChatId,
    };
  }

  return {
    nextActiveChatId: visibleChatIds[0] ?? null,
  };
}
