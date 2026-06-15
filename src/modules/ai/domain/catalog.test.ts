import { expect, test } from "bun:test";

import { setupTestDataDir } from "@/test/setup";

setupTestDataDir();

const userConfig = await import("./user-config");
const {
  assertConnectionSupportsCustomModel,
  getAiCatalogStatus,
  listCatalogModelsView,
  listCatalogProvidersView,
  listResolvedModelsForConnection,
  syncAiCatalogFromPayload,
} = await import("./catalog");
const { listProviders, readRegistryState } = await import("./catalog-file-store");

const payloadV1 = JSON.stringify({
  openai: {
    id: "openai",
    name: "OpenAI",
    npm: "@ai-sdk/openai",
    env: ["OPENAI_API_KEY"],
    models: {
      "gpt-4o": {
        id: "gpt-4o",
        name: "GPT-4o",
        tool_call: true,
        modalities: {
          input: ["text", "image"],
          output: ["text"],
        },
        limit: {
          context: 128000,
          output: 16384,
        },
        cost: {
          input: 2.5,
          output: 10,
        },
      },
      "tts-preview": {
        id: "tts-preview",
        name: "TTS Preview",
        modalities: {
          input: ["text"],
          output: ["audio"],
        },
      },
    },
  },
  mystery: {
    id: "mystery",
    name: "Mystery",
    npm: "@ai-sdk/unknown",
    models: {
      "mystery-text": {
        id: "mystery-text",
        name: "Mystery Text",
        reasoning: true,
        modalities: {
          input: ["text"],
          output: ["text"],
        },
      },
    },
  },
});

const payloadV2 = JSON.stringify({
  openai: {
    id: "openai",
    name: "OpenAI",
    npm: "@ai-sdk/openai",
    env: ["OPENAI_API_KEY"],
    models: {
      "gpt-4.1-mini": {
        id: "gpt-4.1-mini",
        name: "GPT-4.1 mini",
        modalities: {
          input: ["text"],
          output: ["text"],
        },
        limit: {
          context: 64000,
          output: 8192,
        },
      },
    },
  },
});

test("catalog sync imports only text-to-text models and exposes support metadata", async () => {
  await syncAiCatalogFromPayload(payloadV1);

  const providers = listCatalogProvidersView({ activeOnly: false, supportedOnly: false });
  const openai = providers.find((provider) => provider.id === "openai");
  const mystery = providers.find((provider) => provider.id === "mystery");

  expect(openai?.isSupported).toBe(true);
  expect(openai?.modelCount).toBe(1);
  expect(mystery?.isSupported).toBe(false);
  expect(mystery?.modelCount).toBe(1);

  const allModels = listProviders().flatMap((provider) =>
    listCatalogModelsView({ catalogProviderId: provider.id, activeOnly: false }),
  );
  expect(allModels.map((model) => model.modelId).sort()).toEqual(["gpt-4o", "mystery-text"]);

  // Registry state should have a non-null contentHash after a successful sync.
  const state = readRegistryState();
  expect(state).not.toBeNull();
  expect(state?.contentHash).not.toBeNull();
  expect(state?.lastSuccessAt).not.toBeNull();
});

test("catalog sync marks removed providers and models inactive instead of deleting them", async () => {
  await syncAiCatalogFromPayload(payloadV1);
  await syncAiCatalogFromPayload(payloadV2);

  const providers = listProviders();
  const openai = providers.find((provider) => provider.id === "openai");
  const mystery = providers.find((provider) => provider.id === "mystery");
  expect(openai?.isActive).toBe(true);
  expect(mystery?.isActive).toBe(false);

  const openaiModels = listCatalogModelsView({
    catalogProviderId: "openai",
    activeOnly: false,
  });
  const modelIds = openaiModels.map((model) => model.modelId).sort();
  expect(modelIds).toEqual(["gpt-4.1-mini", "gpt-4o"]);

  const activeModelIds = openaiModels
    .filter((model) => model.isActive)
    .map((model) => model.modelId)
    .sort();
  expect(activeModelIds).toEqual(["gpt-4.1-mini"]);
});

test("registry connections resolve active catalog models, apply overrides, and reject custom collisions", async () => {
  await syncAiCatalogFromPayload(payloadV1);

  const timestamp = Date.now();
  userConfig.insertAiConnectionToConfig({
    id: "conn_openai",
    kind: "registry",
    name: "OpenAI Main",
    sdkPackage: "@ai-sdk/openai",
    catalogProviderId: "openai",
    baseUrl: null,
    apiKey: "sk-test",
    configJson: "{}",
    isEnabled: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  const initialModels = listResolvedModelsForConnection({
    connectionId: "conn_openai",
    includeDisabled: true,
  });
  expect(initialModels).toHaveLength(1);
  expect(initialModels[0]?.origin).toBe("catalog");
  expect(initialModels[0]?.isEnabled).toBe(true);

  userConfig.setCatalogModelOverrideInConfig({
    id: "ovr_gpt4o",
    connectionId: "conn_openai",
    catalogModelId: "openai:gpt-4o",
    isEnabled: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  const overriddenModels = listResolvedModelsForConnection({
    connectionId: "conn_openai",
    includeDisabled: true,
  });
  expect(overriddenModels[0]?.isEnabled).toBe(false);

  const connection = userConfig.getAiConnectionFromConfig("conn_openai")!;
  expect(() => assertConnectionSupportsCustomModel(connection, "gpt-4o")).toThrow();

  userConfig.insertCustomModelToConfig({
    id: "cmodel_story",
    connectionId: "conn_openai",
    modelId: "story-specialist",
    displayName: "Story Specialist",
    contextWindow: null,
    maxOutputTokens: null,
    supportsVision: false,
    supportsToolUse: true,
    supportsReasoning: false,
    supportsTemperature: false,
    inputPricePer1m: null,
    outputPricePer1m: null,
    isEnabled: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  const resolvedWithCustom = listResolvedModelsForConnection({
    connectionId: "conn_openai",
    includeDisabled: true,
  });
  expect(resolvedWithCustom.map((model) => model.modelId)).toEqual(["gpt-4o", "story-specialist"]);
  expect(resolvedWithCustom[1]?.origin).toBe("custom");
});

test("getAiCatalogStatus reports counts and freshness", async () => {
  const emptyStatus = getAiCatalogStatus();
  expect(emptyStatus.providerCount).toBe(0);
  expect(emptyStatus.modelCount).toBe(0);
  expect(emptyStatus.lastSuccessAt).toBeNull();
  expect(emptyStatus.isStale).toBe(true);

  await syncAiCatalogFromPayload(payloadV1);
  const status = getAiCatalogStatus();
  expect(status.providerCount).toBeGreaterThanOrEqual(2);
  expect(status.activeProviderCount).toBeGreaterThanOrEqual(1);
  expect(status.modelCount).toBeGreaterThanOrEqual(2);
  expect(status.activeModelCount).toBeGreaterThanOrEqual(2);
  expect(status.lastSuccessAt).not.toBeNull();
  expect(status.isStale).toBe(false);
});
