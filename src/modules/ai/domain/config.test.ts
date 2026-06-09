import { expect, test } from "bun:test";

import {
  normalizeAiConnectionConfig,
  parseAiConnectionConfig,
  stringifyAiConnectionConfig,
} from "./config";

test("non-azure packages drop azure-only config", () => {
  const config = normalizeAiConnectionConfig({
    sdkPackage: "@ai-sdk/openai",
    config: {
      azure: {
        resourceName: "demo",
        apiVersion: "preview",
        useDeploymentBasedUrls: true,
      },
    },
  });

  expect(config).toEqual({});
  expect(
    stringifyAiConnectionConfig({
      sdkPackage: "@ai-sdk/openai",
      config: {
        azure: {
          resourceName: "demo",
        },
      },
    }),
  ).toBe("{}");
});

test("azure config normalizes blank strings and defaults booleans", () => {
  const config = normalizeAiConnectionConfig({
    sdkPackage: "@ai-sdk/azure",
    config: {
      azure: {
        resourceName: "  azure-demo  ",
        apiVersion: " ",
      },
    },
  });

  expect(config).toEqual({
    azure: {
      resourceName: "azure-demo",
      apiVersion: null,
      useDeploymentBasedUrls: false,
    },
  });
});

test("parseAiConnectionConfig tolerates invalid json", () => {
  expect(parseAiConnectionConfig("{not-json")).toEqual({});
  expect(parseAiConnectionConfig(JSON.stringify({ azure: { resourceName: " demo " } }))).toEqual({
    azure: {
      resourceName: "demo",
      apiVersion: null,
      useDeploymentBasedUrls: false,
    },
  });
});
