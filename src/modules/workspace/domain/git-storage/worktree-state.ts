import fs from "node:fs";
import path from "node:path";

import { YAML } from "bun";

import { ORIGIN_TIMELINE_POINT_ID } from "@/modules/workspace/domain/constants";
import { invariant } from "@/shared/lib/domain";

import { parseJsonl, stringifyJsonl } from "./jsonl";
import type { ManuscriptNodeDiskState, TimelineMetaRow } from "./types";

export interface WorktreeState {
  content: ManuscriptNodeDiskState[];
  timeline: TimelineMetaRow[];
}

const META_DIR = "novel-evolver";
const TIMELINE_FILE = `${META_DIR}/timeline.jsonl`;
const MANUSCRIPT_DIR = "manuscript";
const CONTENT_FILENAME = "content.md";
const TEMP_RENAME_PREFIX = "__tmp__";
export const AUX_ORIGIN_DIR = "aux/origin";
export const AUX_TIMELINE_DIR = "aux/timeline";

interface ManuscriptFrontMatter {
  title?: unknown;
  anchorTimelinePointId?: unknown;
}

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

function fail(message: string): never {
  throw new Error(message);
}

function splitFrontMatter(raw: string | null) {
  if (raw == null) {
    return { frontMatter: "", body: "" };
  }

  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!match) {
    throw new Error("正文节点缺少 YAML Front Matter。");
  }

  return {
    frontMatter: match[1] ?? "",
    body: match[2] ?? "",
  };
}

function parseFrontMatter(raw: string): {
  title: string | null;
  anchorTimelinePointId: string | null;
} {
  const parsed = raw.trim().length === 0 ? {} : YAML.parse(raw);
  invariant(
    parsed == null || (typeof parsed === "object" && !Array.isArray(parsed)),
    "正文节点 Front Matter 必须是 YAML 对象。",
  );
  const values = (parsed ?? {}) as ManuscriptFrontMatter;

  const title =
    values.title === undefined || values.title === null
      ? null
      : typeof values.title === "string"
        ? values.title.trim().length > 0
          ? values.title
          : null
        : fail("正文节点 Front Matter 字段 title 必须是字符串或 null。");

  const anchorTimelinePointId =
    values.anchorTimelinePointId === undefined || values.anchorTimelinePointId === null
      ? null
      : typeof values.anchorTimelinePointId === "string"
        ? values.anchorTimelinePointId.trim().length > 0
          ? values.anchorTimelinePointId
          : null
        : fail("正文节点 Front Matter 字段 anchorTimelinePointId 必须是字符串或 null。");

  return { title, anchorTimelinePointId };
}

function stringifyFrontMatter(input: {
  title: string | null;
  anchorTimelinePointId: string | null;
}) {
  const values: Record<string, unknown> = {
    title: input.title,
  };
  if (input.anchorTimelinePointId) {
    values.anchorTimelinePointId = input.anchorTimelinePointId;
  }
  return YAML.stringify(values, null, 2).trimEnd();
}

function normalizeBody(body: string) {
  return body.replace(/\r\n/g, "\n");
}

function buildMarkdown(input: {
  title: string | null;
  anchorTimelinePointId: string | null;
  body: string;
}) {
  return `---\n${stringifyFrontMatter(input)}\n---\n${normalizeBody(input.body)}\n`;
}

function padOrder(index: number, minWidth = 4) {
  return String(index + 1).padStart(Math.max(minWidth, String(index + 1).length), "0");
}

function parseNodeDirName(name: string) {
  const match = /^(\d+)-([A-Za-z0-9]+)$/.exec(name);
  invariant(match?.[1] && match[2], `无效的正文节点目录名：${name}`);
  return {
    order: Number.parseInt(match[1], 10),
    id: match[2],
  };
}

function contentFilePathForDir(dirPath: string) {
  return path.join(dirPath, CONTENT_FILENAME);
}

function scanNodeDir(dirPath: string, parentId: string | null): ManuscriptNodeDiskState {
  const parsedName = parseNodeDirName(path.basename(dirPath));
  const markdown = readTextSync(contentFilePathForDir(dirPath));
  invariant(markdown != null, `正文节点缺少 ${CONTENT_FILENAME}：${dirPath}`);
  const { frontMatter, body } = splitFrontMatter(markdown);
  const parsedFrontMatter = parseFrontMatter(frontMatter);

  const entries = fs
    .readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => {
      const leftNode = parseNodeDirName(left.name);
      const rightNode = parseNodeDirName(right.name);
      return leftNode.order - rightNode.order || leftNode.id.localeCompare(rightNode.id);
    });

  const children = entries.map((entry) =>
    scanNodeDir(path.join(dirPath, entry.name), parsedName.id),
  );

  return {
    id: parsedName.id,
    parentId,
    order: parsedName.order - 1,
    title: parsedFrontMatter.title,
    anchorTimelinePointId: parsedFrontMatter.anchorTimelinePointId,
    body: normalizeBody(body).replace(/\r?\n$/, ""),
    dirPath,
    children,
  };
}

