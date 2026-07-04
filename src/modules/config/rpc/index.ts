import {
  type AiAssistantModelSelection,
  getAiAssistantModelSelection as readAiAssistantModelSelection,
  setAiAssistantModelSelection as writeAiAssistantModelSelection,
} from "@/modules/config/domain/ai-assistant-model-selection";
import {
  getAiAssistantMaxSteps as readAiAssistantMaxSteps,
  setAiAssistantMaxSteps as writeAiAssistantMaxSteps,
} from "@/modules/config/domain/ai-assistant-options";
import { rpcTags } from "@/rpc/tags";

export async function getAiAssistantModelSelection(): Promise<{
  data: AiAssistantModelSelection | null;
  watch?: unknown[];
}> {
  const data = await readAiAssistantModelSelection();
  const watch = [rpcTags.aiAssistantModelSelection()];
  return { data, watch };
}

export async function setAiAssistantModelSelection(
  input: AiAssistantModelSelection | null | undefined,
): Promise<{ data: AiAssistantModelSelection | null; invalidate?: unknown[] }> {
  const data = await writeAiAssistantModelSelection(input ?? null);
  const invalidate = [rpcTags.aiAssistantModelSelection()];
  return { data, invalidate };
}

export async function getAiAssistantMaxSteps(): Promise<{
  data: number;
  watch?: unknown[];
}> {
  const data = await readAiAssistantMaxSteps();
  const watch = [rpcTags.aiAssistantOptions()];
  return { data, watch };
}

export async function setAiAssistantMaxSteps(
  input: number | null | undefined,
): Promise<{ data: number; invalidate?: unknown[] }> {
  const data = await writeAiAssistantMaxSteps(input ?? null);
  const invalidate = [rpcTags.aiAssistantOptions()];
  return { data, invalidate };
}
