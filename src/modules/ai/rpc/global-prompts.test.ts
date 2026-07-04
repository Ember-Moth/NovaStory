import { expect, test } from "vitest";

import { rpcTags } from "@/rpc/tags";
import * as promptHandlers from "./index";

async function createPrompt(name: string, content = `${name} content`) {
  const result = await promptHandlers.createGlobalPrompt({
    name,
    description: ` ${name} description `,
    content: ` ${content} `,
  });
  return result.data;
}

test("global prompt creation normalizes fields and invalidates the list", async () => {
  const result = await promptHandlers.createGlobalPrompt({
    name: "  章节扩写  ",
    description: "  扩写当前章节  ",
    content: "  请扩写正文  ",
  });

  expect(result.invalidate).toEqual([rpcTags.aiGlobalPrompts()]);
  expect(result.data).toMatchObject({
    name: "章节扩写",
    description: "扩写当前章节",
    content: "请扩写正文",
    isEnabled: true,
  });
});

test("global prompts reject empty required fields", async () => {
  await expect(
    promptHandlers.createGlobalPrompt({
      name: " ",
      content: "正文",
    }),
  ).rejects.toThrow("名称不能为空。");

  await expect(
    promptHandlers.createGlobalPrompt({
      name: "空正文",
      content: " ",
    }),
  ).rejects.toThrow("Prompt 正文不能为空。");
});

test("global prompts reject duplicate names on create and update", async () => {
  const first = await createPrompt("Prompt A");
  await createPrompt("Prompt B");

  await expect(
    promptHandlers.createGlobalPrompt({
      name: "Prompt A",
      content: "duplicate",
    }),
  ).rejects.toThrow("Prompt 名称已存在。");

  await expect(
    promptHandlers.updateGlobalPrompt({
      id: first.id,
      name: "Prompt B",
    }),
  ).rejects.toThrow("Prompt 名称已存在。");
});

test("global prompts update enabled state, nullable description, and content", async () => {
  const prompt = await createPrompt("Prompt C");

  const result = await promptHandlers.updateGlobalPrompt({
    id: prompt.id,
    description: " ",
    content: " revised content ",
    isEnabled: false,
  });

  expect(result.invalidate).toEqual([rpcTags.aiGlobalPrompts()]);
  expect(result.data).toMatchObject({
    id: prompt.id,
    description: null,
    content: "revised content",
    isEnabled: false,
  });
});

test("global prompts list by name and delete by id", async () => {
  await createPrompt("Beta");
  const alpha = await createPrompt("Alpha");

  const listed = await promptHandlers.listGlobalPrompts(undefined);
  expect(listed.watch).toEqual([rpcTags.aiGlobalPrompts()]);
  expect(listed.data.map((prompt: any) => prompt.name)).toEqual(["Alpha", "Beta"]);

  const deleted = await promptHandlers.deleteGlobalPrompt({ id: alpha.id });
  expect(deleted.invalidate).toEqual([rpcTags.aiGlobalPrompts()]);
  expect(deleted.data).toEqual({ id: alpha.id });

  const afterDelete = await promptHandlers.listGlobalPrompts(undefined);
  expect(afterDelete.data.map((prompt: any) => prompt.name)).toEqual(["Beta"]);
});
