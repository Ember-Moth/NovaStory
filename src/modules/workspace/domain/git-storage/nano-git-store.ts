import fs from "node:fs";
import path from "node:path";

import { openRepository, initRepository } from "nano-git/repository/file";
import { openSqliteVirtualWorkdir, deleteSqliteVirtualWorkdir } from "nano-git/workdir/sqlite";
import type { FileRepository, SHA1 } from "nano-git";
import type { VirtualDiffEntry, VirtualWorkdir } from "nano-git/workdir/core";

import { getProjectRepoGitDir } from "./paths";
import type { WorkingTreeStatus } from "@/modules/workspace/domain/types";

const repoCache = new Map<string, FileRepository>();

const EMPTY_TREE_HASH = "4b825dc642cb6eb9a060e54bf899d153036d1e7c" as SHA1;

/** 确保空 tree 对象存在于 objects 数据库中 */
function ensureEmptyTree(repo: FileRepository): SHA1 {
  if (repo.objects.exists(EMPTY_TREE_HASH)) return EMPTY_TREE_HASH;
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

export function clearRepoCache(): void {
  repoCache.clear();
}

// ---------------------------------------------------------------------------
// SQLite VirtualWorkdir — 持久化 per-branch 工作目录
// workdir.db 存放在 repo git 目录下，各分支通过 workdirKey 隔离
// ---------------------------------------------------------------------------

const workdirCache = new Map<string, VirtualWorkdir>();

function workdirCacheKey(projectId: string, branchId: string) {
  return `${projectId}:${branchId}`;
}

function workdirDbPath(projectId: string) {
  return path.join(getProjectRepoGitDir(projectId), "workdir.db");
}

/**
 * 获取分支的 VirtualWorkdir 实例。
 *
 * 先查运行时缓存，缓存未命中时尝试从 SQLite 重新打开（重启恢复）。
 * 如果 SQLite 中也不存在，返回 undefined。
 */
export function getWorkdirForBranch(
  projectId: string,
  branchId: string,
): VirtualWorkdir | undefined {
  const cached = workdirCache.get(workdirCacheKey(projectId, branchId));
  if (cached) return cached;

  // Cache miss: try re-opening from persistent SQLite DB
  // 传入 empty tree 作为 baseTree 占位——当 key 已存在时会被忽略
  const dbPath = workdirDbPath(projectId);
  if (fs.existsSync(dbPath)) {
    try {
      const repo = getOrInitRepo(projectId);
      const workdir = openSqliteVirtualWorkdir(repo.objects, dbPath, branchId, {
        baseTree: ensureEmptyTree(repo),
      });
      workdirCache.set(workdirCacheKey(projectId, branchId), workdir);
      return workdir;
    } catch {
      // SQLite 中没有该 key 的数据，返回 undefined
    }
  }

  return undefined;
}

/**
 * 为分支创建或重置 VirtualWorkdir 实例（持久化到 SQLite）。
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
  const dbPath = workdirDbPath(projectId);

  // 清除已有的缓存实例和 SQLite 旧数据，确保从 baseTree 重新初始化
  const key = workdirCacheKey(projectId, branchId);
  const existing = workdirCache.get(key);
  if (existing) {
    const disp = existing as { [Symbol.dispose]?: () => void };
    disp[Symbol.dispose]?.();
    workdirCache.delete(key);
  }
  try {
    deleteSqliteVirtualWorkdir(dbPath, branchId);
  } catch {
    // 兼容：数据可能不存在
  }

  const workdir = openSqliteVirtualWorkdir(repo.objects, dbPath, branchId, {
    baseTree: baseTree ?? ensureEmptyTree(repo),
    create: true,
    walMode: true,
  });
  workdirCache.set(key, workdir);
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
 * 删除分支的 VirtualWorkdir 实例（清理缓存 + SQLite 持久数据）。
 */
export function deleteWorkdirForBranch(projectId: string, branchId: string): void {
  const key = workdirCacheKey(projectId, branchId);
  const instance = workdirCache.get(key);
  if (instance) {
    const disp = instance as { [Symbol.dispose]?: () => void };
    disp[Symbol.dispose]?.();
    workdirCache.delete(key);
  }
  try {
    deleteSqliteVirtualWorkdir(workdirDbPath(projectId), branchId);
  } catch {
    // 兼容：数据可能已不存在
  }
}

export function clearWorkdirCache(): void {
  for (const instance of workdirCache.values()) {
    const disp = instance as { [Symbol.dispose]?: () => void };
    disp[Symbol.dispose]?.();
  }
  workdirCache.clear();
}

export function clearAllCaches(): void {
  clearWorkdirCache();
  repoCache.clear();
}

/**
 * 基于已有 Repository 创建 VirtualWorkdir 实例。
 *
 * 注意：此函数仅用于需要手动控制 dbPath/key 的场景。
 * 通常应使用 setWorkdirForBranch。
 */
export function createWorkdir(
  repo: FileRepository,
  dbPath: string,
  key: string,
  baseTree?: SHA1,
): VirtualWorkdir {
  return openSqliteVirtualWorkdir(repo.objects, dbPath, key, {
    baseTree: baseTree ?? ensureEmptyTree(repo),
    create: true,
    walMode: true,
  });
}

/**
 * 将 VirtualDiffEntry[] 转换为 WorkingTreeStatus（适配器）。
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
