import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  stepCountIs,
  streamText,
  type ToolSet,
  type UIMessage,
  type UIMessageStreamWriter,
} from "ai";

import {
  archiveProjectChat,
  createProjectChat,
  deleteProjectChat,
  getProjectChat,
  getProjectChatDefaultModelConfig,
  getProjectChatDetail,
  getProjectChatMessages,
  listProjectChats,
  materializeIncomingProjectChatMessages,
  resolveProjectChatModelSelection,
  selectProjectChatMessageChild,
  updateProjectChat,
  updateProjectChatDefaultModelConfig,
  writeProjectChatMessages,
  deriveProjectChatTitleFromText,
  type ProjectChatModelConfig,
  type StoredProjectChatMessage,
} from "@/modules/ai/domain/project-chat";
import { streamRegistry } from "./stream-registry";
import type {
  AssistantMentionInput,
  ProjectAssistantContextSnapshot,
  ProjectAssistantToolName,
  TimelineSelectionUpdatedEvent,
  WorkspaceRefreshArea,
  WorkspaceRefreshRequestedEvent,
} from "@/modules/ai/domain/types";
import { getAiAssistantMaxSteps } from "@/modules/config/domain/ai-assistant-options";
import { getDefaultWorkspace } from "@/modules/workspace/domain";
import { createId, invariant, now } from "@/shared/lib/domain";

import { createAssistantTools } from "../assistant-tools";
import {
  buildProjectAssistantContextMessage,
  buildProjectAssistantRefsMessage,
  buildProjectAssistantSystemPrompt,
  createToolRuntimeContext,
  normalizeAssistantContextSnapshot,
  normalizeError,
  resolveProjectAssistantActiveTools,
} from "../project-assistant/runtime";
import { resolveAssistantInputRefs } from "../project-assistant/refs";
import { createLanguageModelForConnection } from "../provider-factories";

type ProjectChatRequestMessageMetadata = {
  mentions?: AssistantMentionInput[];
};

type ProjectChatRequestBody = {
  projectId?: string;
  chatId?: string;
  messages?: UIMessage<ProjectChatRequestMessageMetadata>[];
  trigger?: "submit-message" | "regenerate-message";
  messageId?: string;
  context?: ProjectAssistantContextSnapshot | null;
  activeTools?: ProjectAssistantToolName[] | null;
};

type ProjectChatStreamData =
  | {
      type: "workspace-refresh-requested";
      event: WorkspaceRefreshRequestedEvent;
    }
  | {
      type: "timeline-selection-updated";
      event: TimelineSelectionUpdatedEvent;
    };

const CONTENT_WRITE_TOOL_NAME_SET = new Set<string>([
  "create_manuscript_node",
  "move_manuscript_node",
  "update_manuscript_node",
  "delete_manuscript_node",
]);
const CONTENT_AUTO_OPEN_TOOL_NAME_SET = new Set<string>([
  "create_manuscript_node",
  "update_manuscript_node",
]);
const AUX_WRITE_TOOL_NAME_SET = new Set<string>([
  "create_dir",
  "write_file",
  "move_path",
  "delete_path",
  "create_symlink",
  "retarget_symlink",
]);
const TIMELINE_UPDATE_TOOL_NAME = "update_story_timeline_point";
const TIMELINE_WRITE_TOOL_NAME_SET = new Set<string>([
  "create_story_timeline_points",
  TIMELINE_UPDATE_TOOL_NAME,
  "move_story_timeline_point",
  "delete_story_timeline_point",
]);

function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

function normalizeProjectId(projectId: unknown) {
  const normalized = typeof projectId === "string" ? projectId.trim() : "";
  invariant(normalized.length > 0, "projectId required");
  return normalized;
}

function normalizeChatId(chatId: unknown) {
  const normalized = typeof chatId === "string" ? chatId.trim() : "";
  invariant(normalized.length > 0, "chatId required");
  return normalized;
}

function unwrapToolOutput(output: unknown) {
  if (!output || typeof output !== "object") {
    return null;
  }

  const value = Reflect.get(output as Record<string, unknown>, "value");
  return value && typeof value === "object" ? (value as Record<string, unknown>) : output;
}

