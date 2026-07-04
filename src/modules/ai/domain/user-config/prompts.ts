import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import YAML from "yaml";

import { ensureConfigDir } from "@/shared/lib/storage-paths";
import type { GlobalPromptRow } from "../types";

type PromptFrontMatter = Pick<GlobalPromptRow, "name" | "description">;
type PromptFrontMatterValues = Record<string, unknown>;

function getPromptsConfigDir() {
  const dir = join(ensureConfigDir(), "prompts");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function getPromptConfigFilePath(id: string, isEnabled = true) {
  const suffix = isEnabled ? ".md" : ".disabled.md";
  return join(getPromptsConfigDir(), `${encodeURIComponent(id)}${suffix}`);
}

function listPromptConfigFiles(dir: string) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => join(dir, entry.name))
    .sort();
}

function inferPromptIdFromFilePath(filepath: string) {
  const filename = basename(filepath);
  const encodedId = filename.endsWith(".disabled.md")
    ? filename.slice(0, -".disabled.md".length)
    : filename.slice(0, -".md".length);
  return decodeURIComponent(encodedId);
}

function inferPromptEnabledFromFilePath(filepath: string) {
  return !basename(filepath).endsWith(".disabled.md");
}

function getPromptFileTimestamps(filepath: string) {
  const stats = statSync(filepath);
  return {
    createdAt: Math.trunc(stats.birthtimeMs),
    updatedAt: Math.trunc(stats.mtimeMs),
  };
}

function stripTrailingNewline(value: string) {
  return value.replace(/\r?\n$/, "");
}

function requireFrontMatterString(values: PromptFrontMatterValues, key: string) {
  const value = values[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Front Matter 字段 ${key} 必须是非空字符串。`);
  }
  return value;
}

function requireNullableFrontMatterString(values: PromptFrontMatterValues, key: string) {
  const value = values[key];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error(`Front Matter 字段 ${key} 必须是字符串或 null。`);
  }
  return value.trim().length > 0 ? value : null;
}

function parsePromptFrontMatter(raw: string): PromptFrontMatter {
  const parsed = YAML.parse(raw);
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Front Matter 必须是 YAML 对象。");
  }
  const values = parsed as PromptFrontMatterValues;
  return {
    name: requireFrontMatterString(values, "name"),
    description: requireNullableFrontMatterString(values, "description"),
  };
}

function stringifyPromptFrontMatter(frontMatter: PromptFrontMatter) {
  const values = {
    name: frontMatter.name,
    ...(frontMatter.description != null ? { description: frontMatter.description } : {}),
  };
  return `${YAML.stringify(values, null, 2).trimEnd()}\n`;
}

function readPromptFile(filepath: string): GlobalPromptRow {
  try {
    const raw = readFileSync(filepath, "utf8");
    const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
    if (!match) {
      throw new Error("缺少 YAML Front Matter。");
    }

    const frontMatter = parsePromptFrontMatter(match[1] ?? "");
    const timestamps = getPromptFileTimestamps(filepath);
    return {
      id: inferPromptIdFromFilePath(filepath),
      ...frontMatter,
      content: stripTrailingNewline(match[2] ?? ""),
      isEnabled: inferPromptEnabledFromFilePath(filepath),
      ...timestamps,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`配置文件 ${filepath} 不是有效 Prompt Markdown：${message}`);
  }
}

function readPromptConfigDirectory() {
  const dir = getPromptsConfigDir();
  return listPromptConfigFiles(dir).map((filepath) => readPromptFile(filepath));
}

function writePromptFile(prompt: GlobalPromptRow): GlobalPromptRow {
  const frontMatter: PromptFrontMatter = {
    name: prompt.name,
    description: prompt.description,
  };
  const markdown = `---\n${stringifyPromptFrontMatter(frontMatter)}---\n${prompt.content.trim()}\n`;
  const targetPath = getPromptConfigFilePath(prompt.id, prompt.isEnabled);
  const alternatePath = getPromptConfigFilePath(prompt.id, !prompt.isEnabled);
  const writePath = existsSync(targetPath)
    ? targetPath
    : existsSync(alternatePath)
      ? alternatePath
      : targetPath;

  writeFileSync(writePath, markdown, "utf8");
  if (writePath !== targetPath) {
    if (existsSync(targetPath)) {
      unlinkSync(targetPath);
    }
    renameSync(writePath, targetPath);
  }
  return readPromptFile(targetPath);
}

export function list() {
  return readPromptConfigDirectory().sort((a, b) => a.name.localeCompare(b.name));
}

export function get(id: string) {
  return readPromptConfigDirectory().find((prompt) => prompt.id === id) ?? null;
}

export function findByName(name: string) {
  return readPromptConfigDirectory().find((prompt) => prompt.name === name) ?? null;
}

export function insert(prompt: GlobalPromptRow) {
  readPromptConfigDirectory();
  return writePromptFile(prompt);
}

export function update(id: string, updates: Partial<GlobalPromptRow>) {
  const prompt = readPromptConfigDirectory().find((item) => item.id === id);
  if (!prompt) return null;

  const updated = { ...prompt, ...updates };
  return writePromptFile(updated);
}

export function remove(id: string) {
  readPromptConfigDirectory();
  for (const filepath of [getPromptConfigFilePath(id, true), getPromptConfigFilePath(id, false)]) {
    if (existsSync(filepath)) {
      unlinkSync(filepath);
    }
  }
}
