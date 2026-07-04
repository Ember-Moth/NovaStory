import posix from "node:path/posix";
import type { VirtualWorktree } from "nano-git/worktree/core";
import { ORIGIN_TIMELINE_POINT_ID } from "@/modules/workspace/domain/constants";
import { invariant } from "@/shared/lib/domain";
import { getBranch } from "./branches";
import { getBranchMapping, getWorkdirForBranch } from "./git-storage/git-store";
import type { WorktreeState } from "./git-storage/worktree-state";
import {
  assertTimelinePoint,
  normalizePointId,
  orderTimelineRows,
  pointIdOrOrigin,
  readWorktreeStateFromWorkdir,
} from "./git-storage/worktree-state";
import { getWorkspace, getWorkspaceForBranchId, touchWorkspaceMeta } from "./lifecycle";
import type {
  AuxDirListTreeNode,
  AuxTimelineChangeSummary,
  AuxTimelineChangeView,
  AuxTimelineModifiedAspect,
  ExportedAuxNode,
  ExportedAuxSnapshotTree,
  ResolvedAuxSnapshotNode,
  TimelinePointRef,
} from "./types";

export { ORIGIN_TIMELINE_POINT_ID };

const WHITEOUT_PREFIX = ".wh.";
const KEEP_FILE = ".gitkeep";

type OverlayNodeType = "dir" | "file" | "symlink";

interface OverlayLayerEntry {
  kind: "node" | "whiteout";
  path: string;
  nodeType?: OverlayNodeType;
  fsPath?: string;
  symlinkTargetPath?: string | null;
  timelinePointId: string | null;
}

interface OverlaySnapshotNode extends ResolvedAuxSnapshotNode {
  nodeType: OverlayNodeType;
  fsPath: string | null;
  symlinkTargetPath: string | null;
}

/** 通过 workspaceId（即分支名）解析 workdir key，再获取 VirtualWorktree */
function resolveWorkdir(projectId: string, workspaceId: string) {
  const workdirKey = getBranchMapping(projectId, workspaceId);
  invariant(workdirKey, `没有关联的 workdir key: ${workspaceId}`);
  return getWorkdirForBranch(projectId, workdirKey);
}

async function touchWorkspace(projectId: string, workspaceId: string) {
  touchWorkspaceMeta(projectId, workspaceId);
}

export function normalizeTimelinePointId(pointId: TimelinePointRef) {
  return normalizePointId(pointId) ?? ORIGIN_TIMELINE_POINT_ID;
}

function timelinePointOrder(state: WorktreeState, pointId: string | null) {
  if (pointId == null) return 0;
  const ordered = orderTimelineRows(state.timeline);
  const index = ordered.findIndex((point) => point.id === pointId);
  return index < 0 ? -1 : index + 1;
}

function timelineLayerPointIds(state: WorktreeState, targetPointId: string | null) {
  const targetOrder = timelinePointOrder(state, targetPointId);
  return orderTimelineRows(state.timeline)
    .filter((point) => {
      const order = timelinePointOrder(state, point.id);
      return order >= 0 && order <= targetOrder;
    })
    .map((point) => point.id);
}

function normalizeAuxPath(
  value: string,
  actionLabel = "处理辅助信息",
  options: { allowRoot?: boolean } = {},
) {
  const trimmed = value.trim();
  invariant(trimmed.length > 0, `${actionLabel}失败：路径不能为空。`);
  invariant(trimmed.startsWith("/"), `${actionLabel}失败：只支持以 / 开头的绝对路径。`);
  invariant(!trimmed.includes("\\"), `${actionLabel}失败：路径不能包含反斜杠。`);
  const segments = trimmed.split("/").filter(Boolean);
  invariant(options.allowRoot || segments.length > 0, `${actionLabel}失败：不能作用于根目录。`);
  for (const segment of segments) {
    invariant(segment !== "." && segment !== "..", `${actionLabel}失败：路径不能包含 . 或 ..。`);
    invariant(segment !== KEEP_FILE, `${actionLabel}失败：${KEEP_FILE} 是保留文件名。`);
    invariant(!segment.startsWith(WHITEOUT_PREFIX), `${actionLabel}失败：.wh.* 是保留文件名。`);
  }
  return segments.length === 0 ? "/" : `/${segments.join("/")}`;
}

