// @ts-nocheck
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  isStepCount,
  streamText,
  type ToolSet,
  toUIMessageStream,
  type UIMessage,
  type UIMessageStreamWriter,
} from "ai";

import {
  deriveProjectChatTitleFromText,
  getProjectChat,
  getProjectChatMessages,
  materializeIncomingProjectChatMessages,
  resolveProjectChatModelSelection,
  type StoredProjectChatMessage,
  selectProjectChatMessageChild,
  updateProjectChat,
  writeProjectChatMessages,
} from "@/modules/ai/domain/project-chat";
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
import { resolveAssistantInputRefs } from "../project-assistant/refs";
import {
  buildProjectAssistantContextMessage,
  buildProjectAssistantRefsMessage,
  buildProjectAssistantSystemPrompt,
  createToolRuntimeContext,
  normalizeAssistantContextSnapshot,
  normalizeError,
  resolveProjectAssistantActiveTools,
} from "../project-assistant/runtime";
import { createLanguageModelForConnection } from "../provider-factories";
import { streamRegistry } from "./stream-registry";

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
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
  if (!isRecord(output)) {
    return null;
  }

  const value = output.value;
  return isRecord(value) ? value : output;
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
  if (unwrapped?.ok !== true) {
    return null;
  }

  const data = unwrapped.data;
  if (!isRecord(data)) {
    return null;
  }

  const nodeId = data.nodeId;
  const auxPathValue = data.path;
  const timelinePointId = data.timelinePointId;
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
  if (unwrapped?.ok !== true) {
    return null;
  }

  const data = unwrapped.data;
  if (!isRecord(data)) {
    return null;
  }

  const timelinePointId = data.timelinePointId;
  if (typeof timelinePointId !== "string" || timelinePointId.trim().length === 0) {
    return null;
  }

  const timelineLabel = data.timelineLabel;
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
      instructions: buildProjectAssistantSystemPrompt(),
      messages: modelMessages,
      tools,
      ...(activeTools.length > 0 ? { activeTools } : {}),
      ...(chat.modelConfig.temperature != null
        ? { temperature: chat.modelConfig.temperature }
        : {}),
      ...(chat.modelConfig.maxTokens != null
        ? { maxOutputTokens: chat.modelConfig.maxTokens }
        : {}),
      stopWhen: isStepCount(getAiAssistantMaxSteps()),
      abortSignal: abortController.signal,
      onToolExecutionEnd: async (event) => {
        if (event.toolOutput.type !== "tool-result") {
          return;
        }

        const toolName = event.toolCall.toolName;
        const workspaceRefreshRequestedEvent =
          await extractWorkspaceRefreshRequestedEventFromToolResult({
            projectId,
            toolName,
            output: event.toolOutput.output,
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
            output: event.toolOutput.output,
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
          toUIMessageStream({
            stream: result.stream,
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
