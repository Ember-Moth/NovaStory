import { expect, test } from "bun:test";

import { resolveSidebarActiveChat } from "./sidebarSessionState";

test("resolveSidebarActiveChat keeps the current active chat when it remains visible", () => {
  expect(
    resolveSidebarActiveChat({
      activeChatId: "chat_b",
      visibleChatIds: ["chat_a", "chat_b"],
    }),
  ).toEqual({
    nextActiveChatId: "chat_b",
  });
});

test("resolveSidebarActiveChat falls back to the first visible chat when the active chat is filtered out", () => {
  expect(
    resolveSidebarActiveChat({
      activeChatId: "archived_chat",
      visibleChatIds: ["chat_a", "chat_b"],
    }),
  ).toEqual({
    nextActiveChatId: "chat_a",
  });
});

test("resolveSidebarActiveChat does not auto-create when hiding archived leaves the list empty after initialization", () => {
  expect(
    resolveSidebarActiveChat({
      activeChatId: "archived_chat",
      visibleChatIds: [],
    }),
  ).toEqual({
    nextActiveChatId: null,
  });
});

test("resolveSidebarActiveChat returns null when both active and visible are empty", () => {
  expect(
    resolveSidebarActiveChat({
      activeChatId: null,
      visibleChatIds: [],
    }),
  ).toEqual({
    nextActiveChatId: null,
  });
});
