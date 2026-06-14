import { stepCountIs, streamText } from "ai";

import { getAiAssistantMaxSteps } from "@/modules/config/domain/ai-assistant-options";

import { createAssistantTools } from "../assistant-tools";
import { createLanguageModelForConnection } from "../provider-factories";
import type {
  GeneratedAssistantChunk,
  GeneratedAssistantStep,
  StreamAssistantTextInput,
  StreamAssistantTextResult,
} from "./types-internal";

export function defaultStreamAssistantText({
  projectId,
  connection,
  modelId,
  system,
  activeTools,
  runtimeContext,
  messages,
  providerOptions,
  abortSignal,
}: StreamAssistantTextInput): StreamAssistantTextResult {
  const model = createLanguageModelForConnection({ connection, modelId });
  const preparedMessagesByStep = new Map<number, StreamAssistantTextInput["messages"]>();
  const tools = createAssistantTools({ projectId, runtimeContext });
  const maxSteps = getAiAssistantMaxSteps();
  const result = streamText({
    model,
    messages,
    ...(system == null ? {} : { system }),
    ...(providerOptions == null ? {} : { providerOptions }),
    ...(abortSignal == null ? {} : { abortSignal }),
    ...(activeTools.length > 0 ? { tools, activeTools: [...activeTools] } : {}),
    stopWhen: stepCountIs(maxSteps),
    prepareStep: ({ messages: stepMessages, stepNumber }) => {
      preparedMessagesByStep.set(stepNumber, stepMessages);
      return undefined;
    },
  });

  async function* chunks(): AsyncIterable<GeneratedAssistantChunk> {
    let currentStepNumber = -1;
    let hasImplicitCurrentStep = false;

    function getCurrentStepNumber() {
      if (currentStepNumber < 0) {
        currentStepNumber = 0;
        hasImplicitCurrentStep = true;
      }
      return currentStepNumber;
    }

    for await (const rawPart of result.fullStream as AsyncIterable<Record<string, unknown>>) {
      const type = Reflect.get(rawPart, "type");
      if (type === "start-step") {
        if (hasImplicitCurrentStep) {
          hasImplicitCurrentStep = false;
        } else {
          currentStepNumber += 1;
        }
        yield {
          type: "start-step",
          stepNumber: currentStepNumber,
        };
        continue;
      }

      if (type === "text-delta") {
        yield {
          type: "text-delta",
          stepNumber: currentStepNumber,
          delta: String(Reflect.get(rawPart, "text") ?? ""),
        };
        continue;
      }

      if (type === "reasoning-start") {
        yield {
          type: "reasoning-start",
          stepNumber: currentStepNumber,
          id: String(Reflect.get(rawPart, "id") ?? ""),
          providerMetadata: Reflect.get(rawPart, "providerMetadata") ?? null,
        };
        continue;
      }

      if (type === "reasoning-delta") {
        yield {
          type: "reasoning-delta",
          stepNumber: currentStepNumber,
          id: String(Reflect.get(rawPart, "id") ?? ""),
          delta: String(Reflect.get(rawPart, "text") ?? Reflect.get(rawPart, "delta") ?? ""),
          providerMetadata: Reflect.get(rawPart, "providerMetadata") ?? null,
        };
        continue;
      }

      if (type === "reasoning-end") {
        yield {
          type: "reasoning-end",
          stepNumber: currentStepNumber,
          id: String(Reflect.get(rawPart, "id") ?? ""),
          providerMetadata: Reflect.get(rawPart, "providerMetadata") ?? null,
        };
        continue;
      }

      if (type === "tool-input-start") {
        yield {
          type: "tool-input-start",
          stepNumber: getCurrentStepNumber(),
          toolCallId: String(Reflect.get(rawPart, "toolCallId") ?? ""),
          toolName: String(Reflect.get(rawPart, "toolName") ?? "tool"),
        };
        continue;
      }

      if (type === "tool-input-delta") {
        yield {
          type: "tool-input-delta",
          stepNumber: getCurrentStepNumber(),
          toolCallId: String(Reflect.get(rawPart, "toolCallId") ?? ""),
          inputTextDelta: String(Reflect.get(rawPart, "inputTextDelta") ?? ""),
        };
        continue;
      }

      if (type === "tool-call") {
        yield {
          type: "tool-call",
          stepNumber: getCurrentStepNumber(),
          toolCall: rawPart,
        };
        continue;
      }

      if (type === "tool-result" && Reflect.get(rawPart, "preliminary") !== true) {
        yield {
          type: "tool-result",
          stepNumber: getCurrentStepNumber(),
          toolResult: rawPart,
        };
        continue;
      }

      if (type === "tool-approval-request") {
        const toolCall = Reflect.get(rawPart, "toolCall");
        const toolCallId =
          toolCall && typeof toolCall === "object"
            ? Reflect.get(toolCall as Record<string, unknown>, "toolCallId")
            : undefined;
        yield {
          type: "tool-approval-request",
          stepNumber: getCurrentStepNumber(),
          approvalRequest: {
            ...rawPart,
            ...(typeof toolCallId === "string" ? { toolCallId } : {}),
          },
        };
        continue;
      }

      if (type === "finish-step") {
        yield {
          type: "finish-step",
          stepNumber: getCurrentStepNumber(),
          finishReason:
            typeof Reflect.get(rawPart, "finishReason") === "string"
              ? (Reflect.get(rawPart, "finishReason") as string)
              : undefined,
          usage: Reflect.get(rawPart, "usage"),
        };
      }
    }
  }

  return {
    chunks: chunks(),
    text: Promise.resolve(result.text),
    finishReason: Promise.resolve(result.finishReason),
    usage: Promise.resolve(result.totalUsage),
    steps: Promise.resolve(result.steps).then((steps) =>
      steps.map(
        (step): GeneratedAssistantStep => ({
          stepNumber: step.stepNumber,
          preparedMessages: preparedMessagesByStep.get(step.stepNumber) ?? [],
          model: step.model,
          finishReason: step.finishReason,
          rawFinishReason: step.rawFinishReason,
          usage: step.usage,
          request: step.request,
          response: {
            body: step.response.body,
            messages: step.response.messages,
          },
          providerMetadata: step.providerMetadata,
          toolCalls: step.toolCalls as Array<Record<string, unknown>>,
          toolResults: step.toolResults as Array<Record<string, unknown>>,
        }),
      ),
    ),
  };
}
