import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { setupMockDatabase } from "@/test/mock-db";

setupMockDatabase();

const { db, schema } = await import("@/db");
const { deleteGlobalConfig, getGlobalConfig, listGlobalConfigOptions, setGlobalConfig } =
  await import("./global-config");

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

  db.insert(schema.globalConfigOptions)
    .values({
      key: "broken.option",
      valueJson: "{not-json",
    })
    .run();

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

  const row = db
    .select()
    .from(schema.globalConfigOptions)
    .where(eq(schema.globalConfigOptions.key, "trimmed.option"))
    .get();

  expect(row?.valueJson).toBe("null");
});
