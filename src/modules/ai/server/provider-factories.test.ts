import { expect, test } from "vitest";

import { stringifyAiConnectionConfig } from "@/modules/ai/domain/config";
import { SUPPORTED_AI_SDK_PACKAGES } from "@/modules/ai/domain/packages";
import type { AiConnectionRow } from "@/modules/ai/domain/types";

import {
  createLanguageModelForConnection,
  createProviderForConnection,
  PROVIDER_FACTORY_REGISTRY,
} from "./provider-factories";

function createConnectionRow(
  overrides: Partial<AiConnectionRow> & Pick<AiConnectionRow, "sdkPackage">,
): AiConnectionRow {
  return {
    id: "conn_test",
    kind: "custom",
    name: "Test Connection",
    sdkPackage: overrides.sdkPackage,
    catalogProviderId: overrides.catalogProviderId ?? null,
    baseUrl: overrides.baseUrl ?? null,
    apiKey: overrides.apiKey ?? "sk-test",
    configJson: overrides.configJson ?? "{}",
    isEnabled: overrides.isEnabled ?? true,
    createdAt: overrides.createdAt ?? 1,
    updatedAt: overrides.updatedAt ?? 1,
  };
}

test("every supported sdk package recipe has a provider factory implementation", () => {
  for (const recipe of SUPPORTED_AI_SDK_PACKAGES) {
    expect(typeof PROVIDER_FACTORY_REGISTRY[recipe.providerFactoryId]).toBe("function");
  }
});

test("createLanguageModelForConnection instantiates a model for every supported package", () => {
  for (const recipe of SUPPORTED_AI_SDK_PACKAGES) {
    const connection = createConnectionRow({
      sdkPackage: recipe.sdkPackage,
      baseUrl:
        recipe.sdkPackage === "@ai-sdk/openai-compatible"
          ? "https://example.com/v1"
          : recipe.sdkPackage === "@ai-sdk/azure"
            ? "https://azure-proxy.example.com"
            : null,
      configJson:
        recipe.sdkPackage === "@ai-sdk/azure"
          ? stringifyAiConnectionConfig({
              sdkPackage: recipe.sdkPackage,
              config: {
                azure: {
                  resourceName: "azure-demo",
                  apiVersion: "preview",
                },
              },
            })
          : "{}",
    });

    const model = createLanguageModelForConnection({
      connection,
      modelId: recipe.sdkPackage === "@ai-sdk/gateway" ? "openai/gpt-4.1-mini" : "test-model",
    });

    expect(model).toBeTruthy();
    expect(model.modelId).toBe(
      recipe.sdkPackage === "@ai-sdk/gateway" ? "openai/gpt-4.1-mini" : "test-model",
    );
  }
});

test("openai-compatible uses catalog provider id as provider name", () => {
  const connection = createConnectionRow({
    sdkPackage: "@ai-sdk/openai-compatible",
    catalogProviderId: "openrouter",
    baseUrl: "https://example.com/v1",
  });

  const model = createLanguageModelForConnection({
    connection,
    modelId: "demo-model",
  }) as ReturnType<typeof createLanguageModelForConnection> & { provider: string };

  expect(model.provider).toBe("openrouter.chat");
});

test("gateway factory uses the gateway provider implementation", () => {
  const connection = createConnectionRow({
    sdkPackage: "@ai-sdk/gateway",
    baseUrl: "https://example.com",
  });

  const provider = createProviderForConnection(connection) as ReturnType<
    typeof createProviderForConnection
  > & {
    getCredits?: unknown;
  };
  const model = createLanguageModelForConnection({
    connection,
    modelId: "openai/gpt-4.1-mini",
  }) as ReturnType<typeof createLanguageModelForConnection> & {
    provider: string;
    config: { baseURL?: string };
  };

  expect(typeof provider.getCredits).toBe("function");
  expect(model.provider).toBe("gateway");
  expect(model.config.baseURL).toBe("https://example.com");
});

test("azure factory reads configJson and prefers baseURL when both are present", () => {
  const connection = createConnectionRow({
    sdkPackage: "@ai-sdk/azure",
    baseUrl: "https://azure-proxy.example.com",
    configJson: stringifyAiConnectionConfig({
      sdkPackage: "@ai-sdk/azure",
      config: {
        azure: {
          resourceName: "azure-demo",
          apiVersion: "preview",
          useDeploymentBasedUrls: true,
        },
      },
    }),
  });

  const model = createLanguageModelForConnection({
    connection,
    modelId: "story-model",
  }) as ReturnType<typeof createLanguageModelForConnection> & {
    provider: string;
    config: {
      url: (_options: { path: string; modelId: string }) => string;
    };
  };

  expect(model.provider).toBe("azure.responses");
  expect(model.config.url({ path: "/responses", modelId: "story-model" })).toBe(
    "https://azure-proxy.example.com/deployments/story-model/responses?api-version=preview",
  );
});