function splitAuxPath(value: string, actionLabel: string) {
  const normalizedPath = normalizeAuxPath(value, actionLabel);
  return {
    normalizedPath,
    parentPath: posix.dirname(normalizedPath),
    name: posix.basename(normalizedPath),
  };
}

function auxPathSegments(auxPath: string) {
  return auxPath === "/" ? [] : auxPath.split("/").filter(Boolean);
}

// ---------------------------------------------------------------------------
// VirtualWorktree 同步辅助
// ---------------------------------------------------------------------------

/**
 * 将逻辑 aux 路径转换为 VirtualWorktree 内的相对路径。
 * 例如 auxPath="/lore/world.md", pointId=null → "aux/origin/lore/world.md"
 */
function auxWorkdirRelPath(pointId: string | null, auxPath: string): string {
  const base = pointId ? `aux/timeline/${pointId}` : "aux/origin";
  if (auxPath === "/") return base;
  const trimmed = auxPath.startsWith("/") ? auxPath.slice(1) : auxPath;
  return `${base}/${trimmed}`;
}

/** 确保 VirtualWorktree 内路径的所有祖先目录存在 */
function ensureWorkdirDir(wd: VirtualWorktree, dirPath: string) {
  wd.mkdir(dirPath, { recursive: true });
}

function removeFromSnapshot(snapshot: Map<string, OverlaySnapshotNode>, auxPath: string) {
  for (const key of [...snapshot.keys()]) {
    if (key === auxPath || key.startsWith(`${auxPath}/`)) {
      snapshot.delete(key);
    }
  }
}

function snapshotHasPathOrDescendant(snapshot: Map<string, OverlaySnapshotNode>, auxPath: string) {
  for (const key of snapshot.keys()) {
    if (key === auxPath || key.startsWith(`${auxPath}/`)) {
      return true;
    }
  }
  return false;
}

function hasAncestorPath(paths: string[], auxPath: string) {
  return paths.some((pathItem) => auxPath.startsWith(`${pathItem}/`));
}

// readLayerEntries (physical fs) removed — only readLayerEntriesFromWorkdir is used

/**
 * 从 VirtualWorktree 读取指定层的条目，与 readLayerEntries 语义完全一致。
 * 保留 whiteout（.wh.*）和 .gitkeep 的完整语义。
 */
function readLayerEntriesFromWorkdir(
  wd: VirtualWorktree,
  pointId: string | null,
): OverlayLayerEntry[] {
  const rootPath = auxWorkdirRelPath(pointId, "/");
  if (!wd.exists(rootPath)) return [];
  const entries: OverlayLayerEntry[] = [];

  const walk = (wdDir: string, logicalDir: string) => {
    for (const dirent of wd.readdir(wdDir)) {
      if (dirent.name === KEEP_FILE) continue;
      const childLogicalPath =
        logicalDir === "/" ? `/${dirent.name}` : `${logicalDir}/${dirent.name}`;
      const childWdPath = wdDir ? `${wdDir}/${dirent.name}` : dirent.name;

      if (dirent.name.startsWith(WHITEOUT_PREFIX)) {
        const name = dirent.name.slice(WHITEOUT_PREFIX.length);
        if (!name) continue;
        entries.push({
          kind: "whiteout",
          path: logicalDir === "/" ? `/${name}` : `${logicalDir}/${name}`,
          timelinePointId: pointId,
        });
        continue;
      }

      if (dirent.kind === "symlink") {
        entries.push({
          kind: "node",
          path: childLogicalPath,
          nodeType: "symlink",
          fsPath: undefined,
          symlinkTargetPath: wd.readLink(childWdPath),
          timelinePointId: pointId,
        });
        continue;
      }

      if (dirent.kind === "tree") {
        // VirtualWorktree 中目录由 mkdir 创建，无需 .gitkeep 标记
        // 但为了与物理 fs 行为一致，仍需检查 .gitkeep 文件
        if (wd.exists(`${childWdPath}/${KEEP_FILE}`)) {
          entries.push({
            kind: "node",
            path: childLogicalPath,
            nodeType: "dir",
            fsPath: undefined,
            symlinkTargetPath: null,
            timelinePointId: pointId,
          });
        }
        walk(childWdPath, childLogicalPath);
        continue;
      }

      if (dirent.kind === "blob") {
        entries.push({
          kind: "node",
          path: childLogicalPath,
          nodeType: "file",
          fsPath: undefined,
          symlinkTargetPath: null,
          timelinePointId: pointId,
        });
      }
    }
  };

  walk(rootPath, "/");
  return entries.sort((left, right) => {
    const depth = auxPathSegments(left.path).length - auxPathSegments(right.path).length;
    return depth || left.path.localeCompare(right.path);
  });
}

