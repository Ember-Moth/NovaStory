import { useMolecule } from "bunshi/react";
import { useAtom, useStore } from "jotai";
import { useCallback, useRef } from "react";

import { SidebarLayoutMolecule } from "../molecules/sidebarLayout";
import { collapse, expand, reflow, resizeAt, seedHeights } from "../sidebarLayoutMath";

export function useSidebarLayout() {
  const layout = useMolecule(SidebarLayoutMolecule);
  const store = useStore();

  const [heights] = useAtom(layout.heightsAtom);
  const [collapsed] = useAtom(layout.collapsedAtom);
  const [initialized] = useAtom(layout.initializedAtom);

  // 拖动开始时的高度快照，move 期间基于它计算，避免漂移。
  const dragStartRef = useRef<number[] | null>(null);

  const onMeasure = useCallback(
    (px: number) => {
      const rounded = Math.round(px);
      if (rounded <= 0) {
        return;
      }

      const wasInitialized = store.get(layout.initializedAtom);
      if (!wasInitialized) {
        const seeded = seedHeights(rounded, store.get(layout.collapsedAtom));
        store.set(layout.heightsAtom, seeded);
        store.set(layout.rememberedAtom, seeded.slice());
        store.set(layout.containerHeightAtom, rounded);
        store.set(layout.initializedAtom, true);
        return;
      }

      const oldTotal = store.get(layout.containerHeightAtom);
      if (oldTotal === rounded) {
        return;
      }
      const reflowed = reflow(
        store.get(layout.heightsAtom),
        store.get(layout.collapsedAtom),
        oldTotal,
        rounded,
      );
      store.set(layout.heightsAtom, reflowed);
      store.set(layout.containerHeightAtom, rounded);
    },
    [layout, store],
  );

  const resizeStart = useCallback(() => {
    dragStartRef.current = store.get(layout.heightsAtom).slice();
  }, [layout, store]);

  const resize = useCallback(
    (handleIndex: number, deltaPx: number) => {
      const start = dragStartRef.current;
      if (!start) {
        return;
      }
      store.set(
        layout.heightsAtom,
        resizeAt(start, store.get(layout.collapsedAtom), handleIndex, deltaPx),
      );
    },
    [layout, store],
  );

  const resizeEnd = useCallback(() => {
    dragStartRef.current = null;
  }, []);

  const toggleCollapse = useCallback(
    (index: number) => {
      const currentCollapsed = store.get(layout.collapsedAtom);
      const result = currentCollapsed[index]
        ? expand(
            store.get(layout.heightsAtom),
            currentCollapsed,
            store.get(layout.rememberedAtom),
            index,
          )
        : collapse(
            store.get(layout.heightsAtom),
            currentCollapsed,
            store.get(layout.rememberedAtom),
            index,
          );
      store.set(layout.heightsAtom, result.heights);
      store.set(layout.collapsedAtom, result.collapsed);
      store.set(layout.rememberedAtom, result.remembered);
    },
    [layout, store],
  );

  return {
    heights,
    collapsed,
    initialized,
    onMeasure,
    resizeStart,
    resize,
    resizeEnd,
    toggleCollapse,
  };
}
