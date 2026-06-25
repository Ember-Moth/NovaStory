import fs from "node:fs";
import path from "node:path";

import { openRepository, initRepository } from "nano-git/repository/file";
import { openSqliteVirtualWorkdir, deleteSqliteVirtualWorkdir } from "nano-git/workdir/sqlite";
import { readTree } from "nano-git/repository/tree/tree-walk";
import { patchTree } from "nano-git/repository/tree/tree-patch";
import { walkLogEntries } from "nano-git/log";
import type { GitAuthor, GitCommit, SHA1, TreeEntry, FileRepository } from "nano-git";
import type { VirtualDiffEntry, VirtualWorkdir } from "nano-git/workdir/core";

import { getProjectRepoGitDir } from "./paths";
import type { WorkingTreeStatus } from "@/modules/workspace/domain/types";

const AUTHOR = {
  name: "NovelEvolver",
  email: "noreply@novel-evolver.local",
};

export function branchRef(branchId: string) {
  return `refs/heads/branch/${branchId}`;
}

export function metaRef() {
  return `refs/novel-evolver/meta`;
}

export function branchMetaRef(branchId: string) {
  return `refs/novel-evolver/branches/${branchId}/meta`;
}

export async function ensureProjectRepo(projectId: string) {
  // Delegated to getOrInitRepo — kept for backward compat
  getOrInitRepo(projectId);
  return getProjectRepoGitDir(projectId);
}

function splitTreeFiles(files: Record<string, string>) {
  const blobs = new Map<string, string>();
  const dirs = new Map<string, Record<string, string>>();

  for (const [filepath, content] of Object.entries(files)) {
    const [head, ...tail] = filepath.split("/");
    if (!head || filepath.includes("\\") || filepath.includes("..")) {
      throw new Error(`Unsafe git tree filepath: ${filepath}`);
    }
    if (tail.length === 0) {
      blobs.set(head, content);
    } else {
      const child = dirs.get(head) ?? {};
      child[tail.join("/")] = content;
      dirs.set(head, child);
    }
  }
  return { blobs, dirs };
}

