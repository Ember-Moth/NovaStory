import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { YAML } from "bun";

import { ensureConfigDir } from "@/shared/lib/storage-paths";
import * as globalPrompts from "./prompts";

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

function getDisabledPromptConfigFilePath(id: string) {
  return join(getPromptsConfigDir(), `${encodeURIComponent(id)}.disabled.md`);
}

test("global prompt config defaults to an empty list when missing", () => {
  expect(globalPrompts.list()).toEqual([]);
});

test("prompt config persists create update and delete operations", () => {
  globalPrompts.insert(prompt("prompt_a", "Alpha"));
  globalPrompts.insert(prompt("prompt_b", "Beta"));

  expect(globalPrompts.list().map((item) => item.name)).toEqual(["Alpha", "Beta"]);

  globalPrompts.update("prompt_a", {
    content: "Updated",
    updatedAt: 2,
  });
  const updatedPrompt = globalPrompts.get("prompt_a");
  expect(updatedPrompt?.content).toBe("Updated");

  globalPrompts.remove("prompt_b");
  expect(globalPrompts.list().map((item) => item.id)).toEqual(["prompt_a"]);

  const promptFiles = readdirSync(getPromptsConfigDir()).filter((name) => name.endsWith(".md"));
  expect(promptFiles).toEqual(["prompt_a.md"]);
  const rawPrompt = readFileSync(getPromptConfigFilePath("prompt_a"), "utf8");
  const frontMatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(rawPrompt)?.[1] ?? "";
  expect(YAML.parse(frontMatter)).toEqual({
    name: "Alpha",
  });
  const stats = statSync(getPromptConfigFilePath("prompt_a"));
  expect(updatedPrompt).toMatchObject({
    id: "prompt_a",
    createdAt: Math.trunc(stats.birthtimeMs),
    updatedAt: Math.trunc(stats.mtimeMs),
  });
  expect(rawPrompt).toContain("---\nUpdated\n");
  expect(existsSync(getPromptConfigFilePath("prompt_b"))).toBe(false);
});

test("prompt enabled state is stored in the filename suffix", () => {
  globalPrompts.insert({ ...prompt("prompt_a", "Alpha"), isEnabled: false });

  expect(existsSync(getPromptConfigFilePath("prompt_a"))).toBe(false);
  expect(existsSync(getDisabledPromptConfigFilePath("prompt_a"))).toBe(true);
  expect(globalPrompts.get("prompt_a")?.isEnabled).toBe(false);

  globalPrompts.update("prompt_a", { isEnabled: true });
  expect(existsSync(getPromptConfigFilePath("prompt_a"))).toBe(true);
  expect(existsSync(getDisabledPromptConfigFilePath("prompt_a"))).toBe(false);
  expect(globalPrompts.get("prompt_a")?.isEnabled).toBe(true);

  globalPrompts.update("prompt_a", { isEnabled: false });
  expect(existsSync(getPromptConfigFilePath("prompt_a"))).toBe(false);
  expect(existsSync(getDisabledPromptConfigFilePath("prompt_a"))).toBe(true);

  const rawPrompt = readFileSync(getDisabledPromptConfigFilePath("prompt_a"), "utf8");
  const frontMatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(rawPrompt)?.[1] ?? "";
  expect(YAML.parse(frontMatter)).toEqual({
    name: "Alpha",
  });
});

test("invalid prompt directory file throws and is not overwritten", () => {
  globalPrompts.insert(prompt("prompt_a", "Alpha"));
  writeFileSync(getPromptConfigFilePath("prompt_a"), "{not-front-matter", "utf8");

  expect(() => globalPrompts.list()).toThrow("不是有效 Prompt Markdown");
  expect(() =>
    globalPrompts.update("prompt_a", {
      content: "Updated",
      updatedAt: 2,
    }),
  ).toThrow("不是有效 Prompt Markdown");
  expect(readFileSync(getPromptConfigFilePath("prompt_a"), "utf8")).toBe("{not-front-matter");
});

test("multiple file-backed writes keep all records", async () => {
  await Promise.all(
    Array.from({ length: 20 }, async (_, index) => {
      globalPrompts.insert(prompt(`prompt_${index}`, `Prompt ${index}`));
    }),
  );

  expect(globalPrompts.list()).toHaveLength(20);
});