async function extractWorkspaceRefreshRequestedEventFromToolResult({
  projectId,
  toolName,
  output,
}: {
  projectId: string;
  toolName: string;
  output: unknown;
}): Promise<WorkspaceRefreshRequestedEvent | null> {
  if (
    !CONTENT_WRITE_TOOL_NAME_SET.has(toolName) &&
    !AUX_WRITE_TOOL_NAME_SET.has(toolName) &&
    !TIMELINE_WRITE_TOOL_NAME_SET.has(toolName)
  ) {
    return null;
  }

  const workspace = await getDefaultWorkspace(projectId);
  if (!workspace) {
    return null;
  }

  const unwrapped = unwrapToolOutput(output);
  if (!unwrapped || Reflect.get(unwrapped, "ok") !== true) {
    return null;
  }

  const data = Reflect.get(unwrapped, "data");
  if (!data || typeof data !== "object") {
    return null;
  }

  const record = data as Record<string, unknown>;
  const nodeId = Reflect.get(record, "nodeId");
  const auxPathValue = Reflect.get(record, "path");
  const timelinePointId = Reflect.get(record, "timelinePointId");
  let areas: readonly WorkspaceRefreshArea[];
  let contentNodeId: string | null | undefined;
  let auxPath: string | null | undefined;
  let refreshTimelinePointId: string | null | undefined;

  if (CONTENT_WRITE_TOOL_NAME_SET.has(toolName)) {
    areas = ["content"];
    contentNodeId =
      CONTENT_AUTO_OPEN_TOOL_NAME_SET.has(toolName) &&
      typeof nodeId === "string" &&
      nodeId.trim().length > 0
        ? nodeId
        : null;
    refreshTimelinePointId =
      CONTENT_AUTO_OPEN_TOOL_NAME_SET.has(toolName) &&
      typeof timelinePointId === "string" &&
      timelinePointId.trim().length > 0
        ? timelinePointId
        : null;
  } else if (AUX_WRITE_TOOL_NAME_SET.has(toolName)) {
    areas = ["aux"];
    auxPath =
      typeof auxPathValue === "string" && auxPathValue.trim().length > 0 ? auxPathValue : null;
    refreshTimelinePointId =
      typeof timelinePointId === "string" && timelinePointId.trim().length > 0
        ? timelinePointId
        : null;
  } else {
    areas = toolName === TIMELINE_UPDATE_TOOL_NAME ? ["timeline"] : ["timeline", "aux"];
  }

  return {
    type: "workspace-refresh-requested",
    workspaceId: workspace.id,
    areas,
    ...(contentNodeId === undefined ? {} : { contentNodeId }),
    ...(auxPath === undefined ? {} : { auxPath }),
    ...(refreshTimelinePointId === undefined ? {} : { timelinePointId: refreshTimelinePointId }),
  };
}

async function extractTimelineSelectionUpdatedEventFromToolResult({
  projectId,
  toolName,
  output,
}: {
  projectId: string;
  toolName: string;
  output: unknown;
}): Promise<TimelineSelectionUpdatedEvent | null> {
  if (toolName !== "set_current_timeline") {
    return null;
  }

  const workspace = await getDefaultWorkspace(projectId);
  if (!workspace) {
    return null;
  }

  const unwrapped = unwrapToolOutput(output);
  if (!unwrapped || Reflect.get(unwrapped, "ok") !== true) {
    return null;
  }

  const data = Reflect.get(unwrapped, "data");
  if (!data || typeof data !== "object") {
    return null;
  }

  const record = data as Record<string, unknown>;
  const timelinePointId = Reflect.get(record, "timelinePointId");
  if (typeof timelinePointId !== "string" || timelinePointId.trim().length === 0) {
    return null;
  }

  const timelineLabel = Reflect.get(record, "timelineLabel");
  return {
    type: "timeline-selection-updated",
    workspaceId: workspace.id,
    timelinePointId,
    timelineLabel:
      typeof timelineLabel === "string" && timelineLabel.trim().length > 0 ? timelineLabel : null,
  };
}

function readMentionMetadata(
  message: UIMessage<ProjectChatRequestMessageMetadata> | StoredProjectChatMessage,
) {
  const metadata =
    message.metadata && typeof message.metadata === "object"
      ? (message.metadata as ProjectChatRequestMessageMetadata)
      : null;
  const mentions = metadata?.mentions;
  return Array.isArray(mentions) ? mentions : [];
}

