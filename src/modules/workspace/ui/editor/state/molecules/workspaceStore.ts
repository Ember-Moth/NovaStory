import { molecule, useMolecule } from "bunshi/react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

import type { ActionError } from "@/modules/workspace/ui/editor/model/action-error";

import { ProjectScope } from "../scopes";

export type Updater<T> = T | ((current: T) => T);

function resolveNext<T>(updater: Updater<T>, current: T): T {
  return typeof updater === "function" ? (updater as (current: T) => T)(current) : updater;
}

type WorkspaceStateData = {
  // selection
  activeContentNodeId: string | null;
  activeAuxNodeId: string | null;
  pendingContentNodeId: string | null;
  pendingAuxNodeId: string | null;
  shouldAutoSelectContent: boolean;
  activeTimelinePointId: string | null;
  expandedContentIds: Set<string>;
  expandedAuxIds: Set<string>;
  // editor buffers
  drafts: Record<string, string>;
  committedBodies: Record<string, string>;
  pendingSaveCounts: Record<string, number>;
  saveErrors: Record<string, string>;
  // action errors
  contentError: ActionError;
  timelineError: ActionError;
  auxError: ActionError;
  pageErrorDismissed: boolean;
};

type WorkspaceStateActions = {
  setActiveContentNodeId: (updater: Updater<string | null>) => void;
  setActiveAuxNodeId: (updater: Updater<string | null>) => void;
  setPendingContentNodeId: (updater: Updater<string | null>) => void;
  setPendingAuxNodeId: (updater: Updater<string | null>) => void;
  setShouldAutoSelectContent: (updater: Updater<boolean>) => void;
  setActiveTimelinePointId: (updater: Updater<string | null>) => void;
  setExpandedContentIds: (updater: Updater<Set<string>>) => void;
  setExpandedAuxIds: (updater: Updater<Set<string>>) => void;
  setDrafts: (updater: Updater<Record<string, string>>) => void;
  setCommittedBodies: (updater: Updater<Record<string, string>>) => void;
  setPendingSaveCounts: (updater: Updater<Record<string, number>>) => void;
  setSaveErrors: (updater: Updater<Record<string, string>>) => void;
  setContentError: (updater: Updater<ActionError>) => void;
  setTimelineError: (updater: Updater<ActionError>) => void;
  setAuxError: (updater: Updater<ActionError>) => void;
  setPageErrorDismissed: (updater: Updater<boolean>) => void;
};

export type WorkspaceState = WorkspaceStateData & WorkspaceStateActions;
export type WorkspaceStore = ReturnType<typeof createWorkspaceStore>;

export function createWorkspaceStore() {
  return createStore<WorkspaceState>()((set) => {
    const field =
      <K extends keyof WorkspaceStateData>(key: K) =>
      (updater: Updater<WorkspaceStateData[K]>) =>
        set(
          (state) => ({ [key]: resolveNext(updater, state[key]) }) as Pick<WorkspaceStateData, K>,
        );

    return {
      activeContentNodeId: null,
      activeAuxNodeId: null,
      pendingContentNodeId: null,
      pendingAuxNodeId: null,
      shouldAutoSelectContent: false,
      activeTimelinePointId: null,
      expandedContentIds: new Set<string>(),
      expandedAuxIds: new Set<string>(),
      drafts: {},
      committedBodies: {},
      pendingSaveCounts: {},
      saveErrors: {},
      contentError: null,
      timelineError: null,
      auxError: null,
      pageErrorDismissed: false,
      setActiveContentNodeId: field("activeContentNodeId"),
      setActiveAuxNodeId: field("activeAuxNodeId"),
      setPendingContentNodeId: field("pendingContentNodeId"),
      setPendingAuxNodeId: field("pendingAuxNodeId"),
      setShouldAutoSelectContent: field("shouldAutoSelectContent"),
      setActiveTimelinePointId: field("activeTimelinePointId"),
      setExpandedContentIds: field("expandedContentIds"),
      setExpandedAuxIds: field("expandedAuxIds"),
      setDrafts: field("drafts"),
      setCommittedBodies: field("committedBodies"),
      setPendingSaveCounts: field("pendingSaveCounts"),
      setSaveErrors: field("saveErrors"),
      setContentError: field("contentError"),
      setTimelineError: field("timelineError"),
      setAuxError: field("auxError"),
      setPageErrorDismissed: field("pageErrorDismissed"),
    };
  });
}

export const WorkspaceStateMolecule = molecule((_, getScope) => {
  getScope(ProjectScope);
  return createWorkspaceStore();
});

/** 返回当前 ProjectScope 下的 workspace 状态 store 实例（用于命令式读取与稳定的 setter）。 */
export function useWorkspaceStoreApi(): WorkspaceStore {
  return useMolecule(WorkspaceStateMolecule);
}

/** 以 selector 订阅当前 ProjectScope 下的 workspace 状态。 */
export function useWorkspaceState<T>(selector: (state: WorkspaceState) => T): T {
  return useStore(useMolecule(WorkspaceStateMolecule), selector);
}
