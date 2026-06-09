export const PANEL_COUNT = 3;

/** 固定的 header 高度（px）；折叠时面板即为此高度。需与 SidebarSection header 的高度类保持一致（h-7 = 28px）。 */
export const HEADER_PX = 28;

/** 展开时面板的最小高度（px），包含 header。 */
export const MIN_PANEL_PX = HEADER_PX + 60;

function at(values: number[], index: number): number {
  return values[index] ?? 0;
}

function effectiveMin(collapsed: boolean[], index: number): number {
  return collapsed[index] ? HEADER_PX : MIN_PANEL_PX;
}

/** 把整数总和精确对齐到 target：将差值补到最后一个可调整（展开）的面板上。 */
function pinSum(heights: number[], collapsed: boolean[], target: number): number[] {
  const next = heights.map((value) => Math.round(value));
  const diff = target - next.reduce((sum, value) => sum + value, 0);
  if (diff === 0) {
    return next;
  }

  for (let i = next.length - 1; i >= 0; i -= 1) {
    if (!collapsed[i]) {
      next[i] = at(next, i) + diff;
      return next;
    }
  }

  const last = next.length - 1;
  next[last] = at(next, last) + diff;
  return next;
}

/** 首次测量：在展开面板间均分 total（每个不低于 MIN_PANEL_PX，折叠面板固定 HEADER_PX）。 */
export function seedHeights(total: number, collapsed: boolean[]): number[] {
  const expanded = collapsed
    .map((value, index) => ({ value, index }))
    .filter((entry) => !entry.value)
    .map((entry) => entry.index);

  const heights = collapsed.map((isCollapsed) => (isCollapsed ? HEADER_PX : MIN_PANEL_PX));
  if (expanded.length === 0) {
    return heights;
  }

  const fixed = collapsed.filter(Boolean).length * HEADER_PX;
  const pool = Math.max(total - fixed, expanded.length * MIN_PANEL_PX);
  const share = pool / expanded.length;
  for (const index of expanded) {
    heights[index] = share;
  }

  return pinSum(heights, collapsed, Math.max(total, fixed + expanded.length * MIN_PANEL_PX));
}

/**
 * 拖动调整：handleIndex = i 即面板 i 与 i+1 之间的分割线。
 * deltaPx > 0（下拖）放大面板 i，从下方 i+1, i+2… 级联收缩；deltaPx < 0 反向。
 * 收缩侧逐个从近到远减到 effectiveMin，跳过折叠面板。
 */
export function resizeAt(
  heights: number[],
  collapsed: boolean[],
  handleIndex: number,
  deltaPx: number,
): number[] {
  if (deltaPx === 0) {
    return heights.slice();
  }

  const next = heights.slice();
  const growIndex = deltaPx > 0 ? handleIndex : handleIndex + 1;
  const direction = deltaPx > 0 ? 1 : -1; // 收缩侧的遍历方向
  let remaining = Math.abs(deltaPx);
  let moved = 0;

  for (
    let j = handleIndex + (deltaPx > 0 ? 1 : 0);
    j >= 0 && j < next.length && remaining > 0;
    j += direction
  ) {
    if (collapsed[j]) {
      continue;
    }
    const avail = at(next, j) - effectiveMin(collapsed, j);
    const take = Math.min(avail, remaining);
    if (take <= 0) {
      continue;
    }
    next[j] = at(next, j) - take;
    remaining -= take;
    moved += take;
  }

  next[growIndex] = at(next, growIndex) + moved;
  return next;
}

/** 在给定索引集合上按当前高度比例分配 amount（正=加，负=减并 clamp 到 effectiveMin）。返回实际变化量。 */
function distribute(
  heights: number[],
  collapsed: boolean[],
  indices: number[],
  amount: number,
): number {
  if (indices.length === 0 || amount === 0) {
    return 0;
  }

  if (amount > 0) {
    const total = indices.reduce((sum, i) => sum + at(heights, i), 0) || indices.length;
    let applied = 0;
    indices.forEach((i, position) => {
      const portion =
        position === indices.length - 1
          ? amount - applied
          : Math.round((amount * at(heights, i)) / total);
      heights[i] = at(heights, i) + portion;
      applied += portion;
    });
    return amount;
  }

  // amount < 0：按可让空间比例收缩，每个 clamp 到 effectiveMin
  const avail = indices.map((i) => Math.max(at(heights, i) - effectiveMin(collapsed, i), 0));
  const totalAvail = avail.reduce((sum, value) => sum + value, 0);
  if (totalAvail <= 0) {
    return 0;
  }

  const toTake = Math.min(-amount, totalAvail);
  let applied = 0;
  let taken = 0;
  indices.forEach((i, position) => {
    const raw =
      position === indices.length - 1
        ? toTake - applied
        : Math.round((toTake * (avail[position] ?? 0)) / totalAvail);
    const clamped = Math.min(raw, avail[position] ?? 0);
    heights[i] = at(heights, i) - clamped;
    applied += clamped;
    taken += clamped;
  });
  return -taken;
}

