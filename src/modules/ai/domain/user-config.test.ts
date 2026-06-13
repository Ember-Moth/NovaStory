import { expect, test } from "bun:test";
import { YAML } from "bun";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { ensureConfigDir } from "@/shared/lib/storage-paths";
import { setupMockDatabase } from "@/test/mock-db";

setupMockDatabase();

const userConfig = await import("./user-config");

function prompt(id: string, name = id) {
  return {
    id,
    name,
    description: null,
    content: `${name} content`,
    isEnabled: true,
    createdAt: 1,
    updatedAt: 1,
  };
}

function getPromptsConfigDir() {
  return join(ensureConfigDir(), "prompts");
}

function getPromptConfigFilePath(id: string) {
  return join(getPromptsConfigDir(), `${encodeURIComponent(id)}.md`);
}

test("user config files default to empty lists when missing", () => {
  expect(userConfig.listGlobalPromptsFromConfig()).toEqual([]);
  expect(userConfig.listAiConnectionsFromConfig()).toEqual([]);
});

test("prompt config persists create update and delete operations", () => {
  userConfig.insertGlobalPromptToConfig(prompt("prompt_a", "Alpha"));
  userConfig.insertGlobalPromptToConfig(prompt("prompt_b", "Beta"));

  expect(userConfig.listGlobalPromptsFromConfig().map((item) => item.name)).toEqual([
    "Alpha",
    "Beta",
  ]);

  userConfig.updateGlobalPromptInConfig("prompt_a", {
    content: "Updated",
    updatedAt: 2,
  });
  expect(userConfig.getGlobalPromptFromConfig("prompt_a")?.content).toBe("Updated");

  userConfig.deleteGlobalPromptFromConfig("prompt_b");
  expect(userConfig.listGlobalPromptsFromConfig().map((item) => item.id)).toEqual(["prompt_a"]);

  const promptFiles = readdirSync(getPromptsConfigDir()).filter((name) => name.endsWith(".md"));
  expect(promptFiles).toEqual(["prompt_a.md"]);
  const rawPrompt = readFileSync(getPromptConfigFilePath("prompt_a"), "utf8");
  const frontMatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(rawPrompt)?.[1] ?? "";
  expect(YAML.parse(frontMatter)).toEqual({
    id: "prompt_a",
    name: "Alpha",
    description: null,
    isEnabled: true,
    createdAt: 1,
    updatedAt: 2,
  });
  expect(rawPrompt).toContain("---\nUpdated\n");
  expect(existsSync(getPromptConfigFilePath("prompt_b"))).toBe(false);
});

test("ai connection config persists connections overrides and custom models", () => {
  userConfig.insertAiConnectionToConfig({
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
  userConfig.insertCustomModelToConfig({
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
  userConfig.setCatalogModelOverrideInConfig({
    id: "override_a",
    connectionId: "conn_a",
    catalogModelId: "openai:gpt-test",
    isEnabled: false,
    createdAt: 1,
    updatedAt: 1,
  });

  expect(userConfig.getAiConnectionFromConfig("conn_a")?.apiKey).toBe("sk-test");
  expect(userConfig.listCustomModelsForConnectionFromConfig("conn_a")).toHaveLength(1);
  expect(userConfig.listCatalogOverridesForConnectionFromConfig("conn_a")).toHaveLength(1);

  userConfig.deleteAiConnectionFromConfig("conn_a");
  expect(userConfig.getAiConnectionFromConfig("conn_a")).toBeNull();
  expect(userConfig.listCustomModelsForConnectionFromConfig("conn_a")).toEqual([]);
  expect(userConfig.listCatalogOverridesForConnectionFromConfig("conn_a")).toEqual([]);
});

test("invalid prompt directory file throws and is not overwritten", () => {
  userConfig.insertGlobalPromptToConfig(prompt("prompt_a", "Alpha"));
  writeFileSync(getPromptConfigFilePath("prompt_a"), "{not-front-matter", "utf8");

  expect(() => userConfig.listGlobalPromptsFromConfig()).toThrow("不是有效 Prompt Markdown");
  expect(() =>
    userConfig.updateGlobalPromptInConfig("prompt_a", {
      content: "Updated",
      updatedAt: 2,
    }),
  ).toThrow("不是有效 Prompt Markdown");
  expect(readFileSync(getPromptConfigFilePath("prompt_a"), "utf8")).toBe("{not-front-matter");
});

test("multiple file-backed writes keep all records", async () => {
  await Promise.all(
    Array.from({ length: 20 }, async (_, index) => {
      userConfig.insertGlobalPromptToConfig(prompt(`prompt_${index}`, `Prompt ${index}`));
    }),
  );

  expect(userConfig.listGlobalPromptsFromConfig()).toHaveLength(20);
});
