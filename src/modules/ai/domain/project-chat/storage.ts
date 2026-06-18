import { readProjectMetaSync } from "@/modules/workspace/domain/git-storage/project-meta-store";
import {
  commitCustomRefSync,
  readFilesAtRefSync,
} from "@/modules/workspace/domain/git-storage/git-store";
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
  ProjectChatIndex,
  ProjectChatInfo,
  ProjectChatModelConfig,
  ProjectChatPathState,
  ProjectChatState,
  StoredProjectChatMessage,
} from "./types";

const PROJECT_CHAT_REF_PREFIX = "refs/novel-evolver/ai-chats";
const CHAT_INDEX_FILE = "index.json";
const CHAT_STATE_FILE = "state.json";
const PROJECT_MODEL_CONFIG_FILE = "model-config.json";

type ProjectChatStorageFiles = Record<string, string>;

function projectChatRef() {
  return PROJECT_CHAT_REF_PREFIX;
}

function readProjectChatStorageFiles(projectId: string): ProjectChatStorageFiles {
  readProjectMetaSync(projectId);

  try {
    return readFilesAtRefSync({ projectId, ref: projectChatRef() });
  } catch {
    return {};
  }
}

function writeProjectChatStorageFiles(
  projectId: string,
  files: ProjectChatStorageFiles,
  message: string,
) {
  commitCustomRefSync({
    projectId,
    ref: projectChatRef(),
    files,
    message,
    replace: true,
  });
}

function stringifyJson(value: unknown) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function parseStoredJson<T>(value: string | undefined, fallback: T) {
  if (!value) {
    return fallback;
  }
  return JSON.parse(value) as T;
}

function emptyChatIndex(projectId: string): ProjectChatIndex {
  return {
    version: "v1",
    projectId,
    chats: [],
    updatedAt: now(),
  };
}

function emptyProjectChatState(): ProjectChatState {
  return {
    version: "v1",
    chats: {},
    updatedAt: now(),
  };
}

function normalizeProjectChatPathState(
  state: ProjectChatPathState | null | undefined,
): ProjectChatPathState {
  return {
    selectedChildIdByParentId: {
      ...(state?.selectedChildIdByParentId ?? {}),
    },
  };
}

function readProjectChatIndexFromFiles(projectId: string, files: ProjectChatStorageFiles) {
  return parseStoredJson(files[CHAT_INDEX_FILE], emptyChatIndex(projectId));
}

function readProjectChatStateFromFiles(files: ProjectChatStorageFiles) {
  return parseStoredJson(files[CHAT_STATE_FILE], emptyProjectChatState());
}

function readProjectChatModelConfigFromFiles(
  files: ProjectChatStorageFiles,
): ProjectChatModelConfig | null {
  return parseStoredJson<ProjectChatModelConfig | null>(files[PROJECT_MODEL_CONFIG_FILE], null);
}

function writeProjectChatFiles({
  projectId,
  files,
  index,
  state,
  modelConfig,
  message,
}: {
  projectId: string;
  files: ProjectChatStorageFiles;
  index: ProjectChatIndex;
  state?: ProjectChatState;
  modelConfig?: ProjectChatModelConfig | null;
  message: string;
}) {
  const nextFiles: ProjectChatStorageFiles = {
    ...files,
    [CHAT_INDEX_FILE]: stringifyJson(index),
  };

  if (state) {
    nextFiles[CHAT_STATE_FILE] = stringifyJson(state);
  }
  if (modelConfig) {
    nextFiles[PROJECT_MODEL_CONFIG_FILE] = stringifyJson(modelConfig);
  }

  writeProjectChatStorageFiles(projectId, nextFiles, message);
}

export function listProjectChats(projectId: string, options?: { archived?: boolean }) {
  const files = readProjectChatStorageFiles(projectId);
  const index = readProjectChatIndexFromFiles(projectId, files);
  const archived = options?.archived;

  return index.chats
    .filter((chat) =>
      archived == null ? true : archived ? chat.archivedAt != null : chat.archivedAt == null,
    )
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

export function getProjectChat(projectId: string, chatId: string) {
  const files = readProjectChatStorageFiles(projectId);
  const index = readProjectChatIndexFromFiles(projectId, files);
  return index.chats.find((chat) => chat.id === chatId) ?? null;
}

export function getProjectChatIndex(projectId: string) {
  const files = readProjectChatStorageFiles(projectId);
  return readProjectChatIndexFromFiles(projectId, files);
}

export function getProjectChatMessages(projectId: string, chatId: string) {
  const files = readProjectChatStorageFiles(projectId);
  const content = files[`${chatId}.jsonl`] ?? "";
  if (!content.trim()) {
    return [] as StoredProjectChatMessage[];
  }
  return content
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as StoredProjectChatMessage);
}

export function writeProjectChatMessages(
  projectId: string,
  chatId: string,
  messages: readonly StoredProjectChatMessage[],
  message: string,
) {
  const files = readProjectChatStorageFiles(projectId);
  const index = readProjectChatIndexFromFiles(projectId, files);
  files[`${chatId}.jsonl`] = messages.map((entry) => JSON.stringify(entry)).join("\n");
  writeProjectChatFiles({
    projectId,
    files,
    index,
    message,
  });
}

export function getProjectChatPathState(projectId: string, chatId: string) {
  const files = readProjectChatStorageFiles(projectId);
  const state = readProjectChatStateFromFiles(files);
  return normalizeProjectChatPathState(state.chats[chatId]);
}