function writeTreeFromFiles(repo: FileRepository, files: Record<string, string>): SHA1 {
  const { blobs, dirs } = splitTreeFiles(files);
  const entries: TreeEntry[] = [];

  for (const [filepath, content] of [...blobs.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const hash = repo.writeBlob(Buffer.from(content, "utf8"));
    entries.push({ mode: "100644", name: filepath, hash });
  }

  for (const [dirname, childFiles] of [...dirs.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const subTreeHash = writeTreeFromFiles(repo, childFiles);
    entries.push({ mode: "040000", name: dirname, hash: subTreeHash });
  }

  return repo.createTree(entries);
}

function readTreeFiles(repo: FileRepository, treeOid: SHA1): Record<string, string> {
  const files: Record<string, string> = {};
  const entries = readTree(repo.objects, treeOid);
  for (const entry of entries) {
    if (entry.mode === "040000") continue; // skip directories (tree entries)
    const obj = repo.catFile(entry.hash);
    if (obj.type === "blob") {
      files[entry.path] = obj.content.toString("utf8");
    }
  }
  return files;
}

export async function writeRef(input: { projectId: string; ref: string; value: string }) {
  const repo = getOrInitRepo(input.projectId);
  repo.updateRef(input.ref, input.value as SHA1);
}

export async function deleteRef(input: { projectId: string; ref: string }) {
  const repo = getOrInitRepo(input.projectId);
  // nano-git RefStore.delete throws if ref doesn't exist, so we catch
  try {
    repo.refs.delete(input.ref);
  } catch {
    // compatible with old { force: true } behavior
  }
}

export async function writeTreeAtRef(input: {
  projectId: string;
  ref: string;
  files: Record<string, string>;
}) {
  const repo = getOrInitRepo(input.projectId);
  const tree = writeTreeFromFiles(repo, input.files);
  repo.updateRef(input.ref, tree);
  return tree as string;
}

export async function readTreeAtRef(input: {
  projectId: string;
  ref: string;
}): Promise<Record<string, string>> {
  const repo = getOrInitRepo(input.projectId);
  const oid = repo.readRef(input.ref);
  if (!oid) return {};
  return readTreeFiles(repo, oid);
}

// ---------------------------------------------------------------------------
// Branch metadata (stored as individual blobs, one per branch)
// ---------------------------------------------------------------------------

export async function writeBranchMeta(
  projectId: string,
  branchId: string,
  data: Record<string, unknown>,
) {
  const repo = getOrInitRepo(projectId);
  const blob = Buffer.from(JSON.stringify(data), "utf8");
  const oid = repo.writeBlob(blob);
  repo.updateRef(branchMetaRef(branchId), oid);
}

export async function readBranchMeta<T = Record<string, unknown>>(
  projectId: string,
  branchId: string,
): Promise<T | null> {
  const repo = getOrInitRepo(projectId);
  const oid = repo.readRef(branchMetaRef(branchId));
  if (!oid) return null;
  const obj = repo.catFile(oid);
  if (obj.type !== "blob") return null;
  return JSON.parse(obj.content.toString("utf8")) as T;
}

export async function deleteBranchMeta(projectId: string, branchId: string) {
  await deleteRef({ projectId, ref: branchMetaRef(branchId) });
}

export async function listBranchMetaIds(projectId: string): Promise<string[]> {
  const repo = getOrInitRepo(projectId);
  const branchesDir = path.join(repo.gitDir, "refs", "novel-evolver", "branches");
  try {
    const entries = await fs.promises.readdir(branchesDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

export async function commitCustomRef(input: {
  projectId: string;
  ref: string;
  files: Record<string, string>;
  message: string;
  replace?: boolean;
}) {
  const repo = getOrInitRepo(input.projectId);
  const previous = repo.readRef(input.ref);
  const base: SHA1 =
    previous && !input.replace ? (repo.catFile(previous) as GitCommit).tree : repo.createTree([]);

  const ops = Object.entries(input.files).map(([path, content]) => ({
    op: "upsert" as const,
    path,
    mode: "100644" as const,
    hash: repo.writeBlob(Buffer.from(content, "utf8")),
  }));

  const { rootHash } = patchTree(repo.objects, base, ops);
  const timestamp = Math.floor(Date.now() / 1000);
  const author: GitAuthor = {
    name: AUTHOR.name,
    email: AUTHOR.email,
    timestamp,
    timezone: "+0000",
  };
  const commitHash = repo.createCommit(rootHash, previous ? [previous] : [], input.message, author);
  repo.updateRef(input.ref, commitHash);
  return commitHash as string;
}

export async function readFileAtRef(input: { projectId: string; ref: string; filepath: string }) {
  const repo = getOrInitRepo(input.projectId);
  const oid = repo.readRef(input.ref);
  if (!oid) throw new Error(`Ref not found: ${input.ref}`);
  const commit = repo.catFile(oid);
  if (commit.type !== "commit")
    throw new Error(`Expected commit at ${input.ref}, got ${commit.type}`);
  const entries = readTree(repo.objects, commit.tree);
  const entry = entries.find((e) => e.path === input.filepath);
  if (!entry) throw new Error(`File not found: ${input.filepath}`);
  const obj = repo.catFile(entry.hash);
  if (obj.type !== "blob") throw new Error(`Expected blob, got ${obj.type}`);
  return obj.content.toString("utf8");
}

export async function readFilesAtRef(input: { projectId: string; ref: string }) {
  const repo = getOrInitRepo(input.projectId);
  const oid = repo.readRef(input.ref);
  if (!oid) return {};
  const commit = repo.catFile(oid);
  if (commit.type !== "commit") return {};
  return readTreeFiles(repo, commit.tree);
}

export async function readFilesAtCommit(input: { projectId: string; commitId: string }) {
  const repo = getOrInitRepo(input.projectId);
  const commit = repo.catFile(input.commitId as SHA1);
  if (commit.type !== "commit") return {};
  return readTreeFiles(repo, commit.tree);
}

export async function readCommit(projectId: string, oid: string) {
  const repo = getOrInitRepo(projectId);
  const obj = repo.catFile(oid as SHA1);
  if (obj.type !== "commit") throw new Error(`Expected commit, got ${obj.type}`);
  return obj;
}

export async function touchProjectRepo(projectId: string) {
  const gitdir = getProjectRepoGitDir(projectId);
  const now = new Date();
  await fs.promises.utimes(gitdir, now, now);
}

export async function resolveRef(projectId: string, ref: string) {
  const repo = getOrInitRepo(projectId);
  return repo.readRef(ref) as string | null;
}

export async function listLog(input: { projectId: string; ref: string; depth?: number }) {
  const repo = getOrInitRepo(input.projectId);
  const head = repo.readRef(input.ref);
  if (!head) return [];
  const entries = [...walkLogEntries(repo.objects, { from: [head], maxCount: input.depth })];
  return entries.map((entry) => ({
    oid: entry.hash as string,
    commit: {
      message: entry.commit.message,
      tree: entry.commit.tree as string,
      parent: entry.commit.parents.map((p) => p as string),
      author: {
        name: entry.commit.author.name,
        email: entry.commit.author.email,
        timestamp: entry.commit.author.timestamp,
        timezoneOffset: 0,
      },
      committer: {
        name: entry.commit.committer.name,
        email: entry.commit.committer.email,
        timestamp: entry.commit.committer.timestamp,
        timezoneOffset: 0,
      },
    },
  }));
}

// ---------------------------------------------------------------------------
// Repo cache + lifecycle (originally in nano-git-store)
// ---------------------------------------------------------------------------

const repoCache = new Map<string, FileRepository>();

const EMPTY_TREE_HASH = "4b825dc642cb6eb9a060e54bf899d153036d1e7c" as SHA1;

/** 确保空 tree 对象存在于 objects 数据库中 */
function ensureEmptyTree(repo: FileRepository): SHA1 {
  if (repo.objects.exists(EMPTY_TREE_HASH)) return EMPTY_TREE_HASH;
  return repo.createTree([]);
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
