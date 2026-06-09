import { molecule } from "bunshi/react";
import { atom } from "jotai";

import { ProjectScope } from "../scopes";
import { PANEL_COUNT } from "../sidebarLayoutMath";

export const SidebarLayoutMolecule = molecule((_, getScope) => {
  getScope(ProjectScope);

  return {
    heightsAtom: atom<number[]>(new Array(PANEL_COUNT).fill(0)),
    collapsedAtom: atom<boolean[]>(new Array(PANEL_COUNT).fill(false)),
    rememberedAtom: atom<number[]>(new Array(PANEL_COUNT).fill(0)),
    containerHeightAtom: atom<number>(0),
    initializedAtom: atom<boolean>(false),
  };
});
