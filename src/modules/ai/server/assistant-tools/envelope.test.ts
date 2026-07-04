import { expect, test } from "vitest";

import { withEnvelope } from "./envelope";

test("withEnvelope catches synchronous exceptions", () => {
  expect(
    withEnvelope(() => {
      throw new Error("sync failed");
    }),
  ).toEqual({
    ok: false,
    error: "sync failed",
  });
});

test("withEnvelope catches asynchronous rejections", async () => {
  await expect(
    withEnvelope(async () => {
      throw new Error("async failed");
    }),
  ).resolves.toEqual({
    ok: false,
    error: "async failed",
  });
});
