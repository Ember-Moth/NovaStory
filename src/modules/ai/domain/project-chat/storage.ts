import { commitCustomRef, readFileAtRef } from "@/modules/workspace/domain/git-storage/git-store";
import { createId, invariant, now } from "@/shared/lib/domain";

import {
  buildProjectChatCandidateGroups,
  resolveVisibleProjectChatPath,
  selectProjectChatChild,
} from "./messages";
import {
  resolveDefaultProjectChatModelConfig,
  resolveProjectChatModelSelection,
} from "./selection";
import type {
  ProjectChatDetail,
  ProjectChatInfo,
  ProjectChatList,
  ProjectChatModelConfig,
  ProjectChatPathState,
  StoredProjectChatMessage,
} from "./types";

const PROJECT_CHAT_REF = "refs/novel-evolver/chats";

function stringifyJson(value: unknown) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function readProjectChatFile(projectId: string, filepath: string): string | null {
  try {
    return readFileAtRef({ projectId, ref: PROJECT_CHAT_REF, filepath });
  } catch {
    return null;
  }
}

function patchProjectChatFiles(
  projectId: string,
  options: { files?: Record<string, string>; filesToDelete?: string[] },
  message: string,
) {
  commitCustomRef({
    projectId,
    ref: PROJECT_CHAT_REF,
    files: options.files,
    filesToDelete: options.filesToDelete,
    message,
  });
}

function readProjectChatList(projectId: string): ProjectChatList {
  const content = readProjectChatFile(projectId, "chat-list.json");
  if (!content) {
    return { version: "v1", projectId, chats: [], updatedAt: now() };
  }
  return JSON.parse(content) as ProjectChatList;
}

function readProjectChatModelConfig(projectId: string): ProjectChatModelConfig | null {
  const content = readProjectChatFile(projectId, "model-config.json");
  if (!content) return null;
  const parsed = JSON.parse(content) as ProjectChatModelConfig;
  try {
    return resolveProjectChatModelSelection(parsed).modelConfig;
  } catch {
    return null;
  }
}

function ensureProjectChatModelConfig(projectId: string): ProjectChatModelConfig {
  return readProjectChatModelConfig(projectId) ?? resolveDefaultProjectChatModelConfig();
}

export async function listProjectChats(
  projectId: string,
  options?: { archived?: boolean },
): Promise<ProjectChatInfo[]> {
  const chatList = readProjectChatList(projectId);
  const archived = options?.archived;

  const filtered = chatList.chats
    .filter((entry) =>
      archived == null ? true : archived ? entry.archivedAt != null : entry.archivedAt == null,
    )
    .sort((left, right) => right.updatedAt - left.updatedAt);

  // Read per-chat files for full metadata (modelConfig is not in the lightweight index)
  const results: ProjectChatInfo[] = [];
  for (const entry of filtered) {
    const chatJson = readProjectChatFile(projectId, `chats/${entry.id}.json`);
    if (chatJson) {
      results.push(JSON.parse(chatJson) as ProjectChatInfo);
    }
  }
  return results;
}

export async function getProjectChat(
  projectId: string,
  chatId: string,
): Promise<ProjectChatInfo | null> {
  const content = readProjectChatFile(projectId, `chats/${chatId}.json`);
  if (!content) return null;
  return JSON.parse(content) as ProjectChatInfo;
}

export async function getProjectChatIndex(projectId: string): Promise<ProjectChatList> {
  return readProjectChatList(projectId);
}

export async function getProjectChatMessages(
  projectId: string,
  chatId: string,
): Promise<StoredProjectChatMessage[]> {
  const content = readProjectChatFile(projectId, `messages/${chatId}.jsonl`) ?? "";
  if (!content.trim()) return [];
  return content
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as StoredProjectChatMessage);
}

export async function writeProjectChatMessages(
  projectId: string,
  chatId: string,
  messages: readonly StoredProjectChatMessage[],
  message: string,
) {
  patchProjectChatFiles(
    projectId,
    {
      files: {
        [`messages/${chatId}.jsonl`]: messages.map((entry) => JSON.stringify(entry)).join("\n"),
      },
    },
    message,
  );
}

export async function getProjectChatPathState(
  projectId: string,
  chatId: string,
): Promise<ProjectChatPathState> {
  const content = readProjectChatFile(projectId, `state/${chatId}.json`);
  if (!content) return { selectedChildIdByParentId: {} };
  return JSON.parse(content) as ProjectChatPathState;
}

export async function selectProjectChatMessageChild(
  projectId: string,
  chatId: string,
  parentMessageId: string | null,
  childMessageId: string,
) {
  const state = await getProjectChatPathState(projectId, chatId);
  const nextState = selectProjectChatChild(state, parentMessageId, childMessageId);
  patchProjectChatFiles(
    projectId,
    {
      files: {
        [`state/${chatId}.json`]: stringifyJson(nextState),
      },
    },
    `Select AI chat branch ${chatId}`,
  );
  return nextState;
}

export async function getProjectChatDefaultModelConfig(projectId: string) {
  return ensureProjectChatModelConfig(projectId);
}

