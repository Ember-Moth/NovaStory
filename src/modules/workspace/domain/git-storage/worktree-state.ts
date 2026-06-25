import fs from "node:fs";
import path from "node:path";

import { ORIGIN_TIMELINE_POINT_ID } from "@/modules/workspace/domain/constants";
import { invariant } from "@/shared/lib/domain";

import { parseJsonl, stringifyJsonl } from "./jsonl";
import type { ManuscriptNodeDiskState, TimelineMetaRow } from "./types";
import type { VirtualWorkdir } from "nano-git/workdir/core";

export interface WorktreeState {
  content: ManuscriptNodeDiskState[];
  timeline: TimelineMetaRow[];
}

const TIMELINE_FILE = "timeline.jsonl";
const MANUSCRIPT_DIR = "manuscript";
const INDEX_FILE = "index.jsonl";
export const AUX_ORIGIN_DIR = "aux/origin";
export const AUX_TIMELINE_DIR = "aux/timeline";

export function readTextSync(filePath: string) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function ensureDirSync(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

/** 每行一个节点的 index.jsonl 行格式 */
interface IndexRow {
  id: string;
  parentId: string | null;
  title: string | null;
  anchorTimelinePointId: string | null;
}

function normalizeBody(body: string) {
  return body.replace(/\r\n/g, "\n");
}

/** DFS pre-order 遍历，生成 index.jsonl 行 */
function* dfsRows(nodes: ManuscriptNodeDiskState[]): Generator<IndexRow> {
  for (const node of nodes) {
    yield {
      id: node.id,
      parentId: node.parentId,
      title: node.title,
      anchorTimelinePointId: node.anchorTimelinePointId,
    };
    yield* dfsRows(node.children);
  }
}

/** 从 index.jsonl + manuscript/<id>.md 重建节点树 */
function rebuildTree(
  dir: string,
  rows: IndexRow[],
  idToBody: Map<string, string>,
): ManuscriptNodeDiskState[] {
  const nodeMap = new Map<string, ManuscriptNodeDiskState>();
  // 第一趟：DFS pre-order 保证 parent 已存在于 nodeMap
  for (const row of rows) {
    const node: ManuscriptNodeDiskState = {
      id: row.id,
      parentId: row.parentId,
      title: row.title,
      anchorTimelinePointId: row.anchorTimelinePointId,
      body: normalizeBody(idToBody.get(row.id) ?? ""),
      children: [],
    };
    if (row.parentId == null) {
      nodeMap.set(row.id, node);
      // 暂存到 roots，下面处理
      continue;
    }
    const parent = nodeMap.get(row.parentId);
    if (!parent) {
      // parent 尚未出现 → 该节点提升为 root（容错）
      node.parentId = null;
    } else {
      parent.children.push(node);
    }
    nodeMap.set(row.id, node);
  }

  // 根节点：DFS 行序中 parentId == null 的按行序排列
  const roots: ManuscriptNodeDiskState[] = [];
  for (const row of rows) {
    if (row.parentId == null) {
      const node = nodeMap.get(row.id);
      if (node) roots.push(node);
    }
  }
  return roots;
}

export function readWorktreeState(dir: string): WorktreeState {
  const indexContent = readTextSync(path.join(dir, INDEX_FILE));
  const rows: IndexRow[] = indexContent ? parseJsonl<IndexRow>(indexContent) : [];

  // 读正文文件
  const manuscriptDir = path.join(dir, MANUSCRIPT_DIR);
  const idToBody = new Map<string, string>();
  if (fs.existsSync(manuscriptDir)) {
    for (const entry of fs.readdirSync(manuscriptDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".md") && entry.name !== INDEX_FILE) {
        const id = entry.name.slice(0, -3); // remove .md
        const content = readTextSync(path.join(manuscriptDir, entry.name));
        if (content != null) {
          idToBody.set(id, normalizeBody(content));
        }
      }
    }
  }

  return {
    content: rebuildTree(dir, rows, idToBody),
    timeline: parseJsonl<TimelineMetaRow>(readTextSync(path.join(dir, TIMELINE_FILE))),
  };
}

