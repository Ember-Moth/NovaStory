import { mutation, query } from "@codehz/rpc/core";

import type {
  ProjectChatCandidateGroup,
  ProjectChatInfo,
  ProjectChatModelConfig,
  ProjectChatPathState,
  StoredProjectChatMessage,
} from "@/modules/ai/domain/project-chat/types";
import {
  archiveProjectChat,
  createProjectChat,
  deleteProjectChat,
  getProjectChat,
  getProjectChatDefaultModelConfig,
  getProjectChatDetail,
  listProjectChats,
  selectProjectChatMessageChild,
  updateProjectChat,
  updateProjectChatDefaultModelConfig,
} from "@/modules/ai/domain/project-chat/storage";
import { streamRegistry } from "@/modules/ai/server/project-chat/stream-registry";
import { assertRpcFound } from "@/rpc/errors";
import { rpcTags, type RpcTagList } from "@/rpc/tags";

export const list = query<
  { projectId: string; archived?: boolean | "all" },
  { chats: ProjectChatInfo[] },
  RpcTagList
>({
  watch: ({ projectId }) => [rpcTags.projectChats(projectId)],
  handler: async ({ projectId, archived }) => ({
    chats: await listProjectChats(projectId, { archived }),
  }),
});

export const create = mutation<
  { projectId: string; title?: string; modelConfig?: ProjectChatModelConfig },
  { chat: ProjectChatInfo },
  RpcTagList
>({
  invalidate: ({ projectId }) => [rpcTags.projectChats(projectId)],
  handler: async ({ projectId, title, modelConfig }) => ({
    chat: await createProjectChat(projectId, { title, modelConfig }),
  }),
});

export const getDetail = query<
  { projectId: string; chatId: string },
  Awaited<ReturnType<typeof getProjectChatDetail>>,
  RpcTagList
>({
  watch: ({ chatId }) => [rpcTags.projectChat(chatId)],
  handler: async ({ projectId, chatId }) => {
    const chat = await getProjectChat(projectId, chatId);
    assertRpcFound(chat, "未找到会话。");
    return await getProjectChatDetail(projectId, chatId);
  },
});

export const update = mutation<
  {
    projectId: string;
    chatId: string;
    title?: string;
    modelConfig?: ProjectChatModelConfig;
  },
  { chat: ProjectChatInfo },
  RpcTagList
>({
  invalidate: ({ projectId, chatId }) => [
    rpcTags.projectChats(projectId),
    rpcTags.projectChat(chatId),
  ],
  handler: async ({ projectId, chatId, title, modelConfig }) => {
    const chat = await getProjectChat(projectId, chatId);
    assertRpcFound(chat, "未找到会话。");
    return {
      chat: await updateProjectChat(projectId, chatId, {
        ...(title !== undefined ? { title } : {}),
        ...(modelConfig ? { modelConfig } : {}),
      }),
    };
  },
});

export const deleteMutation = mutation<
  { projectId: string; chatId: string },
  { success: boolean },
  RpcTagList
>({
  invalidate: ({ projectId }) => [rpcTags.projectChats(projectId), rpcTags.projectChat("")],
  handler: async ({ projectId, chatId }) => {
    const chat = await getProjectChat(projectId, chatId);
    assertRpcFound(chat, "未找到会话。");
    await deleteProjectChat(projectId, chatId);
    return { success: true };
  },
});

export const archive = mutation<
  { projectId: string; chatId: string; archived: boolean },
  { chat: ProjectChatInfo },
  RpcTagList
>({
  invalidate: ({ projectId, chatId }) => [
    rpcTags.projectChats(projectId),
    rpcTags.projectChat(chatId),
  ],
  handler: async ({ projectId, chatId, archived }) => {
    const chat = await getProjectChat(projectId, chatId);
    assertRpcFound(chat, "未找到会话。");
    return {
      chat: await archiveProjectChat(projectId, chatId, archived),
    };
  },
});

export const getState = query<
  { projectId: string; chatId: string },
  {
    state: ProjectChatPathState;
    visibleMessages: StoredProjectChatMessage[];
    candidateGroups: ProjectChatCandidateGroup[];
  },
  RpcTagList
>({
  watch: ({ chatId }) => [rpcTags.projectChat(chatId)],
  handler: async ({ projectId, chatId }) => {
    const chat = await getProjectChat(projectId, chatId);
    assertRpcFound(chat, "未找到会话。");
    const detail = await getProjectChatDetail(projectId, chatId);
    return {
      state: detail.state,
      visibleMessages: detail.visibleMessages,
      candidateGroups: detail.candidateGroups,
    };
  },
});

export const selectChild = mutation<
  {
    projectId: string;
    chatId: string;
    parentMessageId?: string | null;
    childMessageId: string;
  },
  {
    state: ProjectChatPathState;
    visibleMessages: StoredProjectChatMessage[];
    candidateGroups: ProjectChatCandidateGroup[];
  },
  RpcTagList
>({
  invalidate: ({ chatId }) => [rpcTags.projectChat(chatId)],
  handler: async ({ projectId, chatId, parentMessageId, childMessageId }) => {
    const chat = await getProjectChat(projectId, chatId);
    assertRpcFound(chat, "未找到会话。");
    await selectProjectChatMessageChild(projectId, chatId, parentMessageId ?? null, childMessageId);
    const detail = await getProjectChatDetail(projectId, chatId);
    return {
      state: detail.state,
      visibleMessages: detail.visibleMessages,
      candidateGroups: detail.candidateGroups,
    };
  },
});

export const abort = mutation<
  { projectId: string; chatId: string },
  { success: boolean; message: string }
>({
  handler: async ({ chatId }) => {
    const aborted = streamRegistry.abortByChatId(chatId);
    return {
      success: aborted,
      message: aborted ? "Stream aborted" : "No active stream found",
    };
  },
});

export const getModelConfig = query<{ projectId: string }, ProjectChatModelConfig, RpcTagList>({
  watch: ({ projectId }) => [rpcTags.projectChatModelConfig(projectId)],
  handler: async ({ projectId }) => await getProjectChatDefaultModelConfig(projectId),
});

export const setModelConfig = mutation<
  { projectId: string; modelConfig: Partial<ProjectChatModelConfig> },
  ProjectChatModelConfig,
  RpcTagList
>({
  invalidate: ({ projectId }) => [rpcTags.projectChatModelConfig(projectId)],
  handler: async ({ projectId, modelConfig }) =>
    await updateProjectChatDefaultModelConfig(projectId, modelConfig),
});
