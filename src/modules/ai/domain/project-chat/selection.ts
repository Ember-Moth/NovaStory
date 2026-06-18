import { listResolvedModelsForConnection } from "@/modules/ai/domain/catalog";
import type { AiConnectionRow, AiResolvedModelView } from "@/modules/ai/domain/types";
import * as userConfig from "@/modules/ai/domain/user-config";
import { getAiAssistantModelSelection } from "@/modules/config/domain/ai-assistant-model-selection";
import { invariant } from "@/shared/lib/domain";

import type { ProjectChatModelConfig } from "./types";

export interface ResolvedProjectChatModelSelection {
  connection: AiConnectionRow;
  resolvedModel: AiResolvedModelView;
  modelConfig: ProjectChatModelConfig;
}

function findEnabledFallbackModel() {
  return (
    userConfig.aiConnections
      .list()
      .filter((connection) => connection.isEnabled)
      .sort((left, right) => left.name.localeCompare(right.name))
      .flatMap((connection) =>
        listResolvedModelsForConnection({ connectionId: connection.id }).map((model) => ({
          connection,
          model,
        })),
      )[0] ?? null
  );
}

export function resolveProjectChatModelSelection(
  modelConfig: ProjectChatModelConfig,
): ResolvedProjectChatModelSelection {
  const connection = userConfig.aiConnections.get(modelConfig.connectionId);
  invariant(connection, "未找到会话使用的 AI 连接。");
  invariant(connection.isEnabled, "会话使用的 AI 连接已被停用。");

  const resolvedModel = listResolvedModelsForConnection({
    connectionId: connection.id,
  }).find((candidate) => candidate.id === modelConfig.modelId);
  invariant(resolvedModel, "未找到会话使用的 AI 模型。");
  invariant(resolvedModel.isEnabled, "会话使用的 AI 模型已被停用。");

  return {
    connection,
    resolvedModel,
    modelConfig: {
      ...modelConfig,
      connectionId: connection.id,
      modelId: resolvedModel.id,
    },
  };
}

export function resolveDefaultProjectChatModelConfig(): ProjectChatModelConfig {
  const storedSelection = getAiAssistantModelSelection();
  if (storedSelection) {
    try {
      return resolveProjectChatModelSelection(storedSelection).modelConfig;
    } catch {
      // Ignore invalid stored selection and fall back to the first enabled model.
    }
  }

  const fallback = findEnabledFallbackModel();
  invariant(fallback, "请先在 AI 设置里启用至少一个连接和模型。");

  return {
    connectionId: fallback.connection.id,
    modelId: fallback.model.id,
  };
}
