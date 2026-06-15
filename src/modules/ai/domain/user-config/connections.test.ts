import { expect, test } from "bun:test";

import * as aiConnections from "./connections";

test("ai connections config defaults to an empty list when missing", () => {
  expect(aiConnections.list()).toEqual([]);
});

test("ai connection config persists connections overrides and custom models", () => {
  aiConnections.insert({
    id: "conn_a",
    kind: "custom",
    name: "Connection A",
    sdkPackage: "@ai-sdk/openai",
    catalogProviderId: null,
    baseUrl: null,
    apiKey: "sk-test",
    configJson: "{}",
    isEnabled: true,
    createdAt: 1,
    updatedAt: 1,
  });
  aiConnections.insertCustomModel({
    id: "model_a",
    connectionId: "conn_a",
    modelId: "gpt-test",
    displayName: "GPT Test",
    contextWindow: null,
    maxOutputTokens: null,
    supportsVision: false,
    supportsToolUse: true,
    supportsReasoning: false,
    supportsTemperature: false,
    inputPricePer1m: null,
    outputPricePer1m: null,
    isEnabled: true,
    createdAt: 1,
    updatedAt: 1,
  });
  aiConnections.setCatalogModelOverride({
    id: "override_a",
    connectionId: "conn_a",
    catalogModelId: "openai:gpt-test",
    isEnabled: false,
    createdAt: 1,
    updatedAt: 1,
  });

  expect(aiConnections.get("conn_a")?.apiKey).toBe("sk-test");
  expect(aiConnections.listCustomModelsForConnection("conn_a")).toHaveLength(1);
  expect(aiConnections.listCatalogOverridesForConnection("conn_a")).toHaveLength(1);

  aiConnections.remove("conn_a");
  expect(aiConnections.get("conn_a")).toBeNull();
  expect(aiConnections.listCustomModelsForConnection("conn_a")).toEqual([]);
  expect(aiConnections.listCatalogOverridesForConnection("conn_a")).toEqual([]);
});
