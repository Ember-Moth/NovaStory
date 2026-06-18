import { useCallback, useEffect, useState } from "react";

import type {
  ProjectChatCandidateGroup,
  ProjectChatPathState,
  StoredProjectChatMessage,
} from "@/modules/ai/domain/project-chat";

export function useChatPathState(projectId: string, chatId: string) {
  const [visibleMessages, setVisibleMessages] = useState<StoredProjectChatMessage[]>([]);
  const [allMessages, setAllMessages] = useState<StoredProjectChatMessage[]>([]);
  const [candidateGroups, setCandidateGroups] = useState<ProjectChatCandidateGroup[]>([]);
  const [state, setState] = useState<ProjectChatPathState>({
    selectedChildIdByParentId: {},
  });
  const [isLoading, setIsLoading] = useState(true);

  const reload = useCallback(async () => {
    setIsLoading(true);
    const response = await fetch(`/api/chats/${chatId}?projectId=${projectId}`);
    const data = await response.json();
    setAllMessages(data.messages);
    setVisibleMessages(data.visibleMessages);
    setCandidateGroups(data.candidateGroups);
    setState(data.state);
    setIsLoading(false);
    return data;
  }, [chatId, projectId]);

  const selectChild = useCallback(
    async (parentMessageId: string | null, childMessageId: string) => {
      const response = await fetch(`/api/chats/${chatId}/selection?projectId=${projectId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          parentMessageId,
          childMessageId,
        }),
      });
      const data = await response.json();
      setVisibleMessages(data.visibleMessages);
      setCandidateGroups(data.candidateGroups);
      setState(data.state);
      return data.visibleMessages as StoredProjectChatMessage[];
    },
    [chatId, projectId],
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  return {
    state,
    allMessages,
    visibleMessages,
    candidateGroups,
    isLoading,
    reload,
    selectChild,
  };
}
