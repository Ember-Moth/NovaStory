import type { AiSupportedSdkPackage } from "./types";

export const SUPPORTED_AI_SDK_PACKAGES = [
  {
    sdkPackage: "@ai-sdk/openai",
    label: "OpenAI",
    providerFactoryId: "createOpenAI",
    requiresBaseUrl: false,
    allowsCustomEndpoint: false,
    supportsRegistryProvider: true,
  },
  {
    sdkPackage: "@ai-sdk/anthropic",
    label: "Anthropic",
    providerFactoryId: "createAnthropic",
    requiresBaseUrl: false,
    allowsCustomEndpoint: false,
    supportsRegistryProvider: true,
  },
  {
    sdkPackage: "@ai-sdk/google",
    label: "Google",
    providerFactoryId: "createGoogleGenerativeAI",
    requiresBaseUrl: false,
    allowsCustomEndpoint: false,
    supportsRegistryProvider: true,
  },
  {
    sdkPackage: "@ai-sdk/openai-compatible",
    label: "OpenAI-Compatible",
    providerFactoryId: "createOpenAICompatible",
    requiresBaseUrl: true,
    allowsCustomEndpoint: true,
    supportsRegistryProvider: true,
  },
  {
    sdkPackage: "@openrouter/ai-sdk-provider",
    label: "OpenRouter",
    providerFactoryId: "createOpenRouter",
    requiresBaseUrl: false,
    allowsCustomEndpoint: false,
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
