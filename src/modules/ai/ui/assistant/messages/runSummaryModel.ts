import type {
  AgentCandidateGroupView,
  AgentRunSummaryView,
  AgentRunView,
  AgentThreadNodeView,
} from "@/modules/ai/domain/types";
import type { AssistantState } from "../runtime/controllerState";

export function getRunSummaryByDisplayNode(
  summaries: AgentRunSummaryView[],
  displayNodeId: string,
) {
  return summaries.filter((summary) => summary.displayNodeId === displayNodeId);
}

export function getUsageTotalTokens(usage: unknown) {
  if (!usage || typeof usage !== "object") {
    return null;
  }

  const totalTokens = Reflect.get(usage as Record<string, unknown>, "totalTokens");
  if (typeof totalTokens === "number" && Number.isFinite(totalTokens)) {
    return Math.max(0, Math.round(totalTokens));
  }

  const inputTokens = Reflect.get(usage as Record<string, unknown>, "inputTokens");
  const outputTokens = Reflect.get(usage as Record<string, unknown>, "outputTokens");
  if (
    typeof inputTokens === "number" &&
    Number.isFinite(inputTokens) &&
    typeof outputTokens === "number" &&
    Number.isFinite(outputTokens)
  ) {
    return Math.max(0, Math.round(inputTokens + outputTokens));
  }

  return null;
}

export function selectRetryableRun(state: AssistantState | null | undefined): AgentRunView | null {
  const latest = state?.latestRuns[0] ?? null;
  if (!latest || latest.status !== "failed" || !latest.triggerNodeId) {
    return null;
  }
  return latest;
}

export function selectPendingRun(state: AssistantState | null | undefined): AgentRunView | null {
  const latest = state?.latestRuns[0] ?? null;
  if (
    !latest ||
    (latest.status !== "running" &&
      latest.status !== "queued" &&
      latest.status !== "waiting_for_input") ||
    !latest.triggerNodeId
  ) {
    return null;
  }
  return latest;
}

export function canSendAssistantMessage({
  draft,
  mentionCount = 0,
  selectedConnectionId,
  selectedModelId,
  selectionHydrated,
  isBusy,
  hasPendingRun,
}: {
  draft: string;
  mentionCount?: number;
  selectedConnectionId: string;
  selectedModelId: string;
  selectionHydrated: boolean;
  isBusy: boolean;
  hasPendingRun: boolean;
}) {
  return (
    selectionHydrated &&
    selectedConnectionId.length > 0 &&
    selectedModelId.length > 0 &&
    (draft.trim().length > 0 || mentionCount > 0) &&
    !isBusy &&
    !hasPendingRun
  );
}

export function getCandidateGroupForNode(
  candidateGroups: AgentCandidateGroupView[],
  node: AgentThreadNodeView,
) {
  return candidateGroups.find((group) => group.activeNodeId === node.id) ?? null;
}

export function getRunErrorMessage() {
  return "AI 回复失败。";
}