export function readWorktreeStateFromFiles(files: Record<string, string>): WorktreeState {
  const rows = parseJsonl<IndexRow>(files[INDEX_FILE]);
  const idToBody = new Map<string, string>();

  for (const [filepath, content] of Object.entries(files)) {
    if (!filepath.startsWith(`${MANUSCRIPT_DIR}/`) || !filepath.endsWith(".md")) {
      continue;
    }
    const filename = filepath.slice(MANUSCRIPT_DIR.length + 1);
    const id = filename.slice(0, -3);
    if (!id) {
      continue;
    }
    idToBody.set(id, normalizeBody(content));
  }

  return {
    content: rebuildTree("", rows, idToBody),
    timeline: parseJsonl<TimelineMetaRow>(files[TIMELINE_FILE]),
  };
}

function flattenContent(nodes: ManuscriptNodeDiskState[]): ManuscriptNodeDiskState[] {
  return nodes.flatMap((node) => [node, ...flattenContent(node.children)]);
}

/** 写 index.jsonl 和 manuscript/<id>.md 文件 */
function writeManuscriptFiles(dir: string, roots: ManuscriptNodeDiskState[]) {
  const manuscriptDir = path.join(dir, MANUSCRIPT_DIR);
  ensureDirSync(manuscriptDir);

  // 收集 index 中声明的所有 id
  const indexIds = new Set<string>();
  const indexLines: string[] = [];
  for (const row of dfsRows(roots)) {
    indexIds.add(row.id);
    indexLines.push(JSON.stringify(row));
  }
  indexLines.push(""); // trailing newline

  // 写 index.jsonl
  fs.writeFileSync(path.join(dir, INDEX_FILE), indexLines.join("\n"), "utf8");

  // 增量同步 .md 文件
  const existingFiles = new Set<string>();
  for (const entry of fs.readdirSync(manuscriptDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".md") && entry.name !== INDEX_FILE) {
      existingFiles.add(entry.name);
    }
  }

  const requiredFiles = new Set<string>();
  for (const node of flattenContent(roots)) {
    const filename = `${node.id}.md`;
    requiredFiles.add(filename);
    existingFiles.delete(filename);

    const filePath = path.join(manuscriptDir, filename);
    const body = normalizeBody(node.body);
    const existing = readTextSync(filePath);
    if (existing !== body) {
      fs.writeFileSync(filePath, body, "utf8");
    }
  }

  // 删除孤儿文件（index 中不存在的）
  for (const orphan of existingFiles) {
    fs.rmSync(path.join(manuscriptDir, orphan), { force: true });
  }
}

export async function writeWorktreeState(dir: string, state: WorktreeState) {
  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.writeFile(
    path.join(dir, TIMELINE_FILE),
    stringifyJsonl(state.timeline),
    "utf8",
  );
  writeManuscriptFiles(dir, state.content);
  await fs.promises.mkdir(path.join(dir, AUX_ORIGIN_DIR), { recursive: true });
}

export function writeWorktreeStateSync(dir: string, state: WorktreeState) {
  ensureDirSync(dir);
  fs.writeFileSync(path.join(dir, TIMELINE_FILE), stringifyJsonl(state.timeline), "utf8");
  writeManuscriptFiles(dir, state.content);
  ensureDirSync(path.join(dir, AUX_ORIGIN_DIR));
}

export function seedEmptyWorktree(dir: string) {
  ensureDirSync(dir);
  writeWorktreeStateSync(dir, {
    content: [],
    timeline: [],
  });
}

export function orderTimelineRows(rows: TimelineMetaRow[]) {
  const byPrev = new Map<string | null, TimelineMetaRow>();
  for (const row of rows) byPrev.set(row.prevPointId, row);
  const ordered: TimelineMetaRow[] = [];
  let prev: string | null = null;
  const seen = new Set<string>();
  while (true) {
    const next = byPrev.get(prev);
    if (!next || seen.has(next.id)) break;
    ordered.push(next);
    seen.add(next.id);
    prev = next.id;
  }
  const leftovers = rows
    .filter((row) => !seen.has(row.id))
    .sort((a, b) => a.id.localeCompare(b.id));
  return [...ordered, ...leftovers];
}

