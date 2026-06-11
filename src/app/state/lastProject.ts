import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

export type WorkspaceRouteRef = { projectId: string; workspaceId: string };

type LastProjectState = {
  lastProjectId: string | null;
  lastWorkspaceRoute: WorkspaceRouteRef | null;
  projectBranchSelection: Record<string, string | null>;
};

type LastProjectActions = {
  setLastProjectId: (updater: string | null | ((current: string | null) => string | null)) => void;
  setLastWorkspaceRoute: (
    updater:
      | WorkspaceRouteRef
      | null
      | ((current: WorkspaceRouteRef | null) => WorkspaceRouteRef | null),
  ) => void;
  setProjectBranchSelection: (
    updater:
      | Record<string, string | null>
      | ((current: Record<string, string | null>) => Record<string, string | null>),
  ) => void;
};

type LastProjectStoreState = LastProjectState & LastProjectActions;

function resolveNext<T>(updater: T | ((current: T) => T), current: T) {
  return typeof updater === "function" ? (updater as (current: T) => T)(current) : updater;
}

export function createLastProjectStore() {
  return createStore<LastProjectStoreState>()((set) => ({
    lastProjectId: null,
    lastWorkspaceRoute: null,
    projectBranchSelection: {},
    setLastProjectId: (updater) =>
      set((state) => ({ lastProjectId: resolveNext(updater, state.lastProjectId) })),
    setLastWorkspaceRoute: (updater) =>
      set((state) => ({ lastWorkspaceRoute: resolveNext(updater, state.lastWorkspaceRoute) })),
    setProjectBranchSelection: (updater) =>
      set((state) => ({
        projectBranchSelection: resolveNext(updater, state.projectBranchSelection),
      })),
  }));
}

export const lastProjectStore = createLastProjectStore();

export function useLastProjectStore<T>(selector: (state: LastProjectStoreState) => T): T {
  return useStore(lastProjectStore, selector);
}
