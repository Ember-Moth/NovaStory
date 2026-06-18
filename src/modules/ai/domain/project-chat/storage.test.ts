import { expect, test } from "bun:test";

import * as userConfig from "@/modules/ai/domain/user-config";
import { seedProjectRecord } from "@/test/project";
import { setupMockDatabase } from "@/test/mock-db";

import {
  createProjectChat,
  getProjectChatDetail,
  selectProjectChatMessageChild,
  writeProjectChatMessages,
  type StoredProjectChatMessage,
} from "./index";

setupMockDatabase();

function seedModelSelection() {
  const timestamp = Date.now();
  userConfig.aiConnections.insert({
    id: "connection_test",
    kind: "custom",
    name: "Test Connection",
    sdkPackage: "@ai-sdk/openai-compatible",
    catalogProviderId: null,
    baseUrl: "https://example.invalid",
    apiKey: "test-key",
    configJson: "{}",
    isEnabled: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  userConfig.aiConnections.insertCustomModel({
    id: "custom_model_test",
    connectionId: "connection_test",
    modelId: "test-model",
    displayName: "Test Model",
    contextWindow: 8192,
    maxOutputTokens: 2048,
    supportsVision: false,
    supportsToolUse: true,
    supportsReasoning: false,
    supportsTemperature: true,
    inputPricePer1m: null,
    outputPricePer1m: null,
    isEnabled: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  return {
    connectionId: "connection_test",
    modelId: "custom:custom_model_test",
  };
}

function message(id: string, parentMessageId: string | null): StoredProjectChatMessage {
  return {
    id,
    role: id.startsWith("assistant") ? "assistant" : "user",
    parts: [
      {
        type: "text",
        text: id,
      },
    ],
    metadata: {},
    parentMessageId,
    createdAt: 1,
    updatedAt: 1,
  };
}

test("project chat storage persists messages and branch selection under git custom refs", () => {
  seedProjectRecord("project_chat_storage");
  const modelConfig = seedModelSelection();
  const chat = createProjectChat("project_chat_storage", {
    modelConfig,
  });

  writeProjectChatMessages(
    "project_chat_storage",
    chat.id,
    [message("user_a", null), message("assistant_a1", "user_a"), message("assistant_a2", "user_a")],
    "Seed project chat messages",
  );
  selectProjectChatMessageChild("project_chat_storage", chat.id, "user_a", "assistant_a1");

  const detail = getProjectChatDetail("project_chat_storage", chat.id);

  expect(detail.chat.modelConfig).toEqual(modelConfig);
  expect(detail.visibleMessages.map((entry) => entry.id)).toEqual(["user_a", "assistant_a1"]);
  expect(detail.candidateGroups).toEqual([
    {
      parentMessageId: "user_a",
      activeMessageId: "assistant_a1",
      messageIds: ["assistant_a1", "assistant_a2"],
    },
  ]);
});