async function buildModelMessagesForChat({
  messages,
  tools,
  context,
}: {
  messages: StoredProjectChatMessage[];
  tools: ToolSet;
  context: ProjectAssistantContextSnapshot | null;
}) {
  const modelMessages = [];

  for (const message of messages) {
    const converted = await convertToModelMessages([message], {
      tools,
      ignoreIncompleteToolCalls: true,
    });
    modelMessages.push(...converted);

    if (message.role === "user") {
      const refs = resolveAssistantInputRefs(readMentionMetadata(message));
      const refsMessage = buildProjectAssistantRefsMessage(refs);
      if (refsMessage) {
        modelMessages.push(refsMessage);
      }
    }
  }

  const contextMessage = buildProjectAssistantContextMessage(context);
  if (contextMessage) {
    modelMessages.push(contextMessage);
  }

  return modelMessages;
}

function maybeDeriveChatTitle(
  chatTitle: string,
  visibleMessages: readonly StoredProjectChatMessage[],
): string | null {
  if (!/^新会话 \d+$/.test(chatTitle)) {
    return null;
  }

  const firstUserMessage = visibleMessages.find((message) => message.role === "user");
  if (!firstUserMessage) {
    return null;
  }

  const text = firstUserMessage.parts
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join(" ");

  return deriveProjectChatTitleFromText(text);
}

function normalizeIncomingMessages(input: unknown): UIMessage<ProjectChatRequestMessageMetadata>[] {
  invariant(Array.isArray(input), "messages required");
  return input as UIMessage<ProjectChatRequestMessageMetadata>[];
}

function emitProjectChatStreamData(
  writer: UIMessageStreamWriter<any> | null,
  buffered: ProjectChatStreamData[],
  data: ProjectChatStreamData,
) {
  if (writer) {
    writer.write({
      type:
        data.type === "workspace-refresh-requested"
          ? "data-workspace-refresh-requested"
          : "data-timeline-selection-updated",
      data: data.event,
    });
    return;
  }

  buffered.push(data);
}

