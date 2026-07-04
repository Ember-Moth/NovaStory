import { DefaultChatTransport } from "ai";

import type {
  ProjectAssistantContextSnapshot,
  ProjectAssistantToolName,
} from "@/modules/ai/domain/types";
import type { ProjectChatMessage } from "../types";
import { ipcChatFetch } from "./ipc-chat-fetch";

export class ProjectChatTransport extends DefaultChatTransport<ProjectChatMessage> {
  constructor({
    projectId,
    chatId,
    getContext,
    getActiveTools,
  }: {
    projectId: string;
    chatId: string;
    getContext: () => ProjectAssistantContextSnapshot | null | undefined;
    getActiveTools: () => ProjectAssistantToolName[] | null | undefined;
  }) {
    super({
      api: "/api/chat",
      fetch: ipcChatFetch,
      prepareSendMessagesRequest: ({ messages, trigger, messageId }) => ({
        body: {
          projectId,
          chatId,
          messages,
          trigger,
          messageId,
          context: getContext() ?? null,
          activeTools: getActiveTools() ?? null,
        },
      }),
      prepareReconnectToStreamRequest: () => ({
        api: "/api/chat",
        fetch: ipcChatFetch,
      }),
    });
  }
}
