import type {
  AgentThreadStateView,
  AgentThreadView,
  AssistantMentionInput,
} from "@/modules/ai/domain/types";

export type AssistantState = AgentThreadStateView;

export type EditingThreadState = {
  threadId: string;
  title: string;
};

export type PendingAssistantAction =
  | {
      kind: "send";
      text: string;
      mentions: AssistantMentionInput[];
    }
  | {
      kind: "retry";
      triggerNodeId: string;
    }
  | {
      kind: "continue";
      runId: string;
    }
  | {
      kind: "tool-input";
      runId: string;
      toolCallId: string;
    };

export const EMPTY_ASSISTANT_STATE: AssistantState = {
  thread: null,
  activePath: [],
  candidateGroups: [],
  latestRuns: [],
  runSummaries: [],
};

export const EMPTY_THREADS: AgentThreadView[] = [];