export async function handleProjectChatRequest(request: Request) {
  try {
    const body = (await request.json()) as ProjectChatRequestBody;
    const projectId = normalizeProjectId(body.projectId);
    const chatId = normalizeChatId(body.chatId);
    const incomingMessages = normalizeIncomingMessages(body.messages);
    const chat = await getProjectChat(projectId, chatId);
    if (!chat) {
      return jsonError("Chat not found", 404);
    }

    const currentMessages = await getProjectChatMessages(projectId, chatId);
    const currentMessageIds = new Set(currentMessages.map((message) => message.id));
    const syncedIncoming = materializeIncomingProjectChatMessages({
      currentMessages,
      incomingMessages: incomingMessages as StoredProjectChatMessage[],
    });
    await writeProjectChatMessages(
      projectId,
      chatId,
      syncedIncoming.messages,
      `Sync AI chat messages ${chatId}`,
    );

    for (const message of syncedIncoming.visibleMessages) {
      if (!currentMessageIds.has(message.id)) {
        await selectProjectChatMessageChild(projectId, chatId, message.parentMessageId, message.id);
      }
    }

    const normalizedContext = normalizeAssistantContextSnapshot(body.context ?? null);
    const runtimeContext = createToolRuntimeContext(normalizedContext);
    const selection = resolveProjectChatModelSelection(chat.modelConfig);
    const activeTools = resolveProjectAssistantActiveTools({
      selection: {
        resolvedModel: selection.resolvedModel,
      },
      activeTools: body.activeTools,
    });
    const tools = await createAssistantTools({
      projectId,
      runtimeContext,
    });
    const modelMessages = await buildModelMessagesForChat({
      messages: syncedIncoming.visibleMessages,
      tools,
      context: normalizedContext,
    });

    const bufferedDataParts: ProjectChatStreamData[] = [];
    let streamWriter: UIMessageStreamWriter<any> | null = null;

    // Create AbortController for this stream
    const abortController = new AbortController();
    const streamId = streamRegistry.register(chatId, abortController);

    const result = streamText({
      model: createLanguageModelForConnection({
        connection: selection.connection,
        modelId: selection.resolvedModel.modelId,
      }),
      system: buildProjectAssistantSystemPrompt(),
      messages: modelMessages,
      tools,
      ...(activeTools.length > 0 ? { activeTools } : {}),
      ...(chat.modelConfig.temperature != null
        ? { temperature: chat.modelConfig.temperature }
        : {}),
      ...(chat.modelConfig.maxTokens != null
        ? { maxOutputTokens: chat.modelConfig.maxTokens }
        : {}),
      stopWhen: stepCountIs(getAiAssistantMaxSteps()),
      abortSignal: abortController.signal,
      experimental_onToolCallFinish: async (event) => {
        if (!event.success) {
          return;
        }

        const toolName = event.toolCall.toolName;
        const workspaceRefreshRequestedEvent =
          await extractWorkspaceRefreshRequestedEventFromToolResult({
            projectId,
            toolName,
            output: event.output,
          });
        if (workspaceRefreshRequestedEvent) {
          emitProjectChatStreamData(streamWriter, bufferedDataParts, {
            type: "workspace-refresh-requested",
            event: workspaceRefreshRequestedEvent,
          });
        }

        const timelineSelectionUpdatedEvent =
          await extractTimelineSelectionUpdatedEventFromToolResult({
            projectId,
            toolName,
            output: event.output,
          });
        if (timelineSelectionUpdatedEvent) {
          emitProjectChatStreamData(streamWriter, bufferedDataParts, {
            type: "timeline-selection-updated",
            event: timelineSelectionUpdatedEvent,
          });
        }
      },
    });

    const responseStream = createUIMessageStream({
      execute: ({ writer }) => {
        streamWriter = writer;
        bufferedDataParts.splice(0).forEach((dataPart) => {
          emitProjectChatStreamData(writer, [], dataPart);
        });
        writer.merge(
          result.toUIMessageStream({
            originalMessages: incomingMessages,
            generateMessageId: () => createId("chat_msg"),
            onFinish: async ({ responseMessage, isContinuation }) => {
              // Unregister stream when finished
              streamRegistry.unregister(streamId);

              const latestMessages = await getProjectChatMessages(projectId, chatId);
              const responseIndex = latestMessages.findIndex(
                (message) => message.id === responseMessage.id,
              );
              const existingResponse = responseIndex >= 0 ? latestMessages[responseIndex] : null;
              const parentMessageId = isContinuation
                ? (existingResponse?.parentMessageId ?? syncedIncoming.tailParentMessageId)
                : syncedIncoming.tailParentMessageId;
              const storedResponse: StoredProjectChatMessage = {
                ...responseMessage,
                parentMessageId,
                createdAt: existingResponse?.createdAt ?? now(),
                updatedAt: now(),
              };
              if (responseIndex >= 0) {
                latestMessages[responseIndex] = storedResponse;
              } else {
                latestMessages.push(storedResponse);
              }
              await writeProjectChatMessages(
                projectId,
                chatId,
                latestMessages,
                `Persist AI chat response ${chatId}`,
              );

              if (!isContinuation) {
                await selectProjectChatMessageChild(
                  projectId,
                  chatId,
                  parentMessageId,
                  storedResponse.id,
                );
              }

              const nextVisibleMessages = [
                ...syncedIncoming.visibleMessages,
                ...(isContinuation ? [] : [storedResponse]),
              ];
              const derivedTitle = maybeDeriveChatTitle(chat.title, nextVisibleMessages);
              await updateProjectChat(projectId, chatId, {
                ...(derivedTitle ? { title: derivedTitle } : {}),
                updatedAt: now(),
              });
            },
          }),
        );
      },
      onError: (error) => {
        // Unregister stream on error
        streamRegistry.unregister(streamId);
        return normalizeError(error).message;
      },
    });

    return createUIMessageStreamResponse({
      stream: responseStream,
      headers: new Headers({
        "X-Stream-Id": streamId,
      }),
    });
  } catch (error) {
    return jsonError(normalizeError(error).message);
  }
}

export async function handleProjectChatsRequest(request: Request) {
  try {
    if (request.method === "GET") {
      const url = new URL(request.url);
      const projectId = normalizeProjectId(url.searchParams.get("projectId"));
      const archived = url.searchParams.get("archived");
      return Response.json({
        chats: await listProjectChats(projectId, {
          archived: archived == null ? undefined : archived === "all" ? "all" : archived === "true",
        }),
      });
    }

    const body = (await request.json()) as {
      projectId?: string;
      title?: string;
      modelConfig?: ProjectChatModelConfig;
    };
    const projectId = normalizeProjectId(body.projectId);
    return Response.json({
      chat: await createProjectChat(projectId, {
        title: body.title,
        modelConfig: body.modelConfig,
      }),
    });
  } catch (error) {
    return jsonError(normalizeError(error).message);
  }
}

