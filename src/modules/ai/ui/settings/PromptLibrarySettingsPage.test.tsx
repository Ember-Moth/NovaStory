import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import type { GlobalPromptRow } from "@/modules/ai/domain/types";

import { filterGlobalPrompts, PromptLibraryEmptyState } from "./PromptLibrarySettingsPage";

function createPrompt(overrides: Partial<GlobalPromptRow> & Pick<GlobalPromptRow, "name">) {
  return {
    id: `prompt_${overrides.name}`,
    description: null,
    content: "",
    isEnabled: true,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
    name: overrides.name,
  } satisfies GlobalPromptRow;
}

test("filterGlobalPrompts searches name, description, and content", () => {
  const prompts = [
    createPrompt({ name: "章节扩写", description: "用于正文", content: "请扩写章节" }),
    createPrompt({ name: "角色检查", description: "人物一致性", content: "检查动机" }),
  ];

  expect(filterGlobalPrompts(prompts, "扩写").map((prompt) => prompt.name)).toEqual(["章节扩写"]);
  expect(filterGlobalPrompts(prompts, "一致性").map((prompt) => prompt.name)).toEqual(["角色检查"]);
  expect(filterGlobalPrompts(prompts, "动机").map((prompt) => prompt.name)).toEqual(["角色检查"]);
});

test("PromptLibraryEmptyState renders a creation entry", () => {
  const html = renderToStaticMarkup(<PromptLibraryEmptyState onCreate={() => {}} />);

  expect(html).toContain("还没有 Prompt");
  expect(html).toContain("新建 Prompt");
});
