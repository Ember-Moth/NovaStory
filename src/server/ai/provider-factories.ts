import { createAnthropic } from "@ai-sdk/anthropic";
import { createAzure } from "@ai-sdk/azure";
import { createCerebras } from "@ai-sdk/cerebras";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModelV3, ProviderV3 } from "@ai-sdk/provider";
import { createXai } from "@ai-sdk/xai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { createGateway } from "ai";

import {
  type AiConnectionConfig,
  normalizeAiConnectionConfig,
  parseAiConnectionConfig,
} from "@/domain/ai-config";
import { type AiProviderFactoryId, getAiSdkPackageRecipe } from "@/domain/ai-packages";
import { invariant } from "@/domain/internal/ids";
import type { AiConnectionRow } from "@/domain/types";

interface ProviderFactoryInput {
  connection: AiConnectionRow;
  apiKey: string;
  baseUrl: string | null;
  config: AiConnectionConfig;
}

type ProviderFactory = (_input: ProviderFactoryInput) => ProviderV3;

function requireApiKey(connection: AiConnectionRow): string {
  const apiKey = connection.apiKey?.trim();
  invariant(apiKey, `Connection ${connection.id} is missing an API key`);
  return apiKey;
}

function requireBaseUrl(connection: AiConnectionRow): string {
  const baseUrl = connection.baseUrl?.trim();
  invariant(baseUrl, `Connection ${connection.id} is missing a Base URL`);
  return baseUrl;
}

function createAzureProvider({ apiKey, baseUrl, config }: ProviderFactoryInput): ProviderV3 {
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
  createGoogleGenerativeAI: ({ apiKey, baseUrl }) =>
    createGoogleGenerativeAI({
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
    }),
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

export function createProviderForConnection(connection: AiConnectionRow): ProviderV3 {
  const recipe = getAiSdkPackageRecipe(connection.sdkPackage);
  invariant(recipe, `Unsupported AI SDK package: ${connection.sdkPackage}`);

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
}): LanguageModelV3 {
  const normalizedModelId = modelId.trim();
  invariant(normalizedModelId, "Model ID cannot be empty");
  return createProviderForConnection(connection).languageModel(normalizedModelId);
}
