export interface AzureAiConnectionConfig {
  resourceName?: string | null;
  apiVersion?: string | null;
  useDeploymentBasedUrls?: boolean;
}

export interface AiConnectionConfig {
  azure?: AzureAiConnectionConfig;
}

export type AiProviderConfigKind = "none" | "azure";

const AZURE_AI_SDK_PACKAGE = "@ai-sdk/azure";

function normalizeOptionalString(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function parseAiConnectionConfig(configJson: string | null | undefined): AiConnectionConfig {
  if (!configJson) return {};

  try {
    const parsed = JSON.parse(configJson) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    const azure =
      "azure" in parsed &&
      parsed.azure &&
      typeof parsed.azure === "object" &&
      !Array.isArray(parsed.azure)
        ? (parsed.azure as AzureAiConnectionConfig)
        : undefined;

    return {
      azure: azure
        ? {
            resourceName: normalizeOptionalString(azure.resourceName),
            apiVersion: normalizeOptionalString(azure.apiVersion),
            useDeploymentBasedUrls: Boolean(azure.useDeploymentBasedUrls),
          }
        : undefined,
    };
  } catch {
    return {};
  }
}

export function normalizeAiConnectionConfig({
  sdkPackage,
  config,
}: {
  sdkPackage: string;
  config: AiConnectionConfig | null | undefined;
}): AiConnectionConfig {
  if (sdkPackage !== AZURE_AI_SDK_PACKAGE) {
    return {};
  }

  const resourceName = normalizeOptionalString(config?.azure?.resourceName);
  const apiVersion = normalizeOptionalString(config?.azure?.apiVersion);
  const useDeploymentBasedUrls = Boolean(config?.azure?.useDeploymentBasedUrls);

  if (!resourceName && !apiVersion && !useDeploymentBasedUrls) {
    return {};
  }

  return {
    azure: {
      resourceName,
      apiVersion,
      useDeploymentBasedUrls,
    },
  };
}

export function stringifyAiConnectionConfig({
  sdkPackage,
  config,
}: {
  sdkPackage: string;
  config: AiConnectionConfig | null | undefined;
}): string {
  return JSON.stringify(normalizeAiConnectionConfig({ sdkPackage, config }));
}
