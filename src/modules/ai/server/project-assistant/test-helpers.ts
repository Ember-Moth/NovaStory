import { setupMockDatabase } from "@/test/mock-db";
import { PROJECT_ASSISTANT_MAX_STEPS } from "@/modules/ai/domain/types";

setupMockDatabase();

export const { db, schema } = await import("@/db");
export const logs = await import("@/modules/ai/domain/logs");
export const { createDefaultWorkspace } = await import("@/modules/workspace/domain");
export const workspaceDomain = await import("@/modules/workspace/domain");
export const { createProjectAssistantService } = await import("./index");
export const userConfig = await import("@/modules/ai/domain/user-config");

export function createMockStream({
  chunks,
  text,
  finishReason,
  usage,
  steps,
}: {
  chunks: Array<Record<string, unknown>>;
  text: string;
  finishReason: string;
  usage: unknown;
  steps: Array<Record<string, unknown>>;
}) {
  return () => ({
    chunks: (async function* () {
      for (const chunk of chunks) {
        yield chunk;
      }
    })(),
    text: Promise.resolve(text),
    finishReason: Promise.resolve(finishReason),
    usage: Promise.resolve(usage),
    steps: Promise.resolve(steps),
  });
}

export function createDeferred<T>() {
  let resolve!: (_value: T | PromiseLike<T>) => void;
  let reject!: (_reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export function seedProject(projectId: string) {
  db.insert(schema.projects)
    .values({
      id: projectId,
      name: `Project ${projectId}`,
      description: null,
    })
    .run();
}

export function seedCustomConnection({
  connectionId,
  modelId,
  modelRowId,
  apiKey = "sk-test",
  supportsToolUse = false,
}: {
  connectionId: string;
  modelId: string;
  modelRowId: string;
  apiKey?: string | null;
  supportsToolUse?: boolean;
}) {
  const timestamp = Date.now();
  userConfig.insertAiConnectionToConfig({
    id: connectionId,
    kind: "custom",
    name: "Primary Connection",
    sdkPackage: "@ai-sdk/openai-compatible",
    catalogProviderId: null,
    baseUrl: "https://example.test/v1",
    apiKey,
    configJson: "{}",
    isEnabled: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  userConfig.insertCustomModelToConfig({
    id: modelRowId,
    connectionId,
    modelId,
    displayName: "Story Model",
    contextWindow: null,
    maxOutputTokens: null,
    supportsVision: false,
    supportsReasoning: true,
    supportsToolUse,
    supportsTemperature: false,
    inputPricePer1m: null,
    outputPricePer1m: null,
    isEnabled: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  return {
    selection: {
      connectionId,
      modelId: `custom:${modelRowId}`,
    },
  };
}

export function createStepLimitMockStream({
  modelId,
  finalFinishReason = "tool-calls",
}: {
  modelId: string;
  finalFinishReason?: string;
}) {
  return createMockStream({
    chunks: Array.from({ length: PROJECT_ASSISTANT_MAX_STEPS }, (_, index) => [
      { type: "start-step", stepNumber: index },
      { type: "text-delta", stepNumber: index, delta: `step ${index}` },
      {
        type: "finish-step",
        stepNumber: index,
        finishReason: index === PROJECT_ASSISTANT_MAX_STEPS - 1 ? finalFinishReason : "tool-calls",
        usage: { totalTokens: 1 },
      },
    ]).flat(),
    text: "step limited",
    usage: { totalTokens: PROJECT_ASSISTANT_MAX_STEPS },
    finishReason: finalFinishReason,
    steps: Array.from({ length: PROJECT_ASSISTANT_MAX_STEPS }, (_, index) => ({
      stepNumber: index,
      preparedMessages: [],
      model: { provider: "openai", modelId },
      finishReason: index === PROJECT_ASSISTANT_MAX_STEPS - 1 ? finalFinishReason : "tool-calls",
      rawFinishReason: index === PROJECT_ASSISTANT_MAX_STEPS - 1 ? finalFinishReason : "tool_calls",
      usage: { totalTokens: 1 },
      request: { body: { step: index } },
      response: {
        body: { id: `resp_limit_${index}` },
        messages: [
          {
            role: "assistant",
            content: [{ type: "text", text: `step ${index}` }],
          },
        ],
      },
      providerMetadata: {},
      toolCalls: [],
      toolResults: [],
    })),
  });
}

export function seedOpenAiConnection({
  connectionId,
  modelId,
  modelRowId,
  apiKey = "sk-test",
  supportsReasoning = true,
  supportsToolUse = false,
}: {
  connectionId: string;
  modelId: string;
  modelRowId: string;
  apiKey?: string | null;
  supportsReasoning?: boolean;
  supportsToolUse?: boolean;
}) {
  const timestamp = Date.now();
  userConfig.insertAiConnectionToConfig({
    id: connectionId,
    kind: "custom",
    name: "OpenAI Connection",
    sdkPackage: "@ai-sdk/openai",
    catalogProviderId: null,
    baseUrl: null,
    apiKey,
    configJson: "{}",
    isEnabled: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  userConfig.insertCustomModelToConfig({
    id: modelRowId,
    connectionId,
    modelId,
    displayName: "Reasoning Model",
    contextWindow: null,
    maxOutputTokens: null,
    supportsVision: false,
    supportsReasoning,
    supportsToolUse,
    supportsTemperature: false,
    inputPricePer1m: null,
    outputPricePer1m: null,
    isEnabled: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  return {
    selection: {
      connectionId,
      modelId: `custom:${modelRowId}`,
    },
  };
}