export async function updateProjectChatDefaultModelConfig(
  projectId: string,
  updates: Partial<ProjectChatModelConfig>,
) {
  const baseConfig = ensureProjectChatModelConfig(projectId);
  const nextConfig = resolveProjectChatModelSelection({
    ...baseConfig,
    ...updates,
  }).modelConfig;

  patchProjectChatFiles(
    projectId,
    {
      files: {
        "model-config.json": stringifyJson(nextConfig),
      },
    },
    "Update AI chat default model config",
  );
  return nextConfig;
}

export async function createProjectChat(
  projectId: string,
  options?: {
    title?: string;
    modelConfig?: ProjectChatModelConfig;
  },
) {
  const chatList = readProjectChatList(projectId);
  const timestamp = now();
  const chatId = createId("chat");
  const existingCount = chatList.chats.length;
  const resolvedModelConfig = resolveProjectChatModelSelection(
    options?.modelConfig ?? ensureProjectChatModelConfig(projectId),
  ).modelConfig;

  const chat: ProjectChatInfo = {
    id: chatId,
    title: options?.title?.trim() || `\u65b0\u4f1a\u8bdd ${existingCount + 1}`,
    createdAt: timestamp,
    updatedAt: timestamp,
    archivedAt: null,
    modelConfig: resolvedModelConfig,
  };

  chatList.chats.push({
    id: chatId,
    title: chat.title,
    createdAt: timestamp,
    updatedAt: timestamp,
    archivedAt: null,
  });
  chatList.updatedAt = timestamp;

  patchProjectChatFiles(
    projectId,
    {
      files: {
        "chat-list.json": stringifyJson(chatList),
        [`chats/${chatId}.json`]: stringifyJson(chat),
        [`state/${chatId}.json`]: stringifyJson({ selectedChildIdByParentId: {} }),
        [`messages/${chatId}.jsonl`]: "",
      },
    },
    `Create AI chat ${chatId}`,
  );
  return chat;
}

export async function updateProjectChat(
  projectId: string,
  chatId: string,
  updates: Partial<Pick<ProjectChatInfo, "title" | "archivedAt" | "modelConfig" | "updatedAt">>,
) {
  const chatJson = readProjectChatFile(projectId, `chats/${chatId}.json`);
  invariant(chatJson, "\u672a\u627e\u5230\u4f1a\u8bdd\u3002");

  const existing = JSON.parse(chatJson) as ProjectChatInfo;
  const nextChat: ProjectChatInfo = {
    ...existing,
    ...(updates.title != null ? { title: updates.title.trim() || existing.title } : {}),
    ...(updates.archivedAt !== undefined ? { archivedAt: updates.archivedAt } : {}),
    ...(updates.modelConfig
      ? { modelConfig: resolveProjectChatModelSelection(updates.modelConfig).modelConfig }
      : {}),
    updatedAt: updates.updatedAt ?? now(),
  };

  // Update chat-list.json entry too
  const chatList = readProjectChatList(projectId);
  const listIndex = chatList.chats.findIndex((entry) => entry.id === chatId);
  if (listIndex >= 0) {
    chatList.chats[listIndex] = {
      id: nextChat.id,
      title: nextChat.title,
      createdAt: nextChat.createdAt,
      updatedAt: nextChat.updatedAt,
      archivedAt: nextChat.archivedAt,
    };
    chatList.updatedAt = now();
  }

  patchProjectChatFiles(
    projectId,
    {
      files: {
        "chat-list.json": stringifyJson(chatList),
        [`chats/${chatId}.json`]: stringifyJson(nextChat),
      },
    },
    `Update AI chat ${chatId}`,
  );
  return nextChat;
}

export async function archiveProjectChat(projectId: string, chatId: string, archived: boolean) {
  return await updateProjectChat(projectId, chatId, {
    archivedAt: archived ? now() : null,
  });
}

export async function deleteProjectChat(projectId: string, chatId: string) {
  const chatList = readProjectChatList(projectId);
  const entry = chatList.chats.find((e) => e.id === chatId);
  invariant(entry, "\u672a\u627e\u5230\u4f1a\u8bdd\u3002");

  chatList.chats = chatList.chats.filter((e) => e.id !== chatId);
  chatList.updatedAt = now();

  patchProjectChatFiles(
    projectId,
    {
      files: {
        "chat-list.json": stringifyJson(chatList),
      },
      filesToDelete: [`chats/${chatId}.json`, `state/${chatId}.json`, `messages/${chatId}.jsonl`],
    },
    `Delete AI chat ${chatId}`,
  );
}

export async function getProjectChatDetail(
  projectId: string,
  chatId: string,
): Promise<ProjectChatDetail> {
  const chatJson = readProjectChatFile(projectId, `chats/${chatId}.json`);
  invariant(chatJson, "\u672a\u627e\u5230\u4f1a\u8bdd\u3002");
  const chat = JSON.parse(chatJson) as ProjectChatInfo;

  const messages = await getProjectChatMessages(projectId, chatId);
  const chatState = await getProjectChatPathState(projectId, chatId);
  const visibleMessages = resolveVisibleProjectChatPath(messages, chatState);

  return {
    chat,
    messages,
    visibleMessages,
    state: chatState,
    candidateGroups: buildProjectChatCandidateGroups(messages, chatState),
  };
}
