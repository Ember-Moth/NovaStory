import type { SHA1 } from "nano-git";

import { readFilesAtCommit } from "./git-storage/git-store";
import { flattenManuscriptNodes, readWorktreeStateFromFiles } from "./git-storage/worktree-state";
import { getCommit } from "./commits";
import { areaForPath, compareContentStates } from "./working-tree-status";
import type { CommitDiff, WorkingTreePathChangeItem } from "./types";

function pathChangeKind(
  previous: string | undefined,
  next: string | undefined,
): WorkingTreePathChangeItem["kind"] | null {
  if (previous === undefined && next !== undefined) return "added";
  if (previous !== undefined && next === undefined) return "deleted";
  if (previous !== next) return "modified";
  return null;
}

/**
 * 计算单个 commit 相对其首个父提交（根提交则相对空树）的语义化差异。
 *
 * 正文（manuscript / index.jsonl）走与「未提交变更」一致的结构化对比，
 * 输出章节级别的新增 / 修改 / 删除以及标题、锚点、字数增减等细节；
 * 时间线与辅助信息按文件路径粒度对比。
 */
export async function getCommitDiff(projectId: string, commitId: string): Promise<CommitDiff> {
  const commit = await getCommit(commitId, projectId);
  const baseCommitId = commit.parents[0]?.parentId ?? null;
  const isRoot = baseCommitId == null;

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

  areas.content.changes = compareContentStates(
    flattenManuscriptNodes(previousState),
    flattenManuscriptNodes(nextState),
    previousState.timeline,
    nextState.timeline,
  );

  const allPaths = [...new Set([...Object.keys(previousFiles), ...Object.keys(nextFiles)])];
  for (const filepath of allPaths) {
    const areaKey = areaForPath(filepath);
    // 正文区域由 compareContentStates 统一处理，这里跳过其底层文件。
    if (areaKey === "content") {
      continue;
    }
    const kind = pathChangeKind(previousFiles[filepath], nextFiles[filepath]);
    if (!kind) {
      continue;
    }
    areas[areaKey].changes.push({ label: filepath, kind });
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
