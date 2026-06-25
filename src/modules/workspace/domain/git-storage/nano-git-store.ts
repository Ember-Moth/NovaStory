import fs from "node:fs";
import path from "node:path";

import { openRepository, initRepository } from "nano-git/repository/file";
import { createVirtualWorkdir } from "nano-git/workdir/memory";
import type { FileRepository, SHA1 } from "nano-git";
import type { VirtualDiffEntry, VirtualWorkdir } from "nano-git/workdir/core";

import { getProjectRepoGitDir } from "./paths";
import type { WorkingTreeStatus } from "@/modules/workspace/domain/types";

const repoCache = new Map<string, FileRepository>();

const EMPTY_TREE_HASH = "4b825dc642cb6eb9a060e54bf899d153036d1e7c" as SHA1;

/** 确保空 tree 对象存在于 objects 数据库中 */
function ensureEmptyTree(repo: FileRepository): SHA1 {
  if (repo.objects.exists(EMPTY_TREE_HASH)) return EMPTY_TREE_HASH;
  // 通过 createTree 写入空 tree 对象
  return repo.createTree([]);
}

function ensureObjectSubdirs(gitdir: string) {
  const objectsDir = path.join(gitdir, "objects");
  fs.mkdirSync(path.join(objectsDir, "pack"), { recursive: true });
  for (let i = 0; i < 256; i++) {
    const sub = i.toString(16).padStart(2, "0");
    fs.mkdirSync(path.join(objectsDir, sub), { recursive: true });
  }
}

/**
 * 获取或初始化项目的 bare git repository。
 * Repository 实例将被缓存，同一 projectId 返回同一实例。
 */
export function getOrInitRepo(projectId: string): FileRepository {
  const existing = repoCache.get(projectId);
  if (existing) return existing;

  const gitdir = getProjectRepoGitDir(projectId);
  fs.mkdirSync(gitdir, { recursive: true });

  const repo: FileRepository = (() => {
    if (!fs.existsSync(path.join(gitdir, "HEAD"))) {
      return initRepository(gitdir);
    }
    return openRepository(gitdir);
  })();

  ensureObjectSubdirs(gitdir);
  ensureEmptyTree(repo);
  repoCache.set(projectId, repo);
  return repo;
}

/**
 * 清除缓存的 Repository 实例。
 * 用于测试或手动释放资源。
 */
export function clearRepoCache(): void {
  repoCache.clear();
}

// ---------------------------------------------------------------------------
// VirtualWorkdir 生命周期管理（per active branch session）
// ---------------------------------------------------------------------------

const workdirCache = new Map<string, VirtualWorkdir>();

function workdirCacheKey(projectId: string, branchId: string) {
  return `${projectId}:${branchId}`;
}

/**
 * 获取分支当前的 VirtualWorkdir 实例。
 * 如果不存在，可以创建一个新的（基于空树或指定 tree）。
 */
export function getWorkdirForBranch(
  projectId: string,
  branchId: string,
): VirtualWorkdir | undefined {
  return workdirCache.get(workdirCacheKey(projectId, branchId));
}

/**
 * 为分支创建或重置 VirtualWorkdir 实例。
 *
 * @param projectId - 项目 ID
 * @param branchId - 分支 ID（同时也是 workspaceId）
 * @param baseTree - 基线 tree 哈希，不传则使用空树
 * @returns VirtualWorkdir 实例
 */
export function setWorkdirForBranch(
  projectId: string,
  branchId: string,
  baseTree?: SHA1,
): VirtualWorkdir {
  const repo = getOrInitRepo(projectId);
  const workdir = createWorkdir(repo, baseTree);
  workdirCache.set(workdirCacheKey(projectId, branchId), workdir);
  return workdir;
}

/**
 * 基于已有 commit 为分支创建 VirtualWorkdir。
 */
export function setWorkdirFromCommit(
  projectId: string,
  branchId: string,
  commitId: SHA1,
): VirtualWorkdir {
  const repo = getOrInitRepo(projectId);
  const commit = repo.catFile(commitId);
  if (commit.type !== "commit") {
    throw new Error(`Expected commit at ${commitId}, got ${commit.type}`);
  }
  return setWorkdirForBranch(projectId, branchId, commit.tree);
}

/**
 * 删除分支的 VirtualWorkdir 实例。
 */
export function deleteWorkdirForBranch(projectId: string, branchId: string): void {
  workdirCache.delete(workdirCacheKey(projectId, branchId));
}

/**
 * 清除所有缓存的 VirtualWorkdir 实例（测试用）。
 */
export function clearWorkdirCache(): void {
  workdirCache.clear();
}

/** 清除所有缓存（repo + workdir）。测试用。 */
export function clearAllCaches(): void {
  repoCache.clear();
  workdirCache.clear();
}

/**
 * 基于已有 Repository 创建 VirtualWorkdir 实例。
 *
 * @param repo - FileRepository 实例
 * @param baseTree - 基线 tree 哈希，默认为空树
 * @returns VirtualWorkdir 实例
 */
export function createWorkdir(repo: FileRepository, baseTree?: SHA1) {
  return createVirtualWorkdir(repo.objects, {
    baseTree: baseTree ?? ensureEmptyTree(repo),
  });
}

/**
 * 将 VirtualDiffEntry[] 转换为 WorkingTreeStatus（适配器）。
 *
 * 当前为桩实现，Phase 2 将实现完整逻辑。
 */
export function virtualDiffToStatus(
  _diff: VirtualDiffEntry[],
  _repo: FileRepository,
): WorkingTreeStatus {
  return {
    hasChanges: false,
    headCommitId: null,
    areas: {
      content: { changed: false, changes: [] },
      timeline: { changed: false, changes: [] },
      aux: { changed: false, changes: [] },
    },
  };
}