async function buildSnapshot(projectId: string, workspaceId: string, pointId: TimelinePointRef) {
  const workspace = await getWorkspace(projectId, workspaceId);
  const wd = resolveWorkdir(workspace.projectId, workspace.id);
  invariant(wd, "工作目录未初始化");
  const state = readWorktreeStateFromWorkdir(wd);
  const normalizedPointId = assertTimelinePoint(state, pointId);
  const snapshot = new Map<string, OverlaySnapshotNode>();
  const layers = [null, ...timelineLayerPointIds(state, normalizedPointId)];

  for (const layerPointId of layers) {
    const entries = readLayerEntriesFromWorkdir(wd, layerPointId);
    for (const entry of entries) {
      if (entry.kind === "whiteout") {
        removeFromSnapshot(snapshot, entry.path);
        continue;
      }
      invariant(entry.nodeType, "辅助信息层节点缺少类型。");
      if (entry.nodeType !== "dir") {
        removeFromSnapshot(snapshot, entry.path);
      } else {
        const existing = snapshot.get(entry.path);
        if (existing && existing.nodeType !== "dir") {
          snapshot.delete(entry.path);
        }
      }
      snapshot.set(entry.path, {
        nodeType: entry.nodeType,
        name: posix.basename(entry.path),
        path: entry.path,
        content: null,
        symlinkTargetPath: entry.symlinkTargetPath ?? null,
        timelinePointId: pointIdOrOrigin(entry.timelinePointId),
        reachable: true,
        fsPath: null,
      });
    }
  }

  for (const node of snapshot.values()) {
    if (node.nodeType === "file") {
      const rawPointId = normalizePointId(node.timelinePointId);
      const wp = auxWorkdirRelPath(rawPointId, node.path);
      const buf = wd.readFile(wp);
      node.content = buf ? buf.toString("utf8") : null;
    }
  }

  return { workspace, worktreePath: "", state, pointId: normalizedPointId, snapshot };
}

function sortedSnapshotNodes(snapshot: Map<string, OverlaySnapshotNode>) {
  return [...snapshot.values()].sort((left, right) => left.path.localeCompare(right.path));
}

function childrenOf(snapshot: Map<string, OverlaySnapshotNode>, parentPath: string) {
  return sortedSnapshotNodes(snapshot).filter((node) => posix.dirname(node.path) === parentPath);
}

function assertParentDir(snapshot: Map<string, OverlaySnapshotNode>, parentPath: string) {
  if (parentPath === "/") return;
  const parent = snapshot.get(parentPath);
  invariant(parent?.nodeType === "dir", "父路径不是辅助资料目录。");
}

function assertPathAvailable(
  snapshot: Map<string, OverlaySnapshotNode>,
  auxPath: string,
  exceptPath?: string,
) {
  const existing = snapshot.get(auxPath);
  invariant(!existing || existing.path === exceptPath, "同路径辅助信息已存在。");
}

