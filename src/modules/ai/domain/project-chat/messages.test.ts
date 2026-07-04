import { expect, test } from "bun:test";

import {
  buildProjectChatCandidateGroups,
  type ProjectChatPathState,
  resolveVisibleProjectChatPath,
  type StoredProjectChatMessage,
} from "./index";

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

test("resolveVisibleProjectChatPath prefers explicit branch selections", () => {
  const messages = [
    message("user_a", null),
    message("assistant_a1", "user_a"),
    message("assistant_a2", "user_a"),
    message("user_b", "assistant_a2"),
  ];
  const state: ProjectChatPathState = {
    selectedChildIdByParentId: {
      user_a: "assistant_a1",
    },
  };

  expect(resolveVisibleProjectChatPath(messages, state).map((entry) => entry.id)).toEqual([
    "user_a",
    "assistant_a1",
  ]);
});

test("buildProjectChatCandidateGroups exposes sibling branches on the visible path", () => {
  const messages = [
    message("user_a", null),
    message("assistant_a1", "user_a"),
    message("assistant_a2", "user_a"),
    message("user_b1", "assistant_a2"),
    message("user_b2", "assistant_a2"),
  ];
  const state: ProjectChatPathState = {
    selectedChildIdByParentId: {
      user_a: "assistant_a2",
      assistant_a2: "user_b1",
    },
  };

  expect(buildProjectChatCandidateGroups(messages, state)).toEqual([
    {
      parentMessageId: "user_a",
      activeMessageId: "assistant_a2",
      messageIds: ["assistant_a1", "assistant_a2"],
    },
    {
      parentMessageId: "assistant_a2",
      activeMessageId: "user_b1",
      messageIds: ["user_b1", "user_b2"],
    },
  ]);
});
