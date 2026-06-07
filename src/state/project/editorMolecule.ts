import { molecule } from "bunshi/react";
import { atom } from "jotai";

import { ProjectScope } from "@/state/scopes";

export const EditorMolecule = molecule((_, getScope) => {
  getScope(ProjectScope);

  return {
    draftsAtom: atom<Record<string, string>>({}),
    committedBodiesAtom: atom<Record<string, string>>({}),
    pendingSaveCountsAtom: atom<Record<string, number>>({}),
    saveErrorsAtom: atom<Record<string, string>>({}),
  };
});