async function lowerSnapshotForLayer(
  projectId: string,
  workspaceId: string,
  state: WorktreeState,
  pointId: string | null,
) {
  if (pointId == null) {
    return new Map<string, OverlaySnapshotNode>();
  }
  const point = orderTimelineRows(state.timeline).find((item) => item.id === pointId);
  invariant(point, "辅助资料时间点不存在。");
  return (await buildSnapshot(projectId, workspaceId, point.prevPointId ?? null)).snapshot;
}

async function currentLayerDeletedEntries(input: {
  projectId: string;
  workspaceId: string;
  state: WorktreeState;
  pointId: string | null;
}) {
  if (input.pointId == null) return [];
  const lowerSnapshot = await lowerSnapshotForLayer(
    input.projectId,
    input.workspaceId,
    input.state,
    input.pointId,
  );
  const selectedPaths: string[] = [];
  const deletedEntries: OverlayLayerEntry[] = [];
  const wd = resolveWorkdir(input.projectId, input.workspaceId);
  if (!wd) return [];

  for (const entry of readLayerEntriesFromWorkdir(wd, input.pointId)) {
    if (entry.kind !== "whiteout") continue;
    if (hasAncestorPath(selectedPaths, entry.path)) continue;
    if (!snapshotHasPathOrDescendant(lowerSnapshot, entry.path)) continue;
    selectedPaths.push(entry.path);
    deletedEntries.push(entry);
  }

  return deletedEntries.map((entry) => {
    const lowerNode = lowerSnapshot.get(entry.path);
    return {
      entry,
      lowerNode,
      nodeType: lowerNode?.nodeType ?? ("dir" as const),
    };
  });
}

function currentLayerTouchedPaths(
  wd: VirtualWorktree,
  pointId: string | null,
): ReadonlySet<string> {
  if (pointId == null) {
    return new Set();
  }

  return new Set(readLayerEntriesFromWorkdir(wd, pointId).map((entry) => entry.path));
}

export async function mkdirAt(input: {
  projectId: string;
  workspaceId: string;
  timelinePointId?: TimelinePointRef;
  path: string;
}) {
  const { workspace, state, pointId, snapshot } = await buildSnapshot(
    input.projectId,
    input.workspaceId,
    input.timelinePointId,
  );
  assertTimelinePoint(state, pointId);
  const { normalizedPath, parentPath } = splitAuxPath(input.path, "创建辅助资料目录");
  assertParentDir(snapshot, parentPath);
  assertPathAvailable(snapshot, normalizedPath);
  const wd = resolveWorkdir(workspace.projectId, workspace.id);
  invariant(wd, "工作目录未初始化");
  const wp = auxWorkdirRelPath(pointId, normalizedPath);
  wd.mkdir(wp, { recursive: true });
  wd.writeFile(`${wp}/${KEEP_FILE}`, Buffer.from(""));
  await touchWorkspace(workspace.projectId, workspace.id);
  return { path: normalizedPath, workspaceId: workspace.id, nodeType: "dir" as const };
}

export async function writeFileAt(input: {
  projectId: string;
  workspaceId: string;
  timelinePointId?: TimelinePointRef;
  path: string;
  content: string;
}) {
  const { workspace, pointId, snapshot } = await buildSnapshot(
    input.projectId,
    input.workspaceId,
    input.timelinePointId,
  );
  const { normalizedPath, parentPath } = splitAuxPath(input.path, "写入辅助资料文件");
  const existing = snapshot.get(normalizedPath);
  invariant(!existing || existing.nodeType === "file", "目标路径不是文件。");
  assertParentDir(snapshot, parentPath);
  const wd = resolveWorkdir(workspace.projectId, workspace.id);
  invariant(wd, "工作目录未初始化");
  const wp = auxWorkdirRelPath(pointId, normalizedPath);
  ensureWorkdirDir(wd, posix.dirname(wp));
  wd.writeFile(wp, Buffer.from(input.content, "utf8"));
  await touchWorkspace(workspace.projectId, workspace.id);
  return { path: normalizedPath, workspaceId: workspace.id, nodeType: "file" as const };
}

