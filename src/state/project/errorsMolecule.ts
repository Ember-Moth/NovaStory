import { molecule } from "bunshi/react";
import { atom } from "jotai";

import { ProjectScope } from "@/state/scopes";

export const ErrorsMolecule = molecule((_, getScope) => {
  getScope(ProjectScope);

  return {
    contentErrorAtom: atom<string | null>(null),
    timelineErrorAtom: atom<string | null>(null),
  };
});
