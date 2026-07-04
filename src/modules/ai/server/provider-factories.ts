// @ts-nocheck
import { createAnthropic } from "@ai-sdk/anthropic";
import { createAzure } from "@ai-sdk/azure";
import { createCerebras } from "@ai-sdk/cerebras";
import { createGoogle } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModelV4, ProviderV4 } from "@ai-sdk/provider";
import { createXai } from "@ai-sdk/xai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { createGateway } from "ai";

import {
  type AiConnectionConfig,
  normalizeAiConnectionConfig,
  parseAiConnectionConfig,
} from "@/modules/ai/domain/config";
import { type AiProviderFactoryId, getAiSdkPackageRecipe } from "@/modules/ai/domain/packages";
import type { AiConnectionRow } from "@/modules/ai/domain/types";
import { invariant } from "@/shared/lib/domain";

interface ProviderFactoryInput {
  connection: AiConnectionRow;
  apiKey: string;
  baseUrl: string | null;
  config: AiConnectionConfig;
}

type ProviderFactory = (_input: ProviderFactoryInput) => ProviderV4;

function requireApiKey(connection: AiConnectionRow): string {
  const apiKey = connection.apiKey?.trim();
  invariant(apiKey, `AI 连接 ${connection.id} 缺少 API Key。`);
  return apiKey;
}

function requireBaseUrl(connection: AiConnectionRow): string {
  const baseUrl = connection.baseUrl?.trim();
  invariant(baseUrl, `AI 连接 ${connection.id} 缺少 Base URL。`);
  return baseUrl;
}

function createAzureProvider({ apiKey, baseUrl, config }: ProviderFactoryInput): ProviderV4 {
  return createAzure({
    apiKey,
    baseURL: baseUrl ?? undefined,
    resourceName: config.azure?.resourceName ?? undefined,
    apiVersion: config.azure?.apiVersion ?? undefined,
    useDeploymentBasedUrls: config.azure?.useDeploymentBasedUrls,
  });
}

export const PROVIDER_FACTORY_REGISTRY: Record<AiProviderFactoryId, ProviderFactory> = {
  createOpenAI: ({ apiKey, baseUrl }) =>
    createOpenAI({
      apiKey,
      baseURL: baseUrl ?? undefined,
    }),
  createAnthropic: ({ apiKey, baseUrl }) =>
    createAnthropic({
      apiKey,
      baseURL: baseUrl ?? undefined,
    }),
  createGoogle: ({ apiKey, baseUrl }) =>
    createGoogle({
      apiKey,
      baseURL: baseUrl ?? undefined,
    }),
  createOpenAICompatible: ({ connection, apiKey }) =>
    createOpenAICompatible({
      apiKey,
      baseURL: requireBaseUrl(connection),
      name: connection.catalogProviderId ?? connection.id,
    }),
  createOpenRouter: ({ apiKey, baseUrl }) =>
    createOpenRouter({
      apiKey,
      baseURL: baseUrl ?? undefined,
    }) as unknown as ProviderV4,
  createXai: ({ apiKey, baseUrl }) =>
    createXai({
      apiKey,
      baseURL: baseUrl ?? undefined,
    }),
  createGateway: ({ apiKey, baseUrl }) =>
    createGateway({
      apiKey,
      baseURL: baseUrl ?? undefined,
    }),
  createCerebras: ({ apiKey, baseUrl }) =>
    createCerebras({
      apiKey,
      baseURL: baseUrl ?? undefined,
    }),
  createAzure: createAzureProvider,
};

export function createProviderForConnection(connection: AiConnectionRow): ProviderV4 {
  const recipe = getAiSdkPackageRecipe(connection.sdkPackage);
  invariant(recipe, `不支持这个 AI SDK 包：${connection.sdkPackage}`);

  const normalizedConnection = {
    ...connection,
    baseUrl: connection.baseUrl?.trim() || null,
    apiKey: requireApiKey(connection),
    configJson: connection.configJson,
  };
  const config = normalizeAiConnectionConfig({
    sdkPackage: connection.sdkPackage,
    config: parseAiConnectionConfig(connection.configJson),
  });

  return PROVIDER_FACTORY_REGISTRY[recipe.providerFactoryId]({
    connection: normalizedConnection,
    apiKey: normalizedConnection.apiKey,
    baseUrl: normalizedConnection.baseUrl,
    config,
  });
}

export function createLanguageModelForConnection({
  connection,
  modelId,
}: {
  connection: AiConnectionRow;
  modelId: string;
}): LanguageModelV4 {
  const normalizedModelId = modelId.trim();
  invariant(normalizedModelId, "模型 ID 不能为空。");
  return createProviderForConnection(connection).languageModel(normalizedModelId);
}
