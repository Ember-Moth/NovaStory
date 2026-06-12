import type { ProjectAssistantContextSnapshot } from "@/modules/ai/domain/types";

export function resolveActiveContentNodeId(
  context: ProjectAssistantContextSnapshot | null | undefined,
  fallbackContentRootId: string | null,
) {
  return context?.activeContentNodeId ?? fallbackContentRootId;
}

export function resolveActiveAuxPath(context: ProjectAssistantContextSnapshot | null | undefined) {
  return context?.activeAuxPath ?? null;
}
