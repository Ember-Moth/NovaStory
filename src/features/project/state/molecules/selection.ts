import { molecule } from "bunshi/react";
import { atom } from "jotai";

import { ProjectScope } from "../scopes";

export const SelectionMolecule = molecule((_, getScope) => {
  getScope(ProjectScope);

  return {
    activeContentNodeIdAtom: atom<string | null>(null),
    activeAuxNodeIdAtom: atom<string | null>(null),
    shouldAutoSelectContentAtom: atom(true),
    activeTimelinePointIdAtom: atom<string | null>(null),
    expandedContentIdsAtom: atom<Set<string>>(new Set<string>()),
    expandedAuxIdsAtom: atom<Set<string>>(new Set<string>()),
  };
});