export async function linkAt(input: {
  projectId: string;
  workspaceId: string;
  timelinePointId?: TimelinePointRef;
  path: string;
  targetPath: string;
}) {
  const { workspace, pointId, snapshot } = await buildSnapshot(
    input.projectId,
    input.workspaceId,
    input.timelinePointId,
  );
  const { normalizedPath, parentPath } = splitAuxPath(input.path, "创建辅助资料链接");
  const normalizedTargetPath = normalizeAuxPath(input.targetPath, "创建辅助资料链接");
  assertParentDir(snapshot, parentPath);
  assertPathAvailable(snapshot, normalizedPath);
  const wd = resolveWorkdir(workspace.projectId, workspace.id);
  invariant(wd, "工作目录未初始化");
  const wp = auxWorkdirRelPath(pointId, normalizedPath);
  ensureWorkdirDir(wd, posix.dirname(wp));
  wd.writeLink(wp, normalizedTargetPath);
  await touchWorkspace(workspace.projectId, workspace.id);
  return {
    path: normalizedPath,
    workspaceId: workspace.id,
    nodeType: "symlink" as const,
  };
}

export async function moveAuxNodeAt(input: {
  projectId: string;
  workspaceId: string;
  timelinePointId?: TimelinePointRef;
  path: string;
  newPath: string;
}) {
  const { workspace, pointId, snapshot } = await buildSnapshot(
    input.projectId,
    input.workspaceId,
    input.timelinePointId,
  );
  const sourcePath = normalizeAuxPath(input.path, "移动辅助资料");
  const { normalizedPath: targetPath, parentPath } = splitAuxPath(input.newPath, "移动辅助资料");
  invariant(sourcePath !== targetPath, "目标路径不能与原路径相同。");
  const existing = snapshot.get(sourcePath);
  invariant(existing, "辅助信息不存在。");
  invariant(!targetPath.startsWith(`${sourcePath}/`), "不能把目录移动到自身子目录中。");
  assertParentDir(snapshot, parentPath);
  assertPathAvailable(snapshot, targetPath, sourcePath);
  const wd = resolveWorkdir(workspace.projectId, workspace.id);
  invariant(wd, "工作目录未初始化");
  const sourceRawPointId = normalizePointId(existing.timelinePointId);
  const fromWp = auxWorkdirRelPath(sourceRawPointId, sourcePath);
  const toWp = auxWorkdirRelPath(pointId, targetPath);
  if (wd.exists(fromWp)) {
    ensureWorkdirDir(wd, posix.dirname(toWp));
    wd.copy(fromWp, toWp);
    if (sourceRawPointId === pointId) {
      wd.delete(fromWp, { force: true });
    } else {
      const whiteoutDir = posix.dirname(auxWorkdirRelPath(pointId, sourcePath));
      const basename = posix.basename(sourcePath);
      ensureWorkdirDir(wd, whiteoutDir);
      wd.writeFile(`${whiteoutDir}/.wh.${basename}`, Buffer.from(""));
    }
  }
  await touchWorkspace(workspace.projectId, workspace.id);
  return {
    path: targetPath,
    previousPath: sourcePath,
    workspaceId: workspace.id,
    nodeType: existing.nodeType,
  };
}

export async function retargetAuxSymlinkAt(input: {
  projectId: string;
  workspaceId: string;
  timelinePointId?: TimelinePointRef;
  path: string;
  targetPath: string;
}) {
  const { workspace, pointId, snapshot } = await buildSnapshot(
    input.projectId,
    input.workspaceId,
    input.timelinePointId,
  );
  const normalizedPath = normalizeAuxPath(input.path, "重定向辅助资料链接");
  const normalizedTargetPath = normalizeAuxPath(input.targetPath, "重定向辅助资料链接");
  const existing = snapshot.get(normalizedPath);
  invariant(existing?.nodeType === "symlink", "当前辅助信息不是链接。");
  const wd = resolveWorkdir(workspace.projectId, workspace.id);
  invariant(wd, "工作目录未初始化");
  const wp = auxWorkdirRelPath(pointId, normalizedPath);
  ensureWorkdirDir(wd, posix.dirname(wp));
  wd.writeLink(wp, normalizedTargetPath);
  await touchWorkspace(workspace.projectId, workspace.id);
  return { path: normalizedPath, workspaceId: workspace.id, nodeType: "symlink" as const };
}

