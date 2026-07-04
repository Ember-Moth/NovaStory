import { expect, test } from "bun:test";

import { rpcTags } from "@/rpc/tags";
import * as promptHandlers from "./index";

const requestCtx = { req: new Request("http://localhost/api/rpc") } as unknown as Parameters<
  typeof promptHandlers.listGlobalPrompts.handler
>[1];

async function createPrompt(name: string, content = `${name} content`) {
  const result = await promptHandlers.createGlobalPrompt.handler(
    {
      name,
      description: ` ${name} description `,
      content: ` ${content} `,
    },
    requestCtx,
  );
  return result.data;
}

test("global prompt creation normalizes fields and invalidates the list", async () => {
  const result = await promptHandlers.createGlobalPrompt.handler(
    {
      name: "  章节扩写  ",
      description: "  扩写当前章节  ",
      content: "  请扩写正文  ",
    },
    requestCtx,
  );

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
    promptHandlers.createGlobalPrompt.handler(
      {
        name: " ",
        content: "正文",
      },
      requestCtx,
    ),
  ).rejects.toThrow("名称不能为空。");

  await expect(
    promptHandlers.createGlobalPrompt.handler(
      {
        name: "空正文",
        content: " ",
      },
      requestCtx,
    ),
  ).rejects.toThrow("Prompt 正文不能为空。");
});

test("global prompts reject duplicate names on create and update", async () => {
  const first = await createPrompt("Prompt A");
  await createPrompt("Prompt B");

  await expect(
    promptHandlers.createGlobalPrompt.handler(
      {
        name: "Prompt A",
        content: "duplicate",
      },
      requestCtx,
    ),
  ).rejects.toThrow("Prompt 名称已存在。");

  await expect(
    promptHandlers.updateGlobalPrompt.handler(
      {
        id: first.id,
        name: "Prompt B",
      },
      requestCtx,
    ),
  ).rejects.toThrow("Prompt 名称已存在。");
});

test("global prompts update enabled state, nullable description, and content", async () => {
  const prompt = await createPrompt("Prompt C");

  const result = await promptHandlers.updateGlobalPrompt.handler(
    {
      id: prompt.id,
      description: " ",
      content: " revised content ",
      isEnabled: false,
    },
    requestCtx,
  );

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

  const listed = await promptHandlers.listGlobalPrompts.handler(undefined, requestCtx);
  expect(listed.watch).toEqual([rpcTags.aiGlobalPrompts()]);
  expect(listed.data.map((prompt) => prompt.name)).toEqual(["Alpha", "Beta"]);

  const deleted = await promptHandlers.deleteGlobalPrompt.handler({ id: alpha.id }, requestCtx);
  expect(deleted.invalidate).toEqual([rpcTags.aiGlobalPrompts()]);
  expect(deleted.data).toEqual({ id: alpha.id });

  const afterDelete = await promptHandlers.listGlobalPrompts.handler(undefined, requestCtx);
  expect(afterDelete.data.map((prompt) => prompt.name)).toEqual(["Beta"]);
});
