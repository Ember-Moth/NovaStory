import { atom } from "jotai";

export const lastProjectIdAtom = atom<string | null>(null);
export const lastWorkspaceRouteAtom = atom<{ projectId: string; workspaceId: string } | null>(null);
export const projectBranchSelectionAtom = atom<Record<string, string | null>>({});
