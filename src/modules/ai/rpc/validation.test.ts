import { expect, test } from "bun:test";

import { validateConnectionApiKey, validateConnectionBaseUrl } from "./index";

test("new connections require an api key", () => {
  expect(() => validateConnectionApiKey({ apiKey: null })).toThrow("请填写 API Key。");
});

test("existing connections with no stored api key must provide one on update", () => {
  expect(() =>
    validateConnectionApiKey({
      apiKey: null,
      existingApiKey: null,
    }),
  ).toThrow("请填写 API Key。");
});

test("existing connections may keep their current api key without resubmitting it", () => {
  expect(() =>
    validateConnectionApiKey({
      apiKey: null,
      existingApiKey: "sk-existing",
    }),
  ).not.toThrow();
});

test("azure connections require either base url or resource name", () => {
  expect(() =>
    validateConnectionBaseUrl({
      sdkPackage: "@ai-sdk/azure",
      baseUrl: null,
      config: {},
    }),
  ).toThrow("Azure 连接需要填写 Base URL 或 Resource Name。");
});

test("azure connections accept resource name without base url", () => {
  expect(() =>
    validateConnectionBaseUrl({
      sdkPackage: "@ai-sdk/azure",
      baseUrl: null,
      config: {
        azure: {
          resourceName: "azure-demo",
        },
      },
    }),
  ).not.toThrow();
});
