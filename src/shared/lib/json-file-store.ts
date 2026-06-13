import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { createId } from "@/shared/lib/domain";

export class JsonFileStore<T> {
  constructor(
    private readonly filepath: string | (() => string),
    private readonly createDefaultValue: () => T,
  ) {}

  read(): T {
    const filepath = this.path;
    if (!existsSync(filepath)) {
      return this.createDefaultValue();
    }

    try {
      return JSON.parse(readFileSync(filepath, "utf8")) as T;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`配置文件 ${filepath} 不是有效 JSON：${message}`);
    }
  }

  write(value: T): T {
    const filepath = this.path;
    const json = `${JSON.stringify(value, null, 2)}\n`;
    const tempPath = `${filepath}.${createId("tmp")}.tmp`;
    writeFileSync(tempPath, json, "utf8");
    renameSync(tempPath, filepath);
    return value;
  }

  update(updater: (_current: T) => T): T {
    const next = updater(this.read());
    return this.write(next);
  }

  get path() {
    return typeof this.filepath === "function" ? this.filepath() : this.filepath;
  }
}

export function createJsonFileStore<T>(
  filepath: string | (() => string),
  createDefaultValue: () => T,
) {
  return new JsonFileStore(filepath, createDefaultValue);
}

export function ensureJsonFileParentDir(filepath: string) {
  return dirname(filepath);
}
