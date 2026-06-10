import { expect, test } from "bun:test";

import { setupMockDatabase } from "@/test/mock-db";

setupMockDatabase();

const { db, schema } = await import("@/db");
const {
  assertConnectionSupportsCustomModel,
  listCatalogProvidersView,
  listResolvedModelsForConnection,
  syncAiCatalogFromPayload,
} = await import("./catalog");

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

  const models = db.query.aiCatalogModels.findMany().sync();
  expect(models.map((model) => model.modelId).sort()).toEqual(["gpt-4o", "mystery-text"]);
});

test("catalog sync marks removed providers and models inactive instead of deleting them", async () => {
  await syncAiCatalogFromPayload(payloadV1);
  await syncAiCatalogFromPayload(payloadV2);

  const providers = db.query.aiCatalogProviders.findMany().sync();
  const models = db.query.aiCatalogModels.findMany().sync();

  expect(providers.find((provider) => provider.id === "openai")?.isActive).toBe(true);
  expect(providers.find((provider) => provider.id === "mystery")?.isActive).toBe(false);
  expect(models.find((model) => model.id === "openai:gpt-4o")?.isActive).toBe(false);
  expect(models.find((model) => model.id === "openai:gpt-4.1-mini")?.isActive).toBe(true);
});

test("registry connections resolve active catalog models, apply overrides, and reject custom collisions", async () => {
  await syncAiCatalogFromPayload(payloadV1);

  const timestamp = Date.now();
  db.insert(schema.aiConnections)
    .values({
      id: "conn_openai",
      kind: "registry",
      name: "OpenAI Main",
      sdkPackage: "@ai-sdk/openai",
      catalogProviderId: "openai",
      apiKey: "sk-test",
      configJson: "{}",
      isEnabled: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();

  const initialModels = listResolvedModelsForConnection({
    connectionId: "conn_openai",
    includeDisabled: true,
  });
  expect(initialModels).toHaveLength(1);
  expect(initialModels[0]?.origin).toBe("catalog");
  expect(initialModels[0]?.isEnabled).toBe(true);

  db.insert(schema.aiConnectionCatalogOverrides)
    .values({
      id: "ovr_gpt4o",
      connectionId: "conn_openai",
      catalogModelId: "openai:gpt-4o",
      isEnabled: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();

  const overriddenModels = listResolvedModelsForConnection({
    connectionId: "conn_openai",
    includeDisabled: true,
  });
  expect(overriddenModels[0]?.isEnabled).toBe(false);

  const connection = db.query.aiConnections
    .findFirst({ where: (fields, { eq }) => eq(fields.id, "conn_openai") })
    .sync()!;
  expect(() => assertConnectionSupportsCustomModel(connection, "gpt-4o")).toThrow();

  db.insert(schema.aiConnectionCustomModels)
    .values({
      id: "cmodel_story",
      connectionId: "conn_openai",
      modelId: "story-specialist",
      displayName: "Story Specialist",
      supportsToolUse: true,
      isEnabled: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();

  const resolvedWithCustom = listResolvedModelsForConnection({
    connectionId: "conn_openai",
    includeDisabled: true,
  });
  expect(resolvedWithCustom.map((model) => model.modelId)).toEqual(["gpt-4o", "story-specialist"]);
  expect(resolvedWithCustom[1]?.origin).toBe("custom");
});
