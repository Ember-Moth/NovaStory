import {
  archiveThread,
  createThread,
  getNodeCandidates,
  listThreads,
  PROJECT_ASSISTANT_AGENT_PROFILE,
  renameThread,
  resolveActiveThread,
  selectActiveTip,
  setActiveThread,
  getThreadView,
} from "@/modules/ai/domain/logs/threads";
import { getRunTrace, listChildRuns, markRunCancelled } from "@/modules/ai/domain/logs/runs";
import type {
  AgentRunTraceView,
  AgentRunView,
  AgentThreadNodeView,
  AgentThreadStateView,
  AgentThreadView,
  AssistantMentionInput,
  ProjectAssistantContextSnapshot,
  ProjectAssistantToolName,
} from "@/modules/ai/domain/types";
import { getAiAssistantModelSelection } from "@/modules/config/domain/ai-assistant-model-selection";
import { invariant } from "@/shared/lib/domain";

import { BufferedEventRelay, executeProjectAssistantRun } from "./execution";
import {
  buildContinueRun,
  buildEditRun,
  buildRetryRun,
  buildSendRun,
  buildSubmitToolInputRun,
} from "./prepared-runs";
import { defaultStreamAssistantText } from "./streaming";
import type { AskUserAnswer } from "../assistant-tools/ask-user";
import type {
  ActiveExecutionHandle,
  PreparedProjectAssistantRun,
  ProjectAssistantDependencies,
} from "./types-internal";

export interface ProjectAssistantStateView extends AgentThreadStateView {}

export interface ProjectAssistantSendResult {
  thread: AgentThreadView;
  userNode: AgentThreadNodeView;
  assistantNode: AgentThreadNodeView | null;
  run: AgentRunView;
  state: AgentThreadStateView;
}

export interface ProjectAssistantRetryResult {
  thread: AgentThreadView;
  assistantNode: AgentThreadNodeView | null;
  run: AgentRunView;
  state: AgentThreadStateView;
}

export interface ProjectAssistantEditResult {
  thread: AgentThreadView;
  replacementNode: AgentThreadNodeView;
  assistantNode: AgentThreadNodeView | null;
  run: AgentRunView;
  state: AgentThreadStateView;
}

export interface ProjectAssistantContinueResult {
  thread: AgentThreadView;
  assistantNode: AgentThreadNodeView | null;
  run: AgentRunView;
  parentRun: AgentRunView;
  state: AgentThreadStateView;
}

export interface ProjectAssistantSubmitToolInputResult {
  thread: AgentThreadView;
  toolNode: AgentThreadNodeView;
  assistantNode: AgentThreadNodeView | null;
  run: AgentRunView;
  state: AgentThreadStateView;
}

export interface ProjectAssistantOverview {
  activeThreadId: string | null;
  threads: AgentThreadView[];
  state: AgentThreadStateView;
}