export function readWorktreeState(dir: string): WorktreeState {
  const manuscriptRoot = path.join(dir, MANUSCRIPT_DIR);
  const content = fs.existsSync(manuscriptRoot)
    ? fs
        .readdirSync(manuscriptRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .sort((left, right) => {
          const leftNode = parseNodeDirName(left.name);
          const rightNode = parseNodeDirName(right.name);
          return leftNode.order - rightNode.order || leftNode.id.localeCompare(rightNode.id);
        })
        .map((entry) => scanNodeDir(path.join(manuscriptRoot, entry.name), null))
    : [];

  return {
    content,
    timeline: parseJsonl<TimelineMetaRow>(readTextSync(path.join(dir, TIMELINE_FILE))),
  };
}

function flattenContent(nodes: ManuscriptNodeDiskState[]): ManuscriptNodeDiskState[] {
  return nodes.flatMap((node) => [node, ...flattenContent(node.children)]);
}

function writeNodeMarkdown(
  node: Pick<ManuscriptNodeDiskState, "title" | "anchorTimelinePointId" | "body" | "dirPath">,
) {
  ensureDirSync(node.dirPath);
  fs.writeFileSync(
    contentFilePathForDir(node.dirPath),
    buildMarkdown({
      title: node.title,
      anchorTimelinePointId: node.anchorTimelinePointId,
      body: node.body,
    }),
    "utf8",
  );
}

function manuscriptDirPath(
  rootDir: string,
  parentDirPath: string | null,
  index: number,
  id: string,
) {
  const base = parentDirPath ?? path.join(rootDir, MANUSCRIPT_DIR);
  return path.join(base, `${padOrder(index)}-${id}`);
}

function manuscriptTempDirPath(rootDir: string, parentDirPath: string | null, id: string) {
  const base = parentDirPath ?? path.join(rootDir, MANUSCRIPT_DIR);
  return path.join(base, `${TEMP_RENAME_PREFIX}new-${id}`);
}

function manuscriptDetachedDirPath(rootDir: string, id: string) {
  return path.join(rootDir, MANUSCRIPT_DIR, `${TEMP_RENAME_PREFIX}detached-${id}`);
}

function stageSiblingRenames(parentDir: string, siblings: ManuscriptNodeDiskState[]) {
  siblings.forEach((node, index) => {
    const stagedPath = path.join(parentDir, `${TEMP_RENAME_PREFIX}${index + 1}-${node.id}`);
    if (node.dirPath !== stagedPath) {
      fs.renameSync(node.dirPath, stagedPath);
      node.dirPath = stagedPath;
    }
  });
}

function finalizeSiblingRenames(
  rootDir: string,
  parentDirPath: string | null,
  siblings: ManuscriptNodeDiskState[],
) {
  siblings.forEach((node, index) => {
    node.order = index;
    node.parentId = siblings[index]?.parentId ?? node.parentId;
    const finalPath = manuscriptDirPath(rootDir, parentDirPath, index, node.id);
    if (node.dirPath !== finalPath) {
      fs.renameSync(node.dirPath, finalPath);
      node.dirPath = finalPath;
    }
    syncDescendantPaths(node);
    writeNodeMarkdown(node);
  });
}

function syncDescendantPaths(node: ManuscriptNodeDiskState) {
  node.children.forEach((child, index) => {
    child.parentId = node.id;
    child.order = index;
    child.dirPath = path.join(node.dirPath, `${padOrder(index)}-${child.id}`);
    syncDescendantPaths(child);
    writeNodeMarkdown(child);
  });
}

function writeManuscriptTree(rootDir: string, nodes: ManuscriptNodeDiskState[]) {
  const manuscriptRoot = path.join(rootDir, MANUSCRIPT_DIR);
  ensureDirSync(manuscriptRoot);
  for (const entry of fs.readdirSync(manuscriptRoot, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      fs.rmSync(path.join(manuscriptRoot, entry.name), { recursive: true, force: true });
    } else if (entry.isFile()) {
      fs.rmSync(path.join(manuscriptRoot, entry.name), { force: true });
    }
  }

  const writeNode = (
    node: ManuscriptNodeDiskState,
    parentDirPath: string | null,
    index: number,
  ) => {
    node.parentId = parentDirPath ? node.parentId : null;
    node.order = index;
    node.dirPath = manuscriptDirPath(rootDir, parentDirPath, index, node.id);
    ensureDirSync(node.dirPath);
    writeNodeMarkdown(node);
    node.children.forEach((child, childIndex) => {
      child.parentId = node.id;
      writeNode(child, node.dirPath, childIndex);
    });
  };

  nodes.forEach((node, index) => writeNode(node, null, index));
}

export async function writeWorktreeState(dir: string, state: WorktreeState) {
  await fs.promises.mkdir(path.join(dir, META_DIR), { recursive: true });
  await fs.promises.writeFile(
    path.join(dir, TIMELINE_FILE),
    stringifyJsonl(state.timeline),
    "utf8",
  );
  writeManuscriptTree(dir, state.content);
  await fs.promises.mkdir(path.join(dir, AUX_ORIGIN_DIR), { recursive: true });
}

export function writeWorktreeStateSync(dir: string, state: WorktreeState) {
  ensureDirSync(path.join(dir, META_DIR));
  fs.writeFileSync(path.join(dir, TIMELINE_FILE), stringifyJsonl(state.timeline), "utf8");
  writeManuscriptTree(dir, state.content);
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
    return [...state.content].sort(
      (left, right) => left.order - right.order || left.id.localeCompare(right.id),
    );
  }

  return [...findManuscriptNode(state, parentId).children].sort(
    (left, right) => left.order - right.order || left.id.localeCompare(right.id),
  );
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
  ensureDirSync(path.join(rootDir, MANUSCRIPT_DIR));
  const siblings = listManuscriptChildren(state, input.parentId);
  const insertIndex = input.afterSiblingId
    ? siblings.findIndex((sibling) => sibling.id === input.afterSiblingId) + 1
    : 0;
  if (input.afterSiblingId) {
    invariant(insertIndex > 0, "无法创建章节：目标位置不在同一个父级下。");
  }

  input.node.parentId = input.parentId;
  input.node.order = insertIndex;
  input.node.children = input.node.children ?? [];
  if (input.writeNodeImmediately ?? true) {
    input.node.dirPath = manuscriptTempDirPath(
      rootDir,
      input.parentId ? findManuscriptNode(state, input.parentId).dirPath : null,
      input.node.id,
    );
    writeNodeMarkdown(input.node);
  }

  if (input.parentId == null) {
    state.content.splice(insertIndex, 0, input.node);
    const topLevel = [...state.content];
    stageSiblingRenames(path.join(rootDir, MANUSCRIPT_DIR), topLevel);
    finalizeSiblingRenames(rootDir, null, topLevel);
    state.content = topLevel;
    return;
  }

  const parent = findManuscriptNode(state, input.parentId);
  parent.children.splice(insertIndex, 0, input.node);
  const updatedSiblings = [...parent.children];
  stageSiblingRenames(parent.dirPath, updatedSiblings);
  updatedSiblings.forEach((child) => {
    child.parentId = parent.id;
  });
  finalizeSiblingRenames(rootDir, parent.dirPath, updatedSiblings);
  parent.children = updatedSiblings;
}