export async function deleteAuxNodeAt(input: {
  projectId: string;
  workspaceId: string;
  timelinePointId?: TimelinePointRef;
  path: string;
}) {
  const { workspace, state } = await buildSnapshot(
    input.projectId,
    input.workspaceId,
    input.timelinePointId,
  );
  const pointId = assertTimelinePoint(state, input.timelinePointId);
  const normalizedPath = normalizeAuxPath(input.path, "删除辅助资料");
  const wd = resolveWorkdir(workspace.projectId, workspace.id);
  invariant(wd, "工作目录未初始化");
  const wp = auxWorkdirRelPath(pointId, normalizedPath);
  const lowerSnapshot = await lowerSnapshotForLayer(input.projectId, workspace.id, state, pointId);
  const hasLower = snapshotHasPathOrDescendant(lowerSnapshot, normalizedPath);
  if (pointId == null || !hasLower) {
    wd.delete(wp, { force: true });
  } else {
    const whiteoutDir = posix.dirname(wp);
    const basename = posix.basename(normalizedPath);
    ensureWorkdirDir(wd, whiteoutDir);
    wd.delete(wp, { force: true });
    wd.writeFile(`${whiteoutDir}/.wh.${basename}`, Buffer.from(""));
  }
  await touchWorkspace(workspace.projectId, workspace.id);
}

export async function restoreDeletedAuxNodeAt(input: {
  projectId: string;
  workspaceId: string;
  timelinePointId: TimelinePointRef;
  path: string;
}) {
  const workspace = await getWorkspace(input.projectId, input.workspaceId);
  const wd = resolveWorkdir(workspace.projectId, workspace.id);
  invariant(wd, "工作目录未初始化");
  const state = readWorktreeStateFromWorkdir(wd);
  const pointId = assertTimelinePoint(state, input.timelinePointId);
  invariant(pointId !== null, "原点没有可恢复的辅助资料删除标记。");
  const normalizedPath = normalizeAuxPath(input.path, "恢复辅助资料");
  const lowerSnapshot = await lowerSnapshotForLayer(
    input.projectId,
    input.workspaceId,
    state,
    pointId,
  );
  invariant(snapshotHasPathOrDescendant(lowerSnapshot, normalizedPath), "没有可恢复的辅助资料。");
  // 通过 VirtualWorktree 删除 whiteout
  const wp = auxWorkdirRelPath(pointId, normalizedPath);
  const whiteoutWp = `${posix.dirname(wp)}/.wh.${posix.basename(normalizedPath)}`;
  invariant(wd.exists(whiteoutWp), "没有可恢复的辅助资料删除标记。");
  wd.delete(whiteoutWp, { force: true });
  await touchWorkspace(workspace.projectId, workspace.id);
  return {
    path: normalizedPath,
    workspaceId: workspace.id,
    nodeType: lowerSnapshot.get(normalizedPath)?.nodeType ?? ("dir" as const),
  };
}

export async function readAuxByPathAt(
  projectId: string,
  workspaceId: string,
  pointId: TimelinePointRef,
  auxPath: string,
  _options?: { followSymlinks?: boolean },
) {
  const normalized = normalizeAuxPath(auxPath, "读取辅助资料", { allowRoot: true });
  if (normalized === "/") return null;
  return (await buildSnapshot(projectId, workspaceId, pointId)).snapshot.get(normalized) ?? null;
}

export async function listAuxDirAt(
  projectId: string,
  workspaceId: string,
  pointId: TimelinePointRef,
  input: { path?: string } = {},
): Promise<AuxDirListTreeNode[]> {
  const snapshot = (await buildSnapshot(projectId, workspaceId, pointId)).snapshot;
  const dirPath = input.path
    ? normalizeAuxPath(input.path, "列出辅助资料目录", { allowRoot: true })
    : "/";
  const dir = dirPath === "/" ? null : snapshot.get(dirPath);
  invariant(dirPath === "/" || dir?.nodeType === "dir", "未找到辅助文件夹。");
  const build = (parentPath: string): AuxDirListTreeNode[] =>
    childrenOf(snapshot, parentPath).map((node) => ({
      nodeType: node.nodeType,
      name: node.name,
      path: node.path,
      symlinkTargetPath: node.symlinkTargetPath ?? undefined,
      children: node.nodeType === "dir" ? build(node.path) : [],
    }));
  return build(dirPath);
}

