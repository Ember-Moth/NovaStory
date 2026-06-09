import { molecule } from "bunshi/react";
import { atom } from "jotai";

import type { ActionError } from "@/modules/workspace/ui/editor/model/action-error";

import { ProjectScope } from "../scopes";

export const ErrorsMolecule = molecule((_, getScope) => {
  getScope(ProjectScope);

  return {
    contentErrorAtom: atom<ActionError>(null),
    timelineErrorAtom: atom<ActionError>(null),
    auxErrorAtom: atom<ActionError>(null),
    pageErrorDismissedAtom: atom<boolean>(false),
  };
});