export function createProjectAssistantService(
  dependencies: Partial<ProjectAssistantDependencies> = {},
) {
  const streamAssistantTextImpl = dependencies.streamAssistantText ?? defaultStreamAssistantText;
  const readStoredSelection = dependencies.readStoredSelection ?? getAiAssistantModelSelection;
  const activeExecutions = new Map<string, ActiveExecutionHandle>();

  function startExecution<TResult>(prepared: PreparedProjectAssistantRun<TResult>) {
    let resolveFinal!: (_value: TResult) => void;
    let rejectFinal!: (_reason?: unknown) => void;
    const finalResult = new Promise<TResult>((resolve, reject) => {
      resolveFinal = resolve;
      rejectFinal = reject;
    });
    const relay = new BufferedEventRelay(prepared.initialResult, finalResult);
    const abortController = new AbortController();
    activeExecutions.set(prepared.run.id, {
      abortController,
    });
    relay.emit(prepared.runStartedEvent);
    void executeProjectAssistantRun({
      prepared,
      streamAssistantText: streamAssistantTextImpl,
      relay,
      abortSignal: abortController.signal,
    })
      .then(resolveFinal, rejectFinal)
      .finally(() => {
        activeExecutions.delete(prepared.run.id);
      });
    return relay;
  }

  return {
    getProjectAssistantState(projectId: string): ProjectAssistantOverview {
      const threads = listThreads(projectId, {
        agentProfile: PROJECT_ASSISTANT_AGENT_PROFILE,
      });
      const activeThread = resolveActiveThread(projectId, PROJECT_ASSISTANT_AGENT_PROFILE);
      return {
        activeThreadId: activeThread?.id ?? null,
        threads,
        state: activeThread
          ? getThreadView(projectId, activeThread.id)
          : { thread: null, activePath: [], candidateGroups: [], latestRuns: [], runSummaries: [] },
      };
    },

    createProjectAssistantThread(projectId: string) {
      return createThread({
        projectId,
        agentProfile: PROJECT_ASSISTANT_AGENT_PROFILE,
      });
    },

    setProjectAssistantActiveThread(projectId: string, threadId: string) {
      return setActiveThread(projectId, threadId);
    },

    renameProjectAssistantThread(projectId: string, threadId: string, title: string) {
      return renameThread(projectId, threadId, title);
    },

    archiveProjectAssistantThread(projectId: string, threadId: string, archived: boolean) {
      return archiveThread(projectId, threadId, archived);
    },

    getThreadView(projectId: string, threadId: string) {
      return getThreadView(projectId, threadId);
    },

    getRunTrace(projectId: string, runId: string): AgentRunTraceView {
      return getRunTrace(projectId, runId);
    },

    getNodeCandidates(projectId: string, parentNodeId: string) {
      return getNodeCandidates(projectId, parentNodeId);
    },

    getChildRuns(projectId: string, runId: string) {
      return listChildRuns(projectId, runId);
    },

    selectThreadTip(projectId: string, threadId: string, tipNodeId: string) {
      return selectActiveTip(projectId, threadId, tipNodeId);
    },

    sendProjectAssistantMessageStream({
      projectId,
      threadId,
      text,
      mentions,
      context,
      activeTools,
    }: {
      projectId: string;
      threadId: string;
      text: string;
      mentions?: readonly AssistantMentionInput[] | null;
      context?: ProjectAssistantContextSnapshot | null;
      activeTools?: readonly ProjectAssistantToolName[] | null;
    }) {
      return startExecution(
        buildSendRun({
          projectId,
          threadId,
          text,
          mentions,
          context,
          activeTools,
          readStoredSelection,
        }),
      );
    },

    retryProjectAssistantMessageStream({
      projectId,
      threadId,
      triggerNodeId,
      context,
      activeTools,
    }: {
      projectId: string;
      threadId: string;
      triggerNodeId: string;
      context?: ProjectAssistantContextSnapshot | null;
      activeTools?: readonly ProjectAssistantToolName[] | null;
    }) {
      return startExecution(
        buildRetryRun({
          projectId,
          threadId,
          triggerNodeId,
          context,
          activeTools,
          readStoredSelection,
        }),
      );
    },

    editProjectAssistantMessageStream({
      projectId,
      threadId,
      nodeId,
      text,
      mentions,
      context,
      activeTools,
    }: {
      projectId: string;
      threadId: string;
      nodeId: string;
      text: string;
      mentions?: readonly AssistantMentionInput[] | null;
      context?: ProjectAssistantContextSnapshot | null;
      activeTools?: readonly ProjectAssistantToolName[] | null;
    }) {
      return startExecution(
        buildEditRun({
          projectId,
          threadId,
          nodeId,
          text,
          mentions,
          context,
          activeTools,
          readStoredSelection,
        }),
      );
    },

    continueProjectAssistantRunStream({
      projectId,
      threadId,
      runId,
    }: {
      projectId: string;
      threadId: string;
      runId: string;
    }) {
      return startExecution(
        buildContinueRun({
          projectId,
          threadId,
          runId,
        }),
      );
    },

    submitProjectAssistantToolInputStream({
      projectId,
      threadId,
      runId,
      toolCallId,
      answers,
    }: {
      projectId: string;
      threadId: string;
      runId: string;
      toolCallId: string;
      answers: readonly AskUserAnswer[];
    }) {
      return startExecution(
        buildSubmitToolInputRun({
          projectId,
          threadId,
          runId,
          toolCallId,
          answers,
        }),
      );
    },

    cancelProjectAssistantRun({
      projectId,
      threadId,
      runId,
    }: {
      projectId: string;
      threadId: string;
      runId: string;
    }) {
      const threadView = getThreadView(projectId, threadId);
      const thread = threadView.thread;
      invariant(thread, "未找到当前会话。");
      invariant(thread.projectId === projectId, "AI 会话不属于当前项目。");

      const trace = getRunTrace(projectId, runId);
      invariant(trace.run.threadId === thread.id, "run 不属于当前会话。");
      invariant(
        trace.run.status === "running" ||
          trace.run.status === "queued" ||
          trace.run.status === "waiting_for_input",
        "run 当前不可取消。",
      );

      if (trace.run.status === "waiting_for_input") {
        markRunCancelled(projectId, runId);
        return {
          runId,
        };
      }

      const activeExecution = activeExecutions.get(runId);
      invariant(activeExecution, "run 当前没有活动执行。");
      activeExecution.abortController.abort(new Error("run cancelled"));

      return {
        runId,
      };
    },

    async sendProjectAssistantMessage(args: {
      projectId: string;
      threadId: string;
      text: string;
      mentions?: readonly AssistantMentionInput[] | null;
      context?: ProjectAssistantContextSnapshot | null;
      activeTools?: readonly ProjectAssistantToolName[] | null;
    }): Promise<ProjectAssistantSendResult> {
      return this.sendProjectAssistantMessageStream(args).finalResult;
    },

    async retryProjectAssistantMessage(args: {
      projectId: string;
      threadId: string;
      triggerNodeId: string;
      context?: ProjectAssistantContextSnapshot | null;
      activeTools?: readonly ProjectAssistantToolName[] | null;
    }): Promise<ProjectAssistantRetryResult> {
      return this.retryProjectAssistantMessageStream(args).finalResult;
    },

    async editProjectAssistantMessage(args: {
      projectId: string;
      threadId: string;
      nodeId: string;
      text: string;
      mentions?: readonly AssistantMentionInput[] | null;
      context?: ProjectAssistantContextSnapshot | null;
      activeTools?: readonly ProjectAssistantToolName[] | null;
    }): Promise<ProjectAssistantEditResult> {
      return this.editProjectAssistantMessageStream(args).finalResult;
    },

    async continueProjectAssistantRun(args: {
      projectId: string;
      threadId: string;
      runId: string;
    }): Promise<ProjectAssistantContinueResult> {
      return this.continueProjectAssistantRunStream(args).finalResult;
    },

    async submitProjectAssistantToolInput(args: {
      projectId: string;
      threadId: string;
      runId: string;
      toolCallId: string;
      answers: readonly AskUserAnswer[];
    }): Promise<ProjectAssistantSubmitToolInputResult> {
      return this.submitProjectAssistantToolInputStream(args).finalResult;
    },
  };
}

export type ProjectAssistantService = ReturnType<typeof createProjectAssistantService>;

let activeProjectAssistantService: ProjectAssistantService = createProjectAssistantService();

export function getProjectAssistantService() {
  return activeProjectAssistantService;
}

export function setProjectAssistantServiceForTests(service: ProjectAssistantService) {
  activeProjectAssistantService = service;
}
