export function getMessagesViewportSessionKey(activeThreadId: string | null) {
  return activeThreadId ?? "__empty-thread__";
}

export function shouldAnimateMessageMount(
  role: string,
  messageId: string,
  streamedAssistantMessageIds: ReadonlySet<string>,
) {
  return !(role === "assistant" && streamedAssistantMessageIds.has(messageId));
}