export function normalizePointId(pointId: string | null | undefined) {
  return pointId === ORIGIN_TIMELINE_POINT_ID || pointId == null ? null : pointId;
}

export function pointIdOrOrigin(pointId: string | null | undefined) {
  return pointId ?? ORIGIN_TIMELINE_POINT_ID;
}

export function assertTimelinePoint(state: WorktreeState, pointId: string | null | undefined) {
  const normalized = normalizePointId(pointId);
  invariant(
    !normalized || state.timeline.some((point) => point.id === normalized),
    "未找到时间点。",
  );
  return normalized;
}

export function flattenManuscriptNodes(state: WorktreeState) {
  return flattenContent(state.content);
}

export function findManuscriptNode(state: WorktreeState, nodeId: string) {
  const node = flattenContent(state.content).find((item) => item.id === nodeId);
  invariant(node, "未找到章节。");
  return node;
}

export function listManuscriptChildren(
  state: WorktreeState,
  parentId: string | null,
): ManuscriptNodeDiskState[] {
  if (parentId == null) {
    return [...state.content];
  }
  return [...findManuscriptNode(state, parentId).children];
}

export function insertManuscriptNode(
  rootDir: string,
  state: WorktreeState,
  input: {
    node: ManuscriptNodeDiskState;
    parentId: string | null;
    afterSiblingId?: string | null;
    writeNodeImmediately?: boolean;
  },
) {
  const siblings = listManuscriptChildren(state, input.parentId);
  const insertIndex = input.afterSiblingId
    ? siblings.findIndex((sibling) => sibling.id === input.afterSiblingId) + 1
    : 0;
  if (input.afterSiblingId) {
    invariant(insertIndex > 0, "无法创建章节：目标位置不在同一个父级下。");
  }

  input.node.parentId = input.parentId;
  input.node.children = input.node.children ?? [];

  if (input.parentId == null) {
    state.content.splice(insertIndex, 0, input.node);
    return;
  }

  const parent = findManuscriptNode(state, input.parentId);
  parent.children.splice(insertIndex, 0, input.node);
}

export function removeNodeFromTree(
  nodes: ManuscriptNodeDiskState[],
  nodeId: string,
): ManuscriptNodeDiskState | null {
  const index = nodes.findIndex((node) => node.id === nodeId);
  if (index >= 0) {
    return nodes.splice(index, 1)[0] ?? null;
  }
  for (const node of nodes) {
    const removed = removeNodeFromTree(node.children, nodeId);
    if (removed) {
      return removed;
    }
  }
  return null;
}

export function removeManuscriptNode(rootDir: string, state: WorktreeState, nodeId: string) {
  const removed = removeNodeFromTree(state.content, nodeId);
  invariant(removed, "未找到章节。");

  // 删除该节点及其所有子节点的 .md 文件
  const allNodes = flattenContent([removed]);
  const manuscriptDir = path.join(rootDir, MANUSCRIPT_DIR);
  for (const n of allNodes) {
    const filePath = path.join(manuscriptDir, `${n.id}.md`);
    fs.rmSync(filePath, { force: true });
  }

  return removed;
}

