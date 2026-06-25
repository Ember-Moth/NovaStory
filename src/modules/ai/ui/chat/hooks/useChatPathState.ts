import { useCallback } from "react";

import { rpc } from "@/rpc/client";

import type { StoredProjectChatMessage } from "@/modules/ai/domain/project-chat";

export function useChatPathState(projectId: string, chatId: string) {
  const detailQuery = rpc.useQuery("ai.chats.getDetail", { projectId, chatId });
  const selectChildMutation = rpc.useMutation("ai.chats.selectChild");

  const allMessages = detailQuery.data?.messages ?? [];
  const visibleMessages = detailQuery.data?.visibleMessages ?? [];
  const candidateGroups = detailQuery.data?.candidateGroups ?? [];
  const state = detailQuery.data?.state ?? { selectedChildIdByParentId: {} };

  const reload = useCallback(async () => {
    await detailQuery.refetch();
  }, [detailQuery]);

  const selectChild = useCallback(
    async (parentMessageId: string | null, childMessageId: string) => {
      const result = await selectChildMutation.mutateAsync({
        projectId,
        chatId,
        parentMessageId,
        childMessageId,
      });
      return result.visibleMessages as StoredProjectChatMessage[];
    },
    [projectId, chatId, selectChildMutation],
  );

  return {
    state,
    allMessages,
    visibleMessages,
    candidateGroups,
    isLoading: detailQuery.isLoading,
    reload,
    selectChild,
  };
}