export function selectProjectChatMessageChild(
  projectId: string,
  chatId: string,
  parentMessageId: string | null,
  childMessageId: string,
) {
  const files = readProjectChatStorageFiles(projectId);
  const index = readProjectChatIndexFromFiles(projectId, files);
  const state = readProjectChatStateFromFiles(files);
  state.chats[chatId] = selectProjectChatChild(
    normalizeProjectChatPathState(state.chats[chatId]),
    parentMessageId,
    childMessageId,
  );
  state.updatedAt = now();
  writeProjectChatFiles({
    projectId,
    files,
    index,
    state,
    message: `Select AI chat branch ${chatId}`,
  });
  return state.chats[chatId];
}

function ensureProjectChatModelConfig(files: ProjectChatStorageFiles) {
  const stored = readProjectChatModelConfigFromFiles(files);
  if (stored) {
    return resolveProjectChatModelSelection(stored).modelConfig;
  }
  return resolveDefaultProjectChatModelConfig();
}

export function getProjectChatDefaultModelConfig(projectId: string) {
  const files = readProjectChatStorageFiles(projectId);
  return ensureProjectChatModelConfig(files);
}

export function updateProjectChatDefaultModelConfig(
  projectId: string,
  updates: Partial<ProjectChatModelConfig>,
) {
  const files = readProjectChatStorageFiles(projectId);
  const index = readProjectChatIndexFromFiles(projectId, files);
  const baseConfig = ensureProjectChatModelConfig(files);
  const nextConfig = resolveProjectChatModelSelection({
    ...baseConfig,
    ...updates,
  }).modelConfig;

  writeProjectChatFiles({
    projectId,
    files,
    index,
    modelConfig: nextConfig,
    message: "Update AI chat default model config",
  });
  return nextConfig;
}

export function createProjectChat(
  projectId: string,
  options?: {
    title?: string;
    modelConfig?: ProjectChatModelConfig;
  },
) {
  const files = readProjectChatStorageFiles(projectId);
  const index = readProjectChatIndexFromFiles(projectId, files);
  const state = readProjectChatStateFromFiles(files);
  const timestamp = now();
  const chatId = createId("chat");
  const existingCount = index.chats.length;
  const resolvedModelConfig = resolveProjectChatModelSelection(
    options?.modelConfig ?? ensureProjectChatModelConfig(files),
  ).modelConfig;
  const chat: ProjectChatInfo = {
    id: chatId,
    title: options?.title?.trim() || `新会话 ${existingCount + 1}`,
    createdAt: timestamp,
    updatedAt: timestamp,
    archivedAt: null,
    modelConfig: resolvedModelConfig,
  };

  index.chats.push(chat);
  index.updatedAt = timestamp;
  state.chats[chatId] = normalizeProjectChatPathState(state.chats[chatId]);
  state.updatedAt = timestamp;
  files[`${chatId}.jsonl`] = "";

  writeProjectChatFiles({
    projectId,
    files,
    index,
    state,
    modelConfig: readProjectChatModelConfigFromFiles(files) ?? ensureProjectChatModelConfig(files),
    message: `Create AI chat ${chatId}`,
  });
  return chat;
}

export function updateProjectChat(
  projectId: string,
  chatId: string,
  updates: Partial<Pick<ProjectChatInfo, "title" | "archivedAt" | "modelConfig" | "updatedAt">>,
) {
  const files = readProjectChatStorageFiles(projectId);
  const index = readProjectChatIndexFromFiles(projectId, files);
  const chatIndex = index.chats.findIndex((chat) => chat.id === chatId);
  invariant(chatIndex >= 0, "未找到会话。");

  const existing = index.chats[chatIndex]!;
  const nextChat: ProjectChatInfo = {
    ...existing,
    ...(updates.title != null ? { title: updates.title.trim() || existing.title } : {}),
    ...(updates.archivedAt !== undefined ? { archivedAt: updates.archivedAt } : {}),
    ...(updates.modelConfig
      ? { modelConfig: resolveProjectChatModelSelection(updates.modelConfig).modelConfig }
      : {}),
    updatedAt: updates.updatedAt ?? now(),
  };

  index.chats[chatIndex] = nextChat;
  index.updatedAt = now();

  writeProjectChatFiles({
    projectId,
    files,
    index,
    message: `Update AI chat ${chatId}`,
  });
  return nextChat;
}

export function archiveProjectChat(projectId: string, chatId: string, archived: boolean) {
  return updateProjectChat(projectId, chatId, {
    archivedAt: archived ? now() : null,
  });
}

export function deleteProjectChat(projectId: string, chatId: string) {
  const files = readProjectChatStorageFiles(projectId);
  const index = readProjectChatIndexFromFiles(projectId, files);
  const state = readProjectChatStateFromFiles(files);
  invariant(
    index.chats.some((chat) => chat.id === chatId),
    "未找到会话。",
  );

  index.chats = index.chats.filter((chat) => chat.id !== chatId);
  index.updatedAt = now();
  delete files[`${chatId}.jsonl`];
  delete state.chats[chatId];
  state.updatedAt = now();

  writeProjectChatFiles({
    projectId,
    files,
    index,
    state,
    message: `Delete AI chat ${chatId}`,
  });
}

export function getProjectChatDetail(projectId: string, chatId: string): ProjectChatDetail {
  const files = readProjectChatStorageFiles(projectId);
  const index = readProjectChatIndexFromFiles(projectId, files);
  const state = readProjectChatStateFromFiles(files);
  const chat = index.chats.find((entry) => entry.id === chatId);
  invariant(chat, "未找到会话。");

  const messages = getProjectChatMessages(projectId, chatId);
  const chatState = normalizeProjectChatPathState(state.chats[chatId]);
  const visibleMessages = resolveVisibleProjectChatPath(messages, chatState);

  return {
    chat,
    messages,
    visibleMessages,
    state: chatState,
    candidateGroups: buildProjectChatCandidateGroups(messages, chatState),
  };
}
