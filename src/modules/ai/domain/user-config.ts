import { createJsonFileStore } from "@/shared/lib/json-file-store";
import { getConfigFilePath } from "@/shared/lib/storage-paths";
import type {
  AiConnectionCatalogOverrideRow,
  AiConnectionCustomModelRow,
  AiConnectionRow,
  GlobalPromptRow,
} from "./types";

interface PromptConfigFile {
  prompts: GlobalPromptRow[];
}

interface AiConnectionsConfigFile {
  connections: AiConnectionRow[];
  catalogOverrides: AiConnectionCatalogOverrideRow[];
  customModels: AiConnectionCustomModelRow[];
}

const promptStore = createJsonFileStore<PromptConfigFile>(
  () => getConfigFilePath("prompts.json"),
  () => ({ prompts: [] }),
);

const aiConnectionsStore = createJsonFileStore<AiConnectionsConfigFile>(
  () => getConfigFilePath("ai-connections.json"),
  () => ({ connections: [], catalogOverrides: [], customModels: [] }),
);

function normalizeAiConnectionsFile(file: AiConnectionsConfigFile): AiConnectionsConfigFile {
  return {
    connections: file.connections ?? [],
    catalogOverrides: file.catalogOverrides ?? [],
    customModels: file.customModels ?? [],
  };
}

export function listGlobalPromptsFromConfig() {
  return [...promptStore.read().prompts].sort((a, b) => a.name.localeCompare(b.name));
}

export function getGlobalPromptFromConfig(id: string) {
  return promptStore.read().prompts.find((prompt) => prompt.id === id) ?? null;
}

export function findGlobalPromptByNameFromConfig(name: string) {
  return promptStore.read().prompts.find((prompt) => prompt.name === name) ?? null;
}

export function insertGlobalPromptToConfig(prompt: GlobalPromptRow) {
  promptStore.update((file) => ({
    prompts: [...file.prompts, prompt],
  }));
  return prompt;
}

export function updateGlobalPromptInConfig(id: string, updates: Partial<GlobalPromptRow>) {
  let updated: GlobalPromptRow | null = null;
  promptStore.update((file) => ({
    prompts: file.prompts.map((prompt) => {
      if (prompt.id !== id) return prompt;
      updated = { ...prompt, ...updates };
      return updated;
    }),
  }));
  return updated;
}

export function deleteGlobalPromptFromConfig(id: string) {
  promptStore.update((file) => ({
    prompts: file.prompts.filter((prompt) => prompt.id !== id),
  }));
}

export function listAiConnectionsFromConfig() {
  return [...normalizeAiConnectionsFile(aiConnectionsStore.read()).connections].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}

export function getAiConnectionFromConfig(id: string) {
  return (
    normalizeAiConnectionsFile(aiConnectionsStore.read()).connections.find(
      (connection) => connection.id === id,
    ) ?? null
  );
}

export function insertAiConnectionToConfig(connection: AiConnectionRow) {
  aiConnectionsStore.update((file) => {
    const normalized = normalizeAiConnectionsFile(file);
    return {
      ...normalized,
      connections: [...normalized.connections, connection],
    };
  });
  return connection;
}

export function updateAiConnectionInConfig(id: string, updates: Partial<AiConnectionRow>) {
  let updated: AiConnectionRow | null = null;
  aiConnectionsStore.update((file) => {
    const normalized = normalizeAiConnectionsFile(file);
    return {
      ...normalized,
      connections: normalized.connections.map((connection) => {
        if (connection.id !== id) return connection;
        updated = { ...connection, ...updates };
        return updated;
      }),
    };
  });
  return updated;
}

export function deleteAiConnectionFromConfig(id: string) {
  aiConnectionsStore.update((file) => {
    const normalized = normalizeAiConnectionsFile(file);
    return {
      connections: normalized.connections.filter((connection) => connection.id !== id),
      catalogOverrides: normalized.catalogOverrides.filter(
        (override) => override.connectionId !== id,
      ),
      customModels: normalized.customModels.filter((model) => model.connectionId !== id),
    };
  });
}

export function listCatalogOverridesForConnectionFromConfig(connectionId: string) {
  return normalizeAiConnectionsFile(aiConnectionsStore.read()).catalogOverrides.filter(
    (override) => override.connectionId === connectionId,
  );
}

export function setCatalogModelOverrideInConfig(override: AiConnectionCatalogOverrideRow) {
  aiConnectionsStore.update((file) => {
    const normalized = normalizeAiConnectionsFile(file);
    const existing = normalized.catalogOverrides.find(
      (item) =>
        item.connectionId === override.connectionId &&
        item.catalogModelId === override.catalogModelId,
    );
    return {
      ...normalized,
      catalogOverrides: existing
        ? normalized.catalogOverrides.map((item) =>
            item.connectionId === override.connectionId &&
            item.catalogModelId === override.catalogModelId
              ? { ...item, isEnabled: override.isEnabled, updatedAt: override.updatedAt }
              : item,
          )
        : [...normalized.catalogOverrides, override],
    };
  });
}

export function deleteCatalogModelOverrideFromConfig(connectionId: string, catalogModelId: string) {
  aiConnectionsStore.update((file) => {
    const normalized = normalizeAiConnectionsFile(file);
    return {
      ...normalized,
      catalogOverrides: normalized.catalogOverrides.filter(
        (override) =>
          override.connectionId !== connectionId || override.catalogModelId !== catalogModelId,
      ),
    };
  });
}

export function listCustomModelsForConnectionFromConfig(connectionId: string) {
  return normalizeAiConnectionsFile(aiConnectionsStore.read()).customModels.filter(
    (model) => model.connectionId === connectionId,
  );
}

export function getCustomModelFromConfig(id: string) {
  return (
    normalizeAiConnectionsFile(aiConnectionsStore.read()).customModels.find(
      (model) => model.id === id,
    ) ?? null
  );
}

export function insertCustomModelToConfig(model: AiConnectionCustomModelRow) {
  aiConnectionsStore.update((file) => {
    const normalized = normalizeAiConnectionsFile(file);
    return {
      ...normalized,
      customModels: [...normalized.customModels, model],
    };
  });
  return model;
}

export function updateCustomModelInConfig(
  id: string,
  updates: Partial<AiConnectionCustomModelRow>,
) {
  let updated: AiConnectionCustomModelRow | null = null;
  aiConnectionsStore.update((file) => {
    const normalized = normalizeAiConnectionsFile(file);
    return {
      ...normalized,
      customModels: normalized.customModels.map((model) => {
        if (model.id !== id) return model;
        updated = { ...model, ...updates };
        return updated;
      }),
    };
  });
  return updated;
}

export function deleteCustomModelFromConfig(id: string) {
  aiConnectionsStore.update((file) => {
    const normalized = normalizeAiConnectionsFile(file);
    return {
      ...normalized,
      customModels: normalized.customModels.filter((model) => model.id !== id),
    };
  });
}
