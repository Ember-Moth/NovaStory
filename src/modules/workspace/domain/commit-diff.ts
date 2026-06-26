import type { SHA1 } from "nano-git";

import { readCommitDiff, readFilesAtCommit } from "./git-storage/git-store";
import { flattenManuscriptNodes, readWorktreeStateFromFiles } from "./git-storage/worktree-state";
import { getCommit } from "./commits";
import {
  buildStructuredAuxChangeFromDiffEntry,
  compareContentStatesForDiff,
  didContentPathsChange,
  didTimelinePathChange,
  compareTimelineStates,
  diffEntryPathKind,
  resolveAuxChangeTimelineLabel,
  shouldIgnoreAuxDiffPath,
} from "./working-tree-status";
import type { CommitDiff } from "./types";

/**
 * 计算单个 commit 相对其首个父提交（根提交则相对空树）的语义化差异。
 *
 * 正文（manuscript / index.jsonl）走与「未提交变更」一致的结构化对比，
 * 输出章节级别的新增 / 修改 / 删除以及标题、锚点、字数增减等细节；
 * 时间线同样走结构化对比；辅助信息仍按文件路径粒度对比。
 */
export async function getCommitDiff(projectId: string, commitId: string): Promise<CommitDiff> {
  const commit = await getCommit(commitId, projectId);
  const baseCommitId = commit.parents[0]?.parentId ?? null;
  const isRoot = baseCommitId == null;
  const pathDiff = readCommitDiff({
    projectId,
    previousCommitId: baseCommitId as SHA1 | null,
    currentCommitId: commitId as SHA1,
  });

  const nextFiles = readFilesAtCommit({ projectId, commitId: commitId as SHA1 });
  const previousFiles = baseCommitId
    ? readFilesAtCommit({ projectId, commitId: baseCommitId as SHA1 })
    : {};

  const previousState = readWorktreeStateFromFiles(previousFiles);
  const nextState = readWorktreeStateFromFiles(nextFiles);

  const areas: CommitDiff["areas"] = {
    content: { changed: false, changes: [] },
    timeline: { changed: false, changes: [] },
    aux: { changed: false, changes: [] },
  };

  if (didContentPathsChange(pathDiff)) {
    areas.content.changes = compareContentStatesForDiff(
      pathDiff,
      flattenManuscriptNodes(previousState),
      flattenManuscriptNodes(nextState),
      previousState.timeline,
      nextState.timeline,
    );
  }
  if (didTimelinePathChange(pathDiff)) {
    areas.timeline.changes = compareTimelineStates(
      previousState.timeline,
      nextState.timeline,
      flattenManuscriptNodes(nextState),
      Object.keys(nextFiles),
    );
  }
  const timelinePointNameMap = new Map(nextState.timeline.map((point) => [point.id, point.label]));

  for (const entry of pathDiff) {
    const filepath = entry.path;
    if (!filepath.startsWith("aux/") && !filepath.startsWith("novel-evolver/aux")) {
      continue;
    }
    if (shouldIgnoreAuxDiffPath(filepath)) {
      continue;
    }
    const kind = diffEntryPathKind(entry);
    if (!kind) {
      continue;
    }
    const structuredChange = buildStructuredAuxChangeFromDiffEntry(entry);
    if (structuredChange.path.length === 0) {
      continue;
    }
    areas.aux.changes.push({
      ...resolveAuxChangeTimelineLabel(structuredChange, timelinePointNameMap),
      kind,
    });
  }

  for (const area of Object.values(areas)) {
    area.changes.sort((a, b) => a.label.localeCompare(b.label));
    area.changed = area.changes.length > 0;
  }

  return {
    commitId,
    baseCommitId,
    isRoot,
    hasChanges: Object.values(areas).some((area) => area.changed),
    areas,
  };
}
