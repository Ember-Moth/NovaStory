import { mutation, query } from "@codehz/rpc/core";

import {
  type AiAssistantModelSelection,
  getAiAssistantModelSelection as readAiAssistantModelSelection,
  setAiAssistantModelSelection as writeAiAssistantModelSelection,
} from "@/modules/config/domain/ai-assistant-model-selection";
import {
  getAiAssistantMaxSteps as readAiAssistantMaxSteps,
  setAiAssistantMaxSteps as writeAiAssistantMaxSteps,
} from "@/modules/config/domain/ai-assistant-options";
import { type RpcTagList, rpcTags } from "@/rpc/tags";

export const getAiAssistantModelSelection = query<
  void,
  AiAssistantModelSelection | null,
  RpcTagList
>({
  watch: () => [rpcTags.aiAssistantModelSelection()],
  handler: () => readAiAssistantModelSelection(),
});

export const setAiAssistantModelSelection = mutation<
  AiAssistantModelSelection | null | undefined,
  AiAssistantModelSelection | null,
  RpcTagList
>(async (input, ctx) => {
  const selection = writeAiAssistantModelSelection(input ?? null);
  ctx.invalidate(rpcTags.aiAssistantModelSelection());
  return selection;
});

export const getAiAssistantMaxSteps = query<void, number, RpcTagList>({
  watch: () => [rpcTags.aiAssistantOptions()],
  handler: () => readAiAssistantMaxSteps(),
});

export const setAiAssistantMaxSteps = mutation<number | null | undefined, number, RpcTagList>(
  async (input, ctx) => {
    const maxSteps = writeAiAssistantMaxSteps(input ?? null);
    ctx.invalidate(rpcTags.aiAssistantOptions());
    return maxSteps;
  },
);