export function moveManuscriptNode(
  rootDir: string,
  state: WorktreeState,
  input: {
    nodeId: string;
    newParentId: string | null;
    afterSiblingId?: string | null;
  },
) {
  const node = findManuscriptNode(state, input.nodeId);
  invariant(input.newParentId !== input.nodeId, "无法移动：不能把章节移动到自己的子章节下。");
  const descendants = new Set<string>();
  const collect = (current: ManuscriptNodeDiskState) => {
    for (const child of current.children) {
      descendants.add(child.id);
      collect(child);
    }
  };
  collect(node);
  invariant(
    !input.newParentId || !descendants.has(input.newParentId),
    "无法移动：不能把章节移动到自己的子章节下。",
  );
  if (input.newParentId) {
    findManuscriptNode(state, input.newParentId);
  }
  if (input.afterSiblingId) {
    invariant(input.afterSiblingId !== input.nodeId, "无法移动：目标位置不能是章节自身。");
    const targetSiblings = listManuscriptChildren(state, input.newParentId);
    invariant(
      targetSiblings.some((sibling) => sibling.id === input.afterSiblingId),
      "无法移动章节：目标位置不在同一个父级下。",
    );
  }

  const moved = removeNodeFromTree(state.content, input.nodeId);
  invariant(moved, "未找到章节。");

  insertManuscriptNode(rootDir, state, {
    node: moved,
    parentId: input.newParentId,
    afterSiblingId: input.afterSiblingId,
    writeNodeImmediately: false,
  });

  return moved;
}

// ---------------------------------------------------------------------------
// VirtualWorkdir-based I/O (Phase 2)
// ---------------------------------------------------------------------------

/**
 * 从 VirtualWorkdir 读取工作树状态。
 * 等价于 readWorktreeState(dir)，但基于 VirtualWorkdir 而非文件系统。
 */
export function readWorktreeStateFromWorkdir(workdir: VirtualWorkdir): WorktreeState {
  const indexContent = workdir.readFile("index.jsonl").toString("utf8");
  const rows: IndexRow[] = indexContent ? parseJsonl<IndexRow>(indexContent) : [];

  const idToBody = new Map<string, string>();
  for (const entry of workdir.readdir("manuscript")) {
    if (entry.kind === "blob" && entry.name.endsWith(".md") && entry.name !== INDEX_FILE) {
      const id = entry.name.slice(0, -3);
      const content = workdir.readFile(`manuscript/${entry.name}`).toString("utf8");
      if (content != null) {
        idToBody.set(id, normalizeBody(content));
      }
    }
  }

  return {
    content: rebuildTree("", rows, idToBody),
    timeline: parseJsonl<TimelineMetaRow>(workdir.readFile("timeline.jsonl").toString("utf8")),
  };
}

/**
 * 将工作树状态写入 VirtualWorkdir。
 * 等价于 writeWorktreeStateSync(dir, state)，但基于 VirtualWorkdir 而非文件系统。
 */
export function writeWorktreeStateToWorkdir(workdir: VirtualWorkdir, state: WorktreeState) {
  // write index.jsonl
  const indexLines: string[] = [];
  for (const row of dfsRows(state.content)) {
    indexLines.push(JSON.stringify(row));
  }
  indexLines.push("");
  workdir.writeFile("index.jsonl", Buffer.from(indexLines.join("\n"), "utf8"));

  // write timeline.jsonl
  workdir.writeFile("timeline.jsonl", Buffer.from(stringifyJsonl(state.timeline), "utf8"));

  // write manuscript/<id>.md
  if (!workdir.exists("manuscript")) {
    workdir.mkdir("manuscript");
  }
  const declaredIds = new Set<string>();
  for (const node of flattenContent(state.content)) {
    declaredIds.add(node.id);
    const body = normalizeBody(node.body);
    workdir.writeFile(`manuscript/${node.id}.md`, Buffer.from(body, "utf8"));
  }

  // ensure aux/origin exists
  if (!workdir.exists("aux")) {
    workdir.mkdir("aux");
  }
  if (!workdir.exists("aux/origin")) {
    workdir.mkdir("aux/origin");
  }

  // 删除被移除的 manuscript 文件
  for (const entry of workdir.readdir("manuscript")) {
    if (entry.kind === "blob" && entry.name.endsWith(".md") && entry.name !== INDEX_FILE) {
      const id = entry.name.slice(0, -3);
      if (!declaredIds.has(id)) {
        workdir.delete(`manuscript/${entry.name}`);
      }
    }
  }
}
