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
import type {
  ProjectChatCandidateGroup,
  ProjectChatInfo,
  ProjectChatModelConfig,
  ProjectChatPathState,
  StoredProjectChatMessage,
} from "@/modules/ai/domain/project-chat/types";
import { streamRegistry } from "@/modules/ai/server/project-chat/stream-registry";
import { assertRpcFound } from "@/rpc/errors";
import { rpcTags } from "@/rpc/tags";

export async function list(input: {
  projectId: string;
  archived?: boolean | "all";
}): Promise<{ data: { chats: ProjectChatInfo[] }; watch?: unknown[] }> {
  const data = await (async ({ projectId, archived }) => ({
    chats: await listProjectChats(projectId, { archived }),
  }))(input);
  const watch = (({ projectId }) => [rpcTags.projectChats(projectId)])(input);
  return { data, ...(watch ? { watch } : {}) };
}

export async function create(input: {
  projectId: string;
  title?: string;
  modelConfig?: ProjectChatModelConfig;
}): Promise<{ data: { chat: ProjectChatInfo }; invalidate?: unknown[] }> {
  const data = await (async ({ projectId, title, modelConfig }) => ({
    chat: await createProjectChat(projectId, { title, modelConfig }),
  }))(input);
  const invalidate = (({ projectId }) => [rpcTags.projectChats(projectId)])(input);
  return { data, ...(invalidate ? { invalidate } : {}) };
}

export async function getDetail(input: {
  projectId: string;
  chatId: string;
}): Promise<{ data: Awaited<ReturnType<typeof getProjectChatDetail>>; watch?: unknown[] }> {
  const data = await (async ({ projectId, chatId }) => {
    const chat = await getProjectChat(projectId, chatId);
    assertRpcFound(chat, "未找到会话。");
    return await getProjectChatDetail(projectId, chatId);
  })(input);
  const watch = (({ chatId }) => [rpcTags.projectChat(chatId)])(input);
  return { data, ...(watch ? { watch } : {}) };
}

export async function update(input: {
  projectId: string;
  chatId: string;
  title?: string;
  modelConfig?: ProjectChatModelConfig;
}): Promise<{ data: { chat: ProjectChatInfo }; invalidate?: unknown[] }> {
  const data = await (async ({ projectId, chatId, title, modelConfig }) => {
    const chat = await getProjectChat(projectId, chatId);
    assertRpcFound(chat, "未找到会话。");
    return {
      chat: await updateProjectChat(projectId, chatId, {
        ...(title !== undefined ? { title } : {}),
        ...(modelConfig ? { modelConfig } : {}),
      }),
    };
  })(input);
  const invalidate = (({ projectId, chatId }) => [
    rpcTags.projectChats(projectId),
    rpcTags.projectChat(chatId),
  ])(input);
  return { data, ...(invalidate ? { invalidate } : {}) };
}

export async function deleteMutation(input: {
  projectId: string;
  chatId: string;
}): Promise<{ data: { success: boolean }; invalidate?: unknown[] }> {
  const data = await (async ({ projectId, chatId }) => {
    const chat = await getProjectChat(projectId, chatId);
    assertRpcFound(chat, "未找到会话。");
    await deleteProjectChat(projectId, chatId);
    return { success: true };
  })(input);
  const invalidate = (({ projectId }) => [
    rpcTags.projectChats(projectId),
    rpcTags.projectChat(""),
  ])(input);
  return { data, ...(invalidate ? { invalidate } : {}) };
}

export async function archive(input: {
  projectId: string;
  chatId: string;
  archived: boolean;
}): Promise<{ data: { chat: ProjectChatInfo }; invalidate?: unknown[] }> {
  const data = await (async ({ projectId, chatId, archived }) => {
    const chat = await getProjectChat(projectId, chatId);
    assertRpcFound(chat, "未找到会话。");
    return {
      chat: await archiveProjectChat(projectId, chatId, archived),
    };
  })(input);
  const invalidate = (({ projectId, chatId }) => [
    rpcTags.projectChats(projectId),
    rpcTags.projectChat(chatId),
  ])(input);
  return { data, ...(invalidate ? { invalidate } : {}) };
}

export async function getState(input: { projectId: string; chatId: string }): Promise<{
  data: {
    state: ProjectChatPathState;
    visibleMessages: StoredProjectChatMessage[];
    candidateGroups: ProjectChatCandidateGroup[];
  };
  watch?: unknown[];
}> {
  const data = await (async ({ projectId, chatId }) => {
    const chat = await getProjectChat(projectId, chatId);
    assertRpcFound(chat, "未找到会话。");
    const detail = await getProjectChatDetail(projectId, chatId);
    return {
      state: detail.state,
      visibleMessages: detail.visibleMessages,
      candidateGroups: detail.candidateGroups,
    };
  })(input);
  const watch = (({ chatId }) => [rpcTags.projectChat(chatId)])(input);
  return { data, ...(watch ? { watch } : {}) };
}

export async function selectChild(input: {
  projectId: string;
  chatId: string;
  parentMessageId?: string | null;
  childMessageId: string;
}): Promise<{
  data: {
    state: ProjectChatPathState;
    visibleMessages: StoredProjectChatMessage[];
    candidateGroups: ProjectChatCandidateGroup[];
  };
  invalidate?: unknown[];
}> {
  const data = await (async ({ projectId, chatId, parentMessageId, childMessageId }) => {
    const chat = await getProjectChat(projectId, chatId);
    assertRpcFound(chat, "未找到会话。");
    await selectProjectChatMessageChild(projectId, chatId, parentMessageId ?? null, childMessageId);
    const detail = await getProjectChatDetail(projectId, chatId);
    return {
      state: detail.state,
      visibleMessages: detail.visibleMessages,
      candidateGroups: detail.candidateGroups,
    };
  })(input);
  const invalidate = (({ chatId }) => [rpcTags.projectChat(chatId)])(input);
  return { data, ...(invalidate ? { invalidate } : {}) };
}

export async function abort(input: {
  projectId: string;
  chatId: string;
}): Promise<{ data: { success: boolean; message: string } }> {
  const data = await (async ({ chatId }) => {
    const aborted = streamRegistry.abortByChatId(chatId);
    return {
      success: aborted,
      message: aborted ? "Stream aborted" : "No active stream found",
    };
  })(input);
  return { data };
}

export async function getModelConfig(input: {
  projectId: string;
}): Promise<{ data: ProjectChatModelConfig; watch?: unknown[] }> {
  const data = await (async ({ projectId }) => await getProjectChatDefaultModelConfig(projectId))(
    input,
  );
  const watch = (({ projectId }) => [rpcTags.projectChatModelConfig(projectId)])(input);
  return { data, ...(watch ? { watch } : {}) };
}

export async function setModelConfig(input: {
  projectId: string;
  modelConfig: Partial<ProjectChatModelConfig>;
}): Promise<{ data: ProjectChatModelConfig; invalidate?: unknown[] }> {
  const data = await (async ({ projectId, modelConfig }) =>
    await updateProjectChatDefaultModelConfig(projectId, modelConfig))(input);
  const invalidate = (({ projectId }) => [rpcTags.projectChatModelConfig(projectId)])(input);
  return { data, ...(invalidate ? { invalidate } : {}) };
}