/** 从 indices（按优先级排序，最近的在前）依次收缩，每个减到 effectiveMin，不够再级联下一个。返回实际收缩量（正数）。 */
function cascadeTake(
  heights: number[],
  collapsed: boolean[],
  indices: number[],
  amount: number,
): number {
  let remaining = amount;
  let taken = 0;
  for (const i of indices) {
    if (remaining <= 0) {
      break;
    }
    const avail = Math.max(at(heights, i) - effectiveMin(collapsed, i), 0);
    const take = Math.min(avail, remaining);
    if (take <= 0) {
      continue;
    }
    heights[i] = at(heights, i) - take;
    remaining -= take;
    taken += take;
  }
  return taken;
}

/** 折叠面板 k：释放空间优先按比例分给下方展开面板，无则全部给最近的上方面板。记忆原高度供展开恢复。 */
export function collapse(
  heights: number[],
  collapsed: boolean[],
  remembered: number[],
  k: number,
): { heights: number[]; collapsed: boolean[]; remembered: number[] } {
  if (collapsed[k]) {
    return {
      heights: heights.slice(),
      collapsed: collapsed.slice(),
      remembered: remembered.slice(),
    };
  }

  const nextHeights = heights.slice();
  const nextCollapsed = collapsed.slice();
  const nextRemembered = remembered.slice();

  nextRemembered[k] = at(nextHeights, k);
  const freed = at(nextHeights, k) - HEADER_PX;
  nextHeights[k] = HEADER_PX;
  nextCollapsed[k] = true;

  const below = nextHeights
    .map((_, index) => index)
    .filter((index) => index > k && !nextCollapsed[index]);
  const aboveNearest = nextHeights
    .map((_, index) => index)
    .filter((index) => index < k && !nextCollapsed[index])
    .reverse(); // 最近的上方面板在前

  if (below.length > 0) {
    distribute(nextHeights, nextCollapsed, below, freed);
  } else if (aboveNearest.length > 0) {
    // 类似把分割线瞬间拖到底：全部给最近的上方面板，其余不动
    const target = aboveNearest[0] ?? k;
    nextHeights[target] = at(nextHeights, target) + freed;
  }

  const total = heights.reduce((sum, value) => sum + value, 0);
  return {
    heights: pinSum(nextHeights, nextCollapsed, total),
    collapsed: nextCollapsed,
    remembered: nextRemembered,
  };
}

/** 展开面板 k：按记忆高度从下方（不足则上方）回收空间。 */
export function expand(
  heights: number[],
  collapsed: boolean[],
  remembered: number[],
  k: number,
): { heights: number[]; collapsed: boolean[]; remembered: number[] } {
  if (!collapsed[k]) {
    return {
      heights: heights.slice(),
      collapsed: collapsed.slice(),
      remembered: remembered.slice(),
    };
  }

  const nextHeights = heights.slice();
  const nextCollapsed = collapsed.slice();

  nextCollapsed[k] = false;
  const want = Math.max(at(remembered, k) || MIN_PANEL_PX, MIN_PANEL_PX);
  const need = want - HEADER_PX;

  const below = nextHeights
    .map((_, index) => index)
    .filter((index) => index > k && !nextCollapsed[index]);
  const aboveNearest = nextHeights
    .map((_, index) => index)
    .filter((index) => index < k && !nextCollapsed[index])
    .reverse(); // 最近的上方面板在前

  // 优先从下方按比例回收；不足再从最近的上方面板就近级联回收
  let reclaimed = -distribute(nextHeights, nextCollapsed, below, -need);
  if (need - reclaimed > 0) {
    reclaimed += cascadeTake(nextHeights, nextCollapsed, aboveNearest, need - reclaimed);
  }

  nextHeights[k] = HEADER_PX + reclaimed;

  const total = heights.reduce((sum, value) => sum + value, 0);
  return {
    heights: pinSum(nextHeights, nextCollapsed, total),
    collapsed: nextCollapsed,
    remembered: remembered.slice(),
  };
}

/** 容器尺寸变化：把 diff 按当前高度比例分到展开面板，收缩时 clamp 到 MIN_PANEL_PX。 */
export function reflow(
  heights: number[],
  collapsed: boolean[],
  oldTotal: number,
  newTotal: number,
): number[] {
  const diff = newTotal - oldTotal;
  if (diff === 0) {
    return heights.slice();
  }

  const next = heights.slice();
  const expanded = next.map((_, index) => index).filter((index) => !collapsed[index]);
  if (expanded.length === 0) {
    return next;
  }

  distribute(next, collapsed, expanded, diff);

  const fixed = collapsed.filter(Boolean).length * HEADER_PX;
  const minTotal = fixed + expanded.length * MIN_PANEL_PX;
  return pinSum(next, collapsed, Math.max(newTotal, minTotal));
}

/** handle (index 与 index+1 之间) 是否可交互：两侧需各有至少一个展开面板可让/吸收。 */
export function isHandleInteractive(collapsed: boolean[], handleIndex: number): boolean {
  const aboveExpanded = collapsed.slice(0, handleIndex + 1).some((value) => !value);
  const belowExpanded = collapsed.slice(handleIndex + 1).some((value) => !value);
  return aboveExpanded && belowExpanded;
}
