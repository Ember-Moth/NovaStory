import type { AiProviderConfigKind } from "./ai-config";

export const AI_PROVIDER_FACTORY_IDS = [
  "createOpenAI",
  "createAnthropic",
  "createGoogleGenerativeAI",
  "createOpenAICompatible",
  "createOpenRouter",
  "createXai",
  "createGateway",
  "createCerebras",
  "createAzure",
] as const;

export type AiProviderFactoryId = (typeof AI_PROVIDER_FACTORY_IDS)[number];

export interface AiSupportedSdkPackage {
  sdkPackage: string;
  label: string;
  providerFactoryId: AiProviderFactoryId;
  configKind: AiProviderConfigKind;
  requiresBaseUrl: boolean;
  allowsCustomEndpoint: boolean;
  supportsRegistryProvider: boolean;
}

export const SUPPORTED_AI_SDK_PACKAGES = [
  {
    sdkPackage: "@ai-sdk/openai",
    label: "OpenAI",
    providerFactoryId: "createOpenAI",
    configKind: "none",
    requiresBaseUrl: false,
    allowsCustomEndpoint: false,
    supportsRegistryProvider: true,
  },
  {
    sdkPackage: "@ai-sdk/anthropic",
    label: "Anthropic",
    providerFactoryId: "createAnthropic",
    configKind: "none",
    requiresBaseUrl: false,
    allowsCustomEndpoint: false,
    supportsRegistryProvider: true,
  },
  {
    sdkPackage: "@ai-sdk/google",
    label: "Google",
    providerFactoryId: "createGoogleGenerativeAI",
    configKind: "none",
    requiresBaseUrl: false,
    allowsCustomEndpoint: false,
    supportsRegistryProvider: true,
  },
  {
    sdkPackage: "@ai-sdk/openai-compatible",
    label: "OpenAI-Compatible",
    providerFactoryId: "createOpenAICompatible",
    configKind: "none",
    requiresBaseUrl: true,
    allowsCustomEndpoint: true,
    supportsRegistryProvider: true,
  },
  {
    sdkPackage: "@openrouter/ai-sdk-provider",
    label: "OpenRouter",
    providerFactoryId: "createOpenRouter",
    configKind: "none",
    requiresBaseUrl: false,
    allowsCustomEndpoint: false,
    supportsRegistryProvider: true,
  },
  {
    sdkPackage: "@ai-sdk/xai",
    label: "xAI",
    providerFactoryId: "createXai",
    configKind: "none",
    requiresBaseUrl: false,
    allowsCustomEndpoint: false,
    supportsRegistryProvider: true,
  },
  {
    sdkPackage: "@ai-sdk/gateway",
    label: "AI Gateway",
    providerFactoryId: "createGateway",
    configKind: "none",
    requiresBaseUrl: false,
    allowsCustomEndpoint: false,
    supportsRegistryProvider: true,
  },
  {
    sdkPackage: "@ai-sdk/cerebras",
    label: "Cerebras",
    providerFactoryId: "createCerebras",
    configKind: "none",
    requiresBaseUrl: false,
    allowsCustomEndpoint: false,
    supportsRegistryProvider: true,
  },
  {
    sdkPackage: "@ai-sdk/azure",
    label: "Azure",
    providerFactoryId: "createAzure",
    configKind: "azure",
    requiresBaseUrl: false,
    allowsCustomEndpoint: true,
    supportsRegistryProvider: true,
  },
] as const satisfies readonly AiSupportedSdkPackage[];

const SUPPORTED_AI_SDK_PACKAGE_MAP = new Map<string, AiSupportedSdkPackage>(
  SUPPORTED_AI_SDK_PACKAGES.map((pkg) => [pkg.sdkPackage, pkg]),
);

export function getAiSdkPackageRecipe(sdkPackage: string | null | undefined) {
  if (!sdkPackage) return null;
  return SUPPORTED_AI_SDK_PACKAGE_MAP.get(sdkPackage) ?? null;
}

export function isSupportedAiSdkPackage(sdkPackage: string | null | undefined): boolean {
  return getAiSdkPackageRecipe(sdkPackage) != null;
}
