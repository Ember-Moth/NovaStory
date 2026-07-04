import { useCallback, useMemo } from "react";
import type {
  ProjectChatCandidateGroup,
  ProjectChatPathState,
  StoredProjectChatMessage,
} from "@/modules/ai/domain/project-chat";
import { rpc } from "@/rpc/client";

const EMPTY_STATE: ProjectChatPathState = { selectedChildIdByParentId: {} };

export function useChatPathState(projectId: string, chatId: string) {
  const detailQuery = rpc.useQuery("ai.chats.getDetail", { projectId, chatId });
  const selectChildMutation = rpc.useMutation("ai.chats.selectChild");

  const queryData = detailQuery.data;

  const allMessages = useMemo(
    () => queryData?.messages ?? ([] as StoredProjectChatMessage[]),
    [queryData?.messages],
  );
  const visibleMessages = useMemo(
    () => queryData?.visibleMessages ?? ([] as StoredProjectChatMessage[]),
    [queryData?.visibleMessages],
  );
  const candidateGroups = useMemo(
    () => queryData?.candidateGroups ?? ([] as ProjectChatCandidateGroup[]),
    [queryData?.candidateGroups],
  );
  const state = useMemo(() => queryData?.state ?? EMPTY_STATE, [queryData?.state]);

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
