import type { AgentThreadView } from "@/modules/ai/domain/types";
import { rpc } from "@/rpc/client";

import { EMPTY_ASSISTANT_STATE } from "./controllerState";

export function patchAssistantOverviewState({
  projectId,
  thread,
  state,
}: {
  projectId: string;
  thread: AgentThreadView;
  state: typeof EMPTY_ASSISTANT_STATE;
}) {
  const current = rpc.getQueryData("ai.getProjectAssistantState", { projectId });
  if (!current) {
    return;
  }

  rpc.setQueryData(
    "ai.getProjectAssistantState",
    { projectId },
    {
      activeThreadId: thread.id,
      threads: current.threads.some((entry) => entry.id === thread.id)
        ? current.threads.map((entry) => (entry.id === thread.id ? thread : entry))
        : [thread, ...current.threads],
      state,
    },
  );
}