export async function handleProjectChatDetailRequest(request: Request, chatId: string) {
  try {
    const normalizedChatId = normalizeChatId(chatId);
    if (request.method === "GET") {
      const url = new URL(request.url);
      const projectId = normalizeProjectId(url.searchParams.get("projectId"));
      const chat = await getProjectChat(projectId, normalizedChatId);
      if (!chat) {
        return jsonError("Chat not found", 404);
      }
      return Response.json(await getProjectChatDetail(projectId, normalizedChatId));
    }

    if (request.method === "PUT") {
      const body = (await request.json()) as {
        projectId?: string;
        title?: string;
        modelConfig?: ProjectChatModelConfig;
      };
      const projectId = normalizeProjectId(body.projectId);
      return Response.json({
        chat: await updateProjectChat(projectId, normalizedChatId, {
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.modelConfig ? { modelConfig: body.modelConfig } : {}),
        }),
      });
    }

    const url = new URL(request.url);
    const projectId = normalizeProjectId(url.searchParams.get("projectId"));
    await deleteProjectChat(projectId, normalizedChatId);
    return Response.json({ success: true });
  } catch (error) {
    return jsonError(normalizeError(error).message);
  }
}

export async function handleProjectChatStateRequest(request: Request, chatId: string) {
  try {
    const url = new URL(request.url);
    const projectId = normalizeProjectId(url.searchParams.get("projectId"));
    const normalizedChatId = normalizeChatId(chatId);
    const chat = await getProjectChat(projectId, normalizedChatId);
    if (!chat) {
      return jsonError("Chat not found", 404);
    }

    const detail = await getProjectChatDetail(projectId, normalizedChatId);
    return Response.json({
      state: detail.state,
      visibleMessages: detail.visibleMessages,
      candidateGroups: detail.candidateGroups,
    });
  } catch (error) {
    return jsonError(normalizeError(error).message);
  }
}

export async function handleProjectChatSelectionRequest(request: Request, chatId: string) {
  try {
    const url = new URL(request.url);
    const projectId = normalizeProjectId(url.searchParams.get("projectId"));
    const normalizedChatId = normalizeChatId(chatId);
    const chat = await getProjectChat(projectId, normalizedChatId);
    if (!chat) {
      return jsonError("Chat not found", 404);
    }

    const body = (await request.json()) as {
      parentMessageId?: string | null;
      childMessageId?: string;
    };
    const childMessageId = normalizeChatId(body.childMessageId);
    const state = await selectProjectChatMessageChild(
      projectId,
      normalizedChatId,
      body.parentMessageId ?? null,
      childMessageId,
    );
    const detail = await getProjectChatDetail(projectId, normalizedChatId);
    return Response.json({
      state,
      visibleMessages: detail.visibleMessages,
      candidateGroups: detail.candidateGroups,
    });
  } catch (error) {
    return jsonError(normalizeError(error).message);
  }
}

export async function handleProjectModelConfigRequest(request: Request, projectId: string) {
  try {
    const normalizedProjectId = normalizeProjectId(projectId);
    if (request.method === "GET") {
      return Response.json(await getProjectChatDefaultModelConfig(normalizedProjectId));
    }

    const body = (await request.json()) as Partial<ProjectChatModelConfig>;
    return Response.json(await updateProjectChatDefaultModelConfig(normalizedProjectId, body));
  } catch (error) {
    return jsonError(normalizeError(error).message);
  }
}

export async function handleProjectChatArchiveRequest(request: Request, chatId: string) {
  try {
    const body = (await request.json()) as {
      projectId?: string;
      archived?: boolean;
    };
    const projectId = normalizeProjectId(body.projectId);
    const normalizedChatId = normalizeChatId(chatId);
    return Response.json({
      chat: await archiveProjectChat(projectId, normalizedChatId, body.archived === true),
    });
  } catch (error) {
    return jsonError(normalizeError(error).message);
  }
}

export async function handleProjectChatAbortRequest(request: Request, chatId: string) {
  try {
    const url = new URL(request.url);
    const _projectId = normalizeProjectId(url.searchParams.get("projectId"));
    const normalizedChatId = normalizeChatId(chatId);

    // Abort the stream for this chat
    const aborted = streamRegistry.abortByChatId(normalizedChatId);

    return Response.json({
      success: aborted,
      message: aborted ? "Stream aborted" : "No active stream found",
    });
  } catch (error) {
    return jsonError(normalizeError(error).message);
  }
}
