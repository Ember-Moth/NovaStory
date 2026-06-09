import { molecule } from "bunshi/react";
import { atom } from "jotai";

import { ProjectScope } from "../scopes";

export const SelectionMolecule = molecule((_, getScope) => {
  getScope(ProjectScope);

  return {
    activeContentNodeIdAtom: atom<string | null>(null),
    activeAuxNodeIdAtom: atom<string | null>(null),
    pendingContentNodeIdAtom: atom<string | null>(null),
    pendingAuxNodeIdAtom: atom<string | null>(null),
    shouldAutoSelectContentAtom: atom(false),
    activeTimelinePointIdAtom: atom<string | null>(null),
    expandedContentIdsAtom: atom<Set<string>>(new Set<string>()),
    expandedAuxIdsAtom: atom<Set<string>>(new Set<string>()),
  };
});
