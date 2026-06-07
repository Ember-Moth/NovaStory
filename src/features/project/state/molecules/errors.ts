import { molecule } from "bunshi/react";
import { atom } from "jotai";

import { ProjectScope } from "../scopes";

export const ErrorsMolecule = molecule((_, getScope) => {
  getScope(ProjectScope);

  return {
    contentErrorAtom: atom<string | null>(null),
    timelineErrorAtom: atom<string | null>(null),
    auxErrorAtom: atom<string | null>(null),
  };
});