export async function listAuxTreeAt(
  projectId: string,
  workspaceId: string,
  pointId: TimelinePointRef,
  input: { path?: string } = {},
  options: { depth?: number } = {},
) {
  const depth = Math.max(1, Math.trunc(options.depth ?? Number.POSITIVE_INFINITY));
  const trimDepth = (nodes: AuxDirListTreeNode[], currentDepth: number): AuxDirListTreeNode[] =>
    nodes.map((node) => {
      const children =
        currentDepth >= depth
          ? node.children.length > 0
            ? []
            : node.children
          : trimDepth(node.children, currentDepth + 1);
      return {
        ...node,
        children,
        ...(currentDepth >= depth && node.children.length > 0
          ? { hiddenChildrenCount: node.children.length }
          : {}),
      };
    });
  return {
    nodes: trimDepth(await listAuxDirAt(projectId, workspaceId, pointId, input), 1),
    truncated: false,
  };
}

export async function exportAuxSnapshotTree(
  projectId: string,
  workspaceId: string,
  pointId?: TimelinePointRef,
): Promise<ExportedAuxSnapshotTree> {
  const {
    state,
    pointId: normalizedPointId,
    snapshot,
  } = await buildSnapshot(projectId, workspaceId, pointId);
  const wd = resolveWorkdir(projectId, workspaceId);
  invariant(wd, "工作目录未初始化");
  const touchedPaths = currentLayerTouchedPaths(wd, normalizedPointId);
  const deletedEntries = await currentLayerDeletedEntries({
    projectId,
    workspaceId,
    state,
    pointId: normalizedPointId,
  });
  const build = (parentPath: string): ExportedAuxNode[] => {
    const visibleNodes = childrenOf(snapshot, parentPath).map((node) => ({
      nodeType: node.nodeType,
      name: node.name,
      content: node.nodeType === "file" ? node.content : null,
      symlinkTargetPath: node.symlinkTargetPath,
      timelinePointId: node.timelinePointId,
      path: node.path,
      hasTimelineChange: touchedPaths.has(node.path),
      overlayStatus: "visible" as const,
      children: node.nodeType === "dir" ? build(node.path) : [],
    }));
    const deletedNodes = deletedEntries
      .filter(({ entry }) => posix.dirname(entry.path) === parentPath && !snapshot.has(entry.path))
      .map(({ entry, nodeType }) => ({
        nodeType,
        name: posix.basename(entry.path),
        content: null,
        symlinkTargetPath: null,
        timelinePointId: pointIdOrOrigin(entry.timelinePointId),
        path: entry.path,
        hasTimelineChange: true,
        overlayStatus: "deleted" as const,
        children: [],
      }));
    return [...visibleNodes, ...deletedNodes].sort((left, right) =>
      left.path.localeCompare(right.path),
    );
  };
  return {
    rootPath: "/",
    timelinePointId: pointIdOrOrigin(normalizedPointId),
    nodes: build("/"),
  };
}

function comparableNode(node: OverlaySnapshotNode | undefined) {
  if (!node) return null;
  return {
    nodeType: node.nodeType,
    content: node.nodeType === "file" ? node.content : null,
    symlinkTargetPath: node.symlinkTargetPath,
  };
}

