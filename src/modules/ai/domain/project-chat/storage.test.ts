import { expect, test } from "bun:test";

import * as userConfig from "@/modules/ai/domain/user-config";
import { setupMockDatabase } from "@/test/mock-db";
import { seedProjectRecord } from "@/test/project";

import {
  createProjectChat,
  deleteProjectChat,
  getProjectChat,
  getProjectChatDetail,
  getProjectChatMessages,
  listProjectChats,
  type StoredProjectChatMessage,
  selectProjectChatMessageChild,
  writeProjectChatMessages,
} from "./index";

setupMockDatabase();

const PROJECT_ID = "project_chat_storage";

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

test("persists messages and branch selection under git custom refs", async () => {
  seedProjectRecord(PROJECT_ID);
  const modelConfig = seedModelSelection();
  const chat = await createProjectChat(PROJECT_ID, { modelConfig });

  await writeProjectChatMessages(
    PROJECT_ID,
    chat.id,
    [message("user_a", null), message("assistant_a1", "user_a"), message("assistant_a2", "user_a")],
    "Seed project chat messages",
  );
  await selectProjectChatMessageChild(PROJECT_ID, chat.id, "user_a", "assistant_a1");

  const detail = await getProjectChatDetail(PROJECT_ID, chat.id);

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

test("listProjectChats and getProjectChat return correct results", async () => {
  seedProjectRecord(`${PROJECT_ID}_list`);
  const modelConfig = seedModelSelection();
  const chat = await createProjectChat(`${PROJECT_ID}_list`, {
    modelConfig,
    title: "Test Session",
  });

  // listProjectChats should include the new chat
  const list = await listProjectChats(`${PROJECT_ID}_list`);
  expect(list.length).toBe(1);
  expect(list[0]!.id).toBe(chat.id);
  expect(list[0]!.title).toBe("Test Session");

  // getProjectChat should return the same chat
  const fetched = await getProjectChat(`${PROJECT_ID}_list`, chat.id);
  expect(fetched).not.toBeNull();
  expect(fetched!.title).toBe("Test Session");
  expect(fetched!.modelConfig).toEqual(modelConfig);
});

test("per-chat I/O isolation: messages for different chats do not interfere", async () => {
  seedProjectRecord(`${PROJECT_ID}_isolation`);
  const modelConfig = seedModelSelection();
  const chatA = await createProjectChat(`${PROJECT_ID}_isolation`, {
    modelConfig,
    title: "Chat A",
  });
  const chatB = await createProjectChat(`${PROJECT_ID}_isolation`, {
    modelConfig,
    title: "Chat B",
  });

  // Write different messages to each chat
  await writeProjectChatMessages(
    `${PROJECT_ID}_isolation`,
    chatA.id,
    [message("msg_a1", null)],
    "Messages for A",
  );
  await writeProjectChatMessages(
    `${PROJECT_ID}_isolation`,
    chatB.id,
    [message("msg_b1", null), message("msg_b2", "msg_b1")],
    "Messages for B",
  );

  // Verify each chat has only its own messages
  const messagesA = await getProjectChatMessages(`${PROJECT_ID}_isolation`, chatA.id);
  expect(messagesA.map((m) => m.id)).toEqual(["msg_a1"]);

  const messagesB = await getProjectChatMessages(`${PROJECT_ID}_isolation`, chatB.id);
  expect(messagesB.map((m) => m.id)).toEqual(["msg_b1", "msg_b2"]);

  // list should return both chats
  const list = await listProjectChats(`${PROJECT_ID}_isolation`);
  expect(list.length).toBe(2);
  expect(list.map((c) => c.id).sort()).toEqual([chatA.id, chatB.id].sort());
});

test("deleteProjectChat removes all associated files", async () => {
  seedProjectRecord(`${PROJECT_ID}_delete`);
  const modelConfig = seedModelSelection();
  const chat = await createProjectChat(`${PROJECT_ID}_delete`, {
    modelConfig,
    title: "To Delete",
  });

  // Write some data first
  await writeProjectChatMessages(
    `${PROJECT_ID}_delete`,
    chat.id,
    [message("user_x", null), message("assistant_x", "user_x")],
    "Seed messages",
  );
  await selectProjectChatMessageChild(`${PROJECT_ID}_delete`, chat.id, "user_x", "assistant_x");

  // Verify data exists
  expect(await getProjectChat(`${PROJECT_ID}_delete`, chat.id)).not.toBeNull();

  // Delete the chat
  await deleteProjectChat(`${PROJECT_ID}_delete`, chat.id);

  // Verify chat metadata is gone
  expect(await getProjectChat(`${PROJECT_ID}_delete`, chat.id)).toBeNull();

  // Verify messages are gone
  const messages = await getProjectChatMessages(`${PROJECT_ID}_delete`, chat.id);
  expect(messages).toEqual([]);

  // Verify list no longer has the chat
  const list = await listProjectChats(`${PROJECT_ID}_delete`);
  expect(list.map((c) => c.id)).not.toContain(chat.id);
});
