import fs from "node:fs";
import path from "node:path";

import { ORIGIN_TIMELINE_POINT_ID } from "@/modules/workspace/domain/constants";
import { createId, invariant } from "@/shared/lib/domain";

import { parseJsonl, stringifyJsonl } from "./jsonl";
import type { AuxLayerMetaRow, ContentMetaRow, TimelineMetaRow } from "./types";

export interface WorktreeState {
  content: ContentMetaRow[];
  timeline: TimelineMetaRow[];
  auxLayers: AuxLayerMetaRow[];
}

const META_DIR = "novel-evolver";
const CONTENT_FILE = `${META_DIR}/content.jsonl`;
const TIMELINE_FILE = `${META_DIR}/timeline.jsonl`;
const AUX_FILE = `${META_DIR}/aux-layers.jsonl`;

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

function encodeSegment(value: string) {
  return value
    .trim()
    .replace(/[\\/]+/g, "-")
    .replace(/[^a-zA-Z0-9._ -]+/g, "")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function bodyPathForNode(node: { id: string; title?: string | null; order?: number }) {
  const prefix = String((node.order ?? 0) + 1).padStart(3, "0");
  const label = encodeSegment(node.title ?? "") || node.id;
  return `manuscript/${prefix}-${label}.md`;
}

export function auxContentPath(layer: Pick<AuxLayerMetaRow, "timelinePointId" | "auxNodeId">) {
  const root = layer.timelinePointId ? `aux/timeline/${layer.timelinePointId}` : "aux/origin";
  return `${root}/${layer.auxNodeId}.md`;
}

export function readWorktreeState(dir: string): WorktreeState {
  return {
    content: parseJsonl<ContentMetaRow>(readTextSync(path.join(dir, CONTENT_FILE))),
    timeline: parseJsonl<TimelineMetaRow>(readTextSync(path.join(dir, TIMELINE_FILE))),
    auxLayers: parseJsonl<AuxLayerMetaRow>(readTextSync(path.join(dir, AUX_FILE))),
  };
}

export async function writeWorktreeState(dir: string, state: WorktreeState) {
  await fs.promises.mkdir(path.join(dir, META_DIR), { recursive: true });
  await fs.promises.writeFile(path.join(dir, CONTENT_FILE), stringifyJsonl(state.content), "utf8");
  await fs.promises.writeFile(
    path.join(dir, TIMELINE_FILE),
    stringifyJsonl(state.timeline),
    "utf8",
  );
  await fs.promises.writeFile(path.join(dir, AUX_FILE), stringifyJsonl(state.auxLayers), "utf8");
}

export function writeWorktreeStateSync(dir: string, state: WorktreeState) {
  ensureDirSync(path.join(dir, META_DIR));
  fs.writeFileSync(path.join(dir, CONTENT_FILE), stringifyJsonl(state.content), "utf8");
  fs.writeFileSync(path.join(dir, TIMELINE_FILE), stringifyJsonl(state.timeline), "utf8");
  fs.writeFileSync(path.join(dir, AUX_FILE), stringifyJsonl(state.auxLayers), "utf8");
}

export function seedEmptyWorktree(
  dir: string,
  input: { contentRootId: string; auxRootId: string },
) {
  ensureDirSync(dir);
  writeWorktreeStateSync(dir, {
    content: [
      {
        id: input.contentRootId,
        parentId: null,
        order: 0,
        title: null,
        bodyPath: null,
        anchorTimelinePointId: null,
      },
    ],
    timeline: [],
    auxLayers: [
      {
        id: createId("aux_layer"),
        auxNodeId: input.auxRootId,
        nodeType: "root",
        timelinePointId: null,
        isDeleted: false,
        parentAuxNodeId: null,
        name: null,
        contentPath: null,
        symlinkTargetAuxNodeId: null,
      },
    ],
  });
}

export function readContentBody(dir: string, node: ContentMetaRow) {
  return node.bodyPath ? readTextSync(path.join(dir, node.bodyPath)) : null;
}

export function writeContentBody(dir: string, node: ContentMetaRow, body: string | null) {
  if (!body) {
    if (node.bodyPath) fs.rmSync(path.join(dir, node.bodyPath), { force: true });
    node.bodyPath = null;
    return;
  }
  node.bodyPath = node.bodyPath ?? bodyPathForNode(node);
  ensureDirSync(path.dirname(path.join(dir, node.bodyPath)));
  fs.writeFileSync(path.join(dir, node.bodyPath), body, "utf8");
}

export function readAuxContent(dir: string, layer: AuxLayerMetaRow) {
  return layer.contentPath ? readTextSync(path.join(dir, layer.contentPath)) : null;
}

export function writeAuxContent(dir: string, layer: AuxLayerMetaRow, content: string | null) {
  if (content == null || layer.nodeType !== "file") {
    if (layer.contentPath) fs.rmSync(path.join(dir, layer.contentPath), { force: true });
    layer.contentPath = null;
    return;
  }
  layer.contentPath = layer.contentPath ?? auxContentPath(layer);
  ensureDirSync(path.dirname(path.join(dir, layer.contentPath)));
  fs.writeFileSync(path.join(dir, layer.contentPath), content, "utf8");
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