export async function listAuxTimelineChangesAt(
  projectId: string,
  workspaceId: string,
  pointId: TimelinePointRef,
): Promise<AuxTimelineChangeView[]> {
  const current = (await buildSnapshot(projectId, workspaceId, pointId)).snapshot;
  const normalizedPointId = normalizePointId(pointId);
  const workspace = await getWorkspace(projectId, workspaceId);
  const wd = resolveWorkdir(workspace.projectId, workspace.id);
  invariant(wd, "工作目录未初始化");
  const state = readWorktreeStateFromWorkdir(wd);
  const point = normalizedPointId
    ? orderTimelineRows(state.timeline).find((item) => item.id === normalizedPointId)
    : null;
  const previous = (await buildSnapshot(projectId, workspaceId, point?.prevPointId ?? null))
    .snapshot;
  const paths = [...new Set([...current.keys(), ...previous.keys()])].sort((a, b) =>
    a.localeCompare(b),
  );
  const changes: AuxTimelineChangeView[] = [];
  for (const auxPath of paths) {
    const before = previous.get(auxPath);
    const after = current.get(auxPath);
    if (after && !before) {
      changes.push({
        kind: "added",
        nodeType: after.nodeType,
        path: after.path,
        previousPath: null,
        symlinkTargetPath: after.symlinkTargetPath,
        previousSymlinkTargetPath: null,
        changedAspects: [],
      });
      continue;
    }
    if (before && !after) {
      changes.push({
        kind: "deleted",
        nodeType: before.nodeType,
        path: before.path,
        previousPath: null,
        symlinkTargetPath: null,
        previousSymlinkTargetPath: before.symlinkTargetPath,
        changedAspects: [],
      });
      continue;
    }
    if (before && after) {
      const aspects: AuxTimelineModifiedAspect[] = [];
      if (before.nodeType !== after.nodeType) aspects.push("node_type");
      if (before.content !== after.content) aspects.push("content");
      if (before.symlinkTargetPath !== after.symlinkTargetPath) aspects.push("symlink_target");
      if (JSON.stringify(comparableNode(before)) !== JSON.stringify(comparableNode(after))) {
        changes.push({
          kind: "modified",
          nodeType: after.nodeType,
          path: after.path,
          previousPath: null,
          symlinkTargetPath: after.symlinkTargetPath,
          previousSymlinkTargetPath: before.symlinkTargetPath,
          changedAspects: aspects.length > 0 ? aspects : ["content"],
        });
      }
    }
  }
  return changes;
}

export async function listAuxChangesAt(
  projectId: string,
  workspaceId: string,
  pointId: TimelinePointRef,
) {
  const changes = await listAuxTimelineChangesAt(projectId, workspaceId, pointId);
  return changes.map((change) => ({
    path: change.path,
    isDeleted: change.kind === "deleted",
  }));
}

export async function summarizeAuxTimelineChangesAt(
  projectId: string,
  workspaceId: string,
  pointId: TimelinePointRef,
): Promise<AuxTimelineChangeSummary> {
  const changes = await listAuxTimelineChangesAt(projectId, workspaceId, pointId);
  return {
    hasChanges: changes.length > 0,
    added: changes.filter((change) => change.kind === "added").length,
    modified: changes.filter((change) => change.kind === "modified").length,
    deleted: changes.filter((change) => change.kind === "deleted").length,
    total: changes.length,
  };
}

export async function revertAuxChange(input: {
  projectId: string;
  branchId: string;
  filepath: string;
  kind: "added" | "deleted" | "modified";
}) {
  const branch = getBranch(input.projectId, input.branchId);
  const workspace = getWorkspaceForBranchId(input.projectId, branch.name);
  invariant(workspace, "该分支没有关联的工作区。");

  const wd = resolveWorkdir(workspace.projectId, workspace.id);
  invariant(wd, "工作目录未初始化");

  const normalizedStoragePath = input.filepath.startsWith("novel-evolver/")
    ? input.filepath.slice("novel-evolver/".length)
    : input.filepath;
  invariant(normalizedStoragePath.startsWith("aux/"), "仅支持撤回辅助信息路径。");

  if (input.kind === "modified") {
    invariant(wd.exists(normalizedStoragePath), "无法恢复辅助信息：当前工作区不存在该路径。");
  }

  wd.restore(normalizedStoragePath, { force: true });
  await touchWorkspace(workspace.projectId, workspace.id);
}
