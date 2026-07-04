import { expect, test } from "vitest";

import type { AiResolvedModelView } from "@/modules/ai/domain/types";
import { rpc } from "@/rpc/client";

test("resolved model cache can be replaced for a specific connection", () => {
  const input = { connectionId: "conn_cache_test", includeDisabled: true };
  const models: AiResolvedModelView[] = [
    {
      id: "catalog:model-a",
      connectionId: input.connectionId,
      origin: "catalog",
      sdkPackage: "@ai-sdk/openai",
      modelId: "model-a",
      displayName: "Model A",
      family: null,
      contextWindow: null,
      maxOutputTokens: null,
      supportsVision: false,
      supportsToolUse: false,
      supportsReasoning: false,
      supportsTemperature: true,
      inputPricePer1m: null,
      outputPricePer1m: null,
      isEnabled: true,
      catalogModelId: "catalog_model_a",
      customModelId: null,
      isActive: true,
    },
  ];

  rpc.setQueryData("ai.listResolvedModels", input, models);

  expect(rpc.getQueryData("ai.listResolvedModels", input)).toEqual(models);

  rpc.removeQueryData("ai.listResolvedModels", input);
});
