import { expect, test } from "bun:test";
import { writeFileSync } from "node:fs";

import { getConfigFilePath } from "@/shared/lib/storage-paths";
import {
  deleteGlobalConfig,
  getGlobalConfig,
  listGlobalConfigOptions,
  setGlobalConfig,
} from "./global-config";

test("setGlobalConfig stores and getGlobalConfig reads JSON values", () => {
  const fallback = {
    autosave: false,
    recentLimit: 0,
    tags: [] as string[],
  };

  setGlobalConfig("editor.preferences", {
    autosave: true,
    recentLimit: 8,
    tags: ["draft", "review"],
  });

  expect(getGlobalConfig("editor.preferences", fallback)).toEqual({
    autosave: true,
    recentLimit: 8,
    tags: ["draft", "review"],
  });
});

test("setGlobalConfig overwrites existing keys with a single row", () => {
  setGlobalConfig("feature.enabled", false);
  setGlobalConfig("feature.enabled", true);

  expect(getGlobalConfig("feature.enabled", false)).toBe(true);
  expect(listGlobalConfigOptions()).toHaveLength(1);
});

test("getGlobalConfig returns fallback for missing and invalid values", () => {
  expect(getGlobalConfig("missing.option", "fallback")).toBe("fallback");
  expect(getGlobalConfig("   ", "fallback")).toBe("fallback");

  writeFileSync(
    getConfigFilePath("global.json"),
    JSON.stringify({
      options: [
        {
          key: "broken.option",
          valueJson: "{not-json",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    }),
    "utf8",
  );

  expect(getGlobalConfig("broken.option", { ok: false })).toEqual({ ok: false });
});

test("deleteGlobalConfig removes a stored option", () => {
  setGlobalConfig("delete.me", { value: "before" });
  deleteGlobalConfig("delete.me");

  expect(getGlobalConfig("delete.me", { value: "after" })).toEqual({ value: "after" });
});

test("empty keys throw for writes and deletes", () => {
  expect(() => setGlobalConfig(" ", true)).toThrow("Global config key must not be empty");
  expect(() => deleteGlobalConfig("\t")).toThrow("Global config key must not be empty");
});

test("setGlobalConfig trims keys before storage", () => {
  setGlobalConfig("  trimmed.option  ", null);

  const row = listGlobalConfigOptions().find((option) => option.key === "trimmed.option");

  expect(row?.valueJson).toBe("null");
});

test("invalid global config file JSON throws without overwriting the file", () => {
  writeFileSync(getConfigFilePath("global.json"), "{not-json", "utf8");

  expect(() => listGlobalConfigOptions()).toThrow("不是有效 JSON");
  expect(() => setGlobalConfig("after.invalid", true)).toThrow("不是有效 JSON");
});