function removeNodeFromTree(
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
  const node = findManuscriptNode(state, nodeId);
  const parentId = node.parentId;
  const removed = removeNodeFromTree(state.content, nodeId);
  invariant(removed, "未找到章节。");
  fs.rmSync(removed.dirPath, { recursive: true, force: true });

  if (parentId == null) {
    const topLevel = listManuscriptChildren(state, null);
    stageSiblingRenames(path.join(rootDir, MANUSCRIPT_DIR), topLevel);
    finalizeSiblingRenames(rootDir, null, topLevel);
    state.content = topLevel;
    return removed;
  }

  const parent = findManuscriptNode(state, parentId);
  const siblings = listManuscriptChildren(state, parentId);
  stageSiblingRenames(parent.dirPath, siblings);
  siblings.forEach((child) => {
    child.parentId = parent.id;
  });
  finalizeSiblingRenames(rootDir, parent.dirPath, siblings);
  parent.children = siblings;
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

  const oldParentId = node.parentId;
  const moved = removeNodeFromTree(state.content, input.nodeId);
  invariant(moved, "未找到章节。");
  const detachedPath = manuscriptDetachedDirPath(rootDir, moved.id);
  fs.rmSync(detachedPath, { recursive: true, force: true });
  fs.renameSync(moved.dirPath, detachedPath);
  moved.dirPath = detachedPath;

  if (oldParentId == null) {
    const topLevel = listManuscriptChildren(state, null);
    stageSiblingRenames(path.join(rootDir, MANUSCRIPT_DIR), topLevel);
    finalizeSiblingRenames(rootDir, null, topLevel);
    state.content = topLevel;
  } else {
    const oldParent = findManuscriptNode(state, oldParentId);
    const oldSiblings = listManuscriptChildren(state, oldParentId);
    stageSiblingRenames(oldParent.dirPath, oldSiblings);
    oldSiblings.forEach((child) => {
      child.parentId = oldParent.id;
    });
    finalizeSiblingRenames(rootDir, oldParent.dirPath, oldSiblings);
    oldParent.children = oldSiblings;
  }

  insertManuscriptNode(rootDir, state, {
    node: moved,
    parentId: input.newParentId,
    afterSiblingId: input.afterSiblingId,
    writeNodeImmediately: false,
  });

  return moved;
}
