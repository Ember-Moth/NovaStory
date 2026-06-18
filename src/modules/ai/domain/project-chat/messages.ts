import { now } from "@/shared/lib/domain";

import type {
  ProjectChatCandidateGroup,
  ProjectChatPathState,
  StoredProjectChatMessage,
} from "./types";

export const PROJECT_CHAT_ROOT_PARENT_ID = "__root__";

function normalizeParentMessageId(parentMessageId: string | null) {
  return parentMessageId ?? PROJECT_CHAT_ROOT_PARENT_ID;
}

export function listProjectChatChildren(
  messages: readonly StoredProjectChatMessage[],
  parentMessageId: string | null,
) {
  return messages.filter((message) => message.parentMessageId === parentMessageId);
}

export function resolveVisibleProjectChatPath(
  messages: readonly StoredProjectChatMessage[],
  state: ProjectChatPathState,
) {
  const visibleMessages: StoredProjectChatMessage[] = [];
  let parentMessageId: string | null = null;

  while (true) {
    const children = listProjectChatChildren(messages, parentMessageId);
    if (children.length === 0) {
      return visibleMessages;
    }

    const selectedChildId: string | undefined =
      state.selectedChildIdByParentId[normalizeParentMessageId(parentMessageId)];
    const selectedChild: StoredProjectChatMessage =
      children.find((child) => child.id === selectedChildId) ?? children[children.length - 1]!;
    visibleMessages.push(selectedChild);
    parentMessageId = selectedChild.id;
  }
}

export function buildProjectChatCandidateGroups(
  messages: readonly StoredProjectChatMessage[],
  state: ProjectChatPathState,
) {
  const candidateGroups: ProjectChatCandidateGroup[] = [];
  let parentMessageId: string | null = null;

  while (true) {
    const children = listProjectChatChildren(messages, parentMessageId);
    if (children.length === 0) {
      return candidateGroups;
    }

    const selectedChildId: string | undefined =
      state.selectedChildIdByParentId[normalizeParentMessageId(parentMessageId)];
    const selectedChild: StoredProjectChatMessage =
      children.find((child) => child.id === selectedChildId) ?? children[children.length - 1]!;

    if (children.length > 1) {
      candidateGroups.push({
        parentMessageId,
        activeMessageId: selectedChild.id,
        messageIds: children.map((child) => child.id),
      });
    }

    parentMessageId = selectedChild.id;
  }
}

export function selectProjectChatChild(
  state: ProjectChatPathState,
  parentMessageId: string | null,
  childMessageId: string,
): ProjectChatPathState {
  return {
    selectedChildIdByParentId: {
      ...state.selectedChildIdByParentId,
      [normalizeParentMessageId(parentMessageId)]: childMessageId,
    },
  };
}

export function materializeIncomingProjectChatMessages({
  currentMessages,
  incomingMessages,
}: {
  currentMessages: readonly StoredProjectChatMessage[];
  incomingMessages: readonly StoredProjectChatMessage[];
}) {
  const currentById = new Map(currentMessages.map((message) => [message.id, message]));
  const nextMessages = [...currentMessages];
  const visibleMessages: StoredProjectChatMessage[] = [];
  let parentMessageId: string | null = null;

  for (const incomingMessage of incomingMessages) {
    const existingIndex = nextMessages.findIndex((message) => message.id === incomingMessage.id);
    const existing = currentById.get(incomingMessage.id);
    const normalizedMessage: StoredProjectChatMessage = {
      ...incomingMessage,
      parentMessageId,
      createdAt: existing?.createdAt ?? now(),
      updatedAt: now(),
    };

    if (existingIndex >= 0) {
      nextMessages[existingIndex] = normalizedMessage;
    } else {
      nextMessages.push(normalizedMessage);
    }

    visibleMessages.push(normalizedMessage);
    parentMessageId = normalizedMessage.id;
  }

  return {
    messages: nextMessages,
    visibleMessages,
    tailParentMessageId: parentMessageId,
  };
}
