import fs from "node:fs";
import path from "node:path";

import { getProjectRepoGitDir, getProjectWorktreeDir } from "./paths";
import { withProjectLock } from "./lock";
import { getOrInitRepo } from "./nano-git-store";
import type { GitAuthor, GitCommit, SHA1, TreeEntry, FileRepository } from "nano-git";
import { readTree } from "nano-git/repository/tree/tree-walk";
import { patchTree } from "nano-git/repository/tree/tree-patch";
import { walkLogEntries } from "nano-git/log";

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

function readPhysicalWorktreeFiles(dir: string): Record<string, string> {
  const files: Record<string, string> = {};
  function walk(prefix: string, currentDir: string) {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      if (entry.name === ".git") continue;
      const fullPath = path.join(currentDir, entry.name);
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isFile()) {
        files[relPath] = fs.readFileSync(fullPath, "utf8");
      } else if (entry.isDirectory()) {
        walk(relPath, fullPath);
      }
    }
  }
  walk("", dir);
  return files;
}

export async function addAllAndCommit(input: {
  projectId: string;
  workspaceId: string;
  branchRef: string;
  message: string;
  author?: string | null;
  parents?: string[];
}) {
  return withProjectLock(input.projectId, async () => {
    const repo = getOrInitRepo(input.projectId);
    const dir = getProjectWorktreeDir(input.projectId, input.workspaceId);
    const files = readPhysicalWorktreeFiles(dir);
    const tree = writeTreeFromFiles(repo, files);
    const timestamp = Math.floor(Date.now() / 1000);
    const author: GitAuthor = {
      name: input.author || AUTHOR.name,
      email: AUTHOR.email,
      timestamp,
      timezone: "+0000",
    };
    const parentHashes = (input.parents ?? []) as SHA1[];
    const commitHash = repo.createCommit(tree, parentHashes, input.message, author);
    repo.updateRef(input.branchRef, commitHash);
    return commitHash as string;
  });
}

function writeTreeToDirectory(repo: FileRepository, treeHash: SHA1, dir: string) {
  // Clear existing versioned files
  for (const entry of ["index.jsonl", "timeline.jsonl", "manuscript", "aux"]) {
    fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
  }

  // Write all tree entries to disk
  const entries = readTree(repo.objects, treeHash);
  for (const entry of entries) {
    if (entry.mode === "040000") continue; // skip directories
    const filePath = path.join(dir, entry.path);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const obj = repo.catFile(entry.hash);
    if (obj.type === "blob") {
      fs.writeFileSync(filePath, obj.content);
    }
  }

  // Ensure aux directories exist
  fs.mkdirSync(path.join(dir, "aux", "origin"), { recursive: true });
  fs.mkdirSync(path.join(dir, "aux", "timeline"), { recursive: true });
}

export async function checkoutRefToWorktree(input: {
  projectId: string;
  workspaceId: string;
  ref: string;
}) {
  return withProjectLock(input.projectId, async () => {
    const repo = getOrInitRepo(input.projectId);
    const dir = getProjectWorktreeDir(input.projectId, input.workspaceId);
    fs.mkdirSync(dir, { recursive: true });

    const commitOid = repo.readRef(input.ref);
    if (!commitOid) return;
    const commit = repo.catFile(commitOid);
    if (commit.type !== "commit") return;
    writeTreeToDirectory(repo, commit.tree, dir);
  });
}

export async function checkoutCommitToWorktree(input: {
  projectId: string;
  workspaceId: string;
  commitId: string;
}) {
  return withProjectLock(input.projectId, async () => {
    const repo = getOrInitRepo(input.projectId);
    const dir = getProjectWorktreeDir(input.projectId, input.workspaceId);
    fs.mkdirSync(dir, { recursive: true });

    const commit = repo.catFile(input.commitId as SHA1);
    if (commit.type !== "commit") return;
    writeTreeToDirectory(repo, commit.tree, dir);
  });
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
  return withProjectLock(input.projectId, async () => {
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
    const commitHash = repo.createCommit(
      rootHash,
      previous ? [previous] : [],
      input.message,
      author,
    );
    repo.updateRef(input.ref, commitHash);
    return commitHash as string;
  });
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
