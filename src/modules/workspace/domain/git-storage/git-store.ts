import fs from "node:fs";
import path from "node:path";
import type { DiffEntry, FileRepository, SHA1, TreeEntry } from "nano-git";
import { walkLogEntries } from "nano-git/log";
import { initRepository, openRepository } from "nano-git/repository/file";
import { diffTrees, readTree } from "nano-git/repository/tree/tree-diff";
import { patchTree } from "nano-git/repository/tree/tree-patch";
import type { VirtualWorkdir } from "nano-git/workdir/core";
import { deleteSqliteVirtualWorkdir, openSqliteVirtualWorkdir } from "nano-git/workdir/sqlite";
import type { WorkingTreeStatus } from "@/modules/workspace/domain/types";
import { getProjectRepoGitDir } from "./paths";

export function branchRef(name: string) {
  return `refs/heads/${name}`;
}

export function metaRef() {
  return `refs/novel-evolver/meta`;
}

export function ensureProjectRepo(projectId: string) {
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

export function writeRef(input: { projectId: string; ref: string; value: SHA1 }) {
  const repo = getOrInitRepo(input.projectId);
  repo.updateRef(input.ref, input.value);
}

export function deleteRef(input: { projectId: string; ref: string }) {
  const repo = getOrInitRepo(input.projectId);
  // nano-git RefStore.delete throws if ref doesn't exist, so we catch
  try {
    repo.refs.delete(input.ref);
  } catch {
    // compatible with old { force: true } behavior
  }
}

export function writeTreeAtRef(input: {
  projectId: string;
  ref: string;
  files: Record<string, string>;
}): SHA1 {
  const repo = getOrInitRepo(input.projectId);
  const tree = writeTreeFromFiles(repo, input.files);
  repo.updateRef(input.ref, tree);
  return tree;
}

export function readTreeAtRef(input: { projectId: string; ref: string }): Record<string, string> {
  const repo = getOrInitRepo(input.projectId);
  const oid = repo.readRef(input.ref);
  if (!oid) return {};
  return readTreeFiles(repo, oid);
}

export function commitCustomRef(input: {
  projectId: string;
  ref: string;
  files?: Record<string, string>;
  filesToDelete?: string[];
  message: string;
  replace?: boolean;
}) {
  const repo = getOrInitRepo(input.projectId);
  // The ref stores a tree hash directly (written by repo.updateRef), not a commit.
  // Use it directly as the base for patchTree when !replace.
  const previous = repo.readRef(input.ref);
  const base: SHA1 = previous && !input.replace ? previous : repo.createTree([]);

  const ops: Array<
    { op: "upsert"; path: string; mode: string; hash: SHA1 } | { op: "delete"; path: string }
  > = [];

  if (input.files) {
    for (const [path, content] of Object.entries(input.files)) {
      ops.push({
        op: "upsert" as const,
        path,
        mode: "100644" as const,
        hash: repo.writeBlob(Buffer.from(content, "utf8")),
      });
    }
  }

  if (input.filesToDelete) {
    for (const path of input.filesToDelete) {
      ops.push({ op: "delete" as const, path });
    }
  }

  const { rootHash } = patchTree(repo.objects, base, ops);
  repo.updateRef(input.ref, rootHash);
  return rootHash;
}

export function readFileAtRef(input: { projectId: string; ref: string; filepath: string }) {
  const repo = getOrInitRepo(input.projectId);
  const oid = repo.readRef(input.ref);
  if (!oid) throw new Error(`Ref not found: ${input.ref}`);
  const entries = readTree(repo.objects, oid);
  const entry = entries.find((e) => e.path === input.filepath);
  if (!entry) throw new Error(`File not found: ${input.filepath}`);
  const obj = repo.catFile(entry.hash);
  if (obj.type !== "blob") throw new Error(`Expected blob, got ${obj.type}`);
  return obj.content.toString("utf8");
}

export function readFilesAtRef(input: { projectId: string; ref: string }) {
  const repo = getOrInitRepo(input.projectId);
  const oid = repo.readRef(input.ref);
  if (!oid) return {};
  return readTreeFiles(repo, oid);
}

export function readFilesAtCommit(input: { projectId: string; commitId: SHA1 }) {
  const repo = getOrInitRepo(input.projectId);
  const commit = repo.catFile(input.commitId);
  if (commit.type !== "commit") return {};
  return readTreeFiles(repo, commit.tree);
}

export function readCommitDiff(input: {
  projectId: string;
  previousCommitId: SHA1 | null;
  currentCommitId: SHA1;
}): DiffEntry[] {
  const repo = getOrInitRepo(input.projectId);
  const currentCommit = repo.catFile(input.currentCommitId);
  if (currentCommit.type !== "commit") {
    throw new Error(`Expected commit, got ${currentCommit.type}`);
  }

  const previousTree = input.previousCommitId
    ? (() => {
        const previousCommit = repo.catFile(input.previousCommitId);
        if (previousCommit.type !== "commit") {
          throw new Error(`Expected commit, got ${previousCommit.type}`);
        }
        return previousCommit.tree;
      })()
    : ensureEmptyTree(repo);

  return diffTrees(repo.objects, previousTree, currentCommit.tree);
}

export function readWorkdirDiff(workdir: VirtualWorkdir): DiffEntry[] {
  return workdir.diff();
}

export function readCommit(projectId: string, oid: SHA1) {
  const repo = getOrInitRepo(projectId);
  const obj = repo.catFile(oid);
  if (obj.type !== "commit") throw new Error(`Expected commit, got ${obj.type}`);
  return obj;
}

export function touchProjectRepo(projectId: string) {
  const gitdir = getProjectRepoGitDir(projectId);
  const now = new Date();
  fs.utimesSync(gitdir, now, now);
}

export function resolveRef(projectId: string, ref: string) {
  const repo = getOrInitRepo(projectId);
  return repo.readRef(ref);
}

/** 获取当前 HEAD 指向的分支名，无 HEAD 或 detached 时返回 null */
export function getCurrentBranch(projectId: string): string | null {
  const repo = getOrInitRepo(projectId);
  return repo.getCurrentBranch();
}

/** 设置 HEAD 指向指定的分支 */
export function setHeadRef(projectId: string, branchName: string): void {
  const repo = getOrInitRepo(projectId);
  repo.refs.write("HEAD", `ref: refs/heads/${branchName}`);
}

/** 列出 refs/heads/ 下所有分支名 */
export function listBranchNames(projectId: string): string[] {
  const repo = getOrInitRepo(projectId);
  return repo.refs
    .list("refs/heads/")
    .map((r) => r.slice("refs/heads/".length))
    .sort();
}

export function listLog(input: { projectId: string; ref: string; depth?: number }) {
  const repo = getOrInitRepo(input.projectId);
  const head = repo.readRef(input.ref);
  if (!head) return [];
  const entries = [...walkLogEntries(repo.objects, { from: [head], maxCount: input.depth })];
  return entries.map((entry) => ({
    oid: entry.hash,
    commit: {
      message: entry.commit.message,
      tree: entry.commit.tree,
      parent: entry.commit.parents,
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

function workdirCacheKey(projectId: string, workdirKey: string) {
  return `${projectId}:${workdirKey}`;
}

function workdirDbPath(projectId: string) {
  return path.join(getProjectRepoGitDir(projectId), "workdir.db");
}

/**
 * 通过 workdirKey 获取 VirtualWorkdir 实例。
 *
 * workdirKey 是不透明字符串（由 branch-map.json 维护），不依赖分支名。
 */
export function getWorkdirForBranch(
  projectId: string,
  workdirKey: string,
): VirtualWorkdir | undefined {
  const cached = workdirCache.get(workdirCacheKey(projectId, workdirKey));
  if (cached) return cached;

  const dbPath = workdirDbPath(projectId);
  if (fs.existsSync(dbPath)) {
    try {
      const repo = getOrInitRepo(projectId);
      const workdir = openSqliteVirtualWorkdir(repo.objects, dbPath, workdirKey, {
        baseTree: ensureEmptyTree(repo),
      });
      workdirCache.set(workdirCacheKey(projectId, workdirKey), workdir);
      return workdir;
    } catch {
      // SQLite 中没有该 key 的数据，返回 undefined
    }
  }

  return undefined;
}

/**
 * 创建或重置一个 workdirKey 对应的 VirtualWorkdir 实例（持久化到 SQLite）。
 *
 * @param workdirKey - 不透明 workdir key，不由分支名直接派生
 * @param baseTree - 基线 tree 哈希，不传则使用空树
 */
export function setWorkdirForBranch(
  projectId: string,
  workdirKey: string,
  baseTree?: SHA1,
): VirtualWorkdir {
  const repo = getOrInitRepo(projectId);
  const dbPath = workdirDbPath(projectId);

  const key = workdirCacheKey(projectId, workdirKey);
  const existing = workdirCache.get(key);
  if (existing) {
    const disp = existing as { [Symbol.dispose]?: () => void };
    disp[Symbol.dispose]?.();
    workdirCache.delete(key);
  }
  try {
    deleteSqliteVirtualWorkdir(dbPath, workdirKey);
  } catch {
    // 兼容：数据可能不存在
  }

  const workdir = openSqliteVirtualWorkdir(repo.objects, dbPath, workdirKey, {
    baseTree: baseTree ?? ensureEmptyTree(repo),
    create: true,
    walMode: true,
  });
  workdirCache.set(key, workdir);
  return workdir;
}

/**
 * 基于已有 commit 的 tree 创建 VirtualWorkdir。
 */
export function setWorkdirFromCommit(
  projectId: string,
  workdirKey: string,
  commitId: SHA1,
): VirtualWorkdir {
  const repo = getOrInitRepo(projectId);
  const commit = repo.catFile(commitId);
  if (commit.type !== "commit") {
    throw new Error(`Expected commit at ${commitId}, got ${commit.type}`);
  }
  return setWorkdirForBranch(projectId, workdirKey, commit.tree);
}

/**
 * 删除 workdirKey 对应的 VirtualWorkdir 实例（清理缓存 + SQLite 持久数据）。
 */
export function deleteWorkdirForBranch(projectId: string, workdirKey: string): void {
  const key = workdirCacheKey(projectId, workdirKey);
  const instance = workdirCache.get(key);
  if (instance) {
    const disp = instance as { [Symbol.dispose]?: () => void };
    disp[Symbol.dispose]?.();
    workdirCache.delete(key);
  }
  try {
    deleteSqliteVirtualWorkdir(workdirDbPath(projectId), workdirKey);
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
 * 将 DiffEntry[] 转换为 WorkingTreeStatus（适配器）。
 */
export function virtualDiffToStatus(_diff: DiffEntry[], _repo: FileRepository): WorkingTreeStatus {
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

// ---------------------------------------------------------------------------
// Branch name ↔ workdir key 映射
// 存储在 <gitdir>/branch-map.json，不进 git 对象/引用，纯本地状态。
// ---------------------------------------------------------------------------

function branchMapPath(projectId: string): string {
  return path.join(getProjectRepoGitDir(projectId), "branch-map.json");
}

function readBranchMap(projectId: string): Record<string, string> {
  try {
    const raw = fs.readFileSync(branchMapPath(projectId), "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function writeBranchMap(projectId: string, map: Record<string, string>): void {
  const filePath = branchMapPath(projectId);
  const tmpPath = `${filePath}.tmp`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(tmpPath, JSON.stringify(map), "utf8");
  fs.renameSync(tmpPath, filePath);
}

/** 生成一个不依赖分支名的稳定 workdir key */
export function generateWorkdirKey(): string {
  const buf = new Uint8Array(8);
  crypto.getRandomValues(buf);
  const hex = Array.from(buf)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `wd_${hex}`;
}

export function setBranchMapping(projectId: string, name: string, workdirKey: string): void {
  const map = readBranchMap(projectId);
  map[name] = workdirKey;
  writeBranchMap(projectId, map);
}

export function getBranchMapping(projectId: string, name: string): string | null {
  const map = readBranchMap(projectId);
  return map[name] ?? null;
}

export function deleteBranchMapping(projectId: string, name: string): void {
  const map = readBranchMap(projectId);
  if (name in map) {
    delete map[name];
    writeBranchMap(projectId, map);
  }
}

export function renameBranchMapping(projectId: string, oldName: string, newName: string): void {
  const map = readBranchMap(projectId);
  if (oldName in map) {
    map[newName] = map[oldName]!;
    delete map[oldName];
    writeBranchMap(projectId, map);
  }
}

export function listBranchMappings(projectId: string): string[] {
  const map = readBranchMap(projectId);
  return Object.keys(map).sort();
}
