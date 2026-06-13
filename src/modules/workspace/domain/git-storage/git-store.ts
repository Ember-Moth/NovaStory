import fs from "node:fs";
import path from "node:path";

import git from "isomorphic-git";

import { getProjectRepoGitDir, getProjectWorktreeDir } from "./paths";
import { withProjectLock } from "./lock";

const AUTHOR = {
  name: "NovelEvolver",
  email: "noreply@novel-evolver.local",
};

export function toBranchRef(name: string) {
  const safe = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._/-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `refs/heads/${safe || "main"}`;
}

export function metaRef(projectId: string) {
  return `refs/novel-evolver/meta/${projectId}`;
}

export function aiRunsRef(projectId: string) {
  return `refs/novel-evolver/ai-runs/${projectId}`;
}

export async function ensureProjectRepo(projectId: string) {
  const gitdir = getProjectRepoGitDir(projectId);
  await fs.promises.mkdir(gitdir, { recursive: true });
  if (!fs.existsSync(path.join(gitdir, "HEAD"))) {
    await git.init({ fs, gitdir, bare: true, defaultBranch: "main" });
  }
  return gitdir;
}

async function removeWorktreeGitFile(dir: string) {
  await fs.promises.rm(path.join(dir, ".git"), { force: true });
}

export async function ensureWorktree(projectId: string, workspaceId: string) {
  const dir = getProjectWorktreeDir(projectId, workspaceId);
  await fs.promises.mkdir(dir, { recursive: true });
  await removeWorktreeGitFile(dir);
  return dir;
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
    const gitdir = await ensureProjectRepo(input.projectId);
    const dir = await ensureWorktree(input.projectId, input.workspaceId);
    await git.add({ fs, dir, gitdir, filepath: "." });
    const oid = await git.commit({
      fs,
      dir,
      gitdir,
      ref: input.branchRef,
      message: input.message,
      parent: input.parents,
      author: {
        name: input.author || AUTHOR.name,
        email: AUTHOR.email,
      },
      committer: AUTHOR,
    });
    await git.writeRef({ fs, gitdir, ref: input.branchRef, value: oid, force: true });
    return oid;
  });
}

export async function checkoutRefToWorktree(input: {
  projectId: string;
  workspaceId: string;
  ref: string;
}) {
  return withProjectLock(input.projectId, async () => {
    const gitdir = await ensureProjectRepo(input.projectId);
    const dir = await ensureWorktree(input.projectId, input.workspaceId);
    await git.checkout({ fs, dir, gitdir, ref: input.ref, force: true });
    await removeWorktreeGitFile(dir);
  });
}

export async function checkoutCommitToWorktree(input: {
  projectId: string;
  workspaceId: string;
  commitId: string;
}) {
  return withProjectLock(input.projectId, async () => {
    const gitdir = await ensureProjectRepo(input.projectId);
    const dir = await ensureWorktree(input.projectId, input.workspaceId);
    await git.checkout({ fs, dir, gitdir, ref: input.commitId, force: true });
    await removeWorktreeGitFile(dir);
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

async function writeTreeFromFiles(gitdir: string, files: Record<string, string>): Promise<string> {
  const { blobs, dirs } = splitTreeFiles(files);
  const tree = [];

  for (const [filepath, content] of [...blobs.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const oid = await git.writeBlob({ fs, gitdir, blob: Buffer.from(content, "utf8") });
    tree.push({ mode: "100644" as const, path: filepath, oid, type: "blob" as const });
  }

  for (const [dirname, childFiles] of [...dirs.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const oid = await writeTreeFromFiles(gitdir, childFiles);
    tree.push({ mode: "040000" as const, path: dirname, oid, type: "tree" as const });
  }

  return await git.writeTree({ fs, gitdir, tree });
}

async function readTreeFiles(input: {
  gitdir: string;
  treeOid: string;
  prefix?: string;
}): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  const { tree } = await git.readTree({ fs, gitdir: input.gitdir, oid: input.treeOid });

  for (const entry of tree) {
    const filepath = input.prefix ? `${input.prefix}/${entry.path}` : entry.path;
    if (entry.type === "tree") {
      Object.assign(
        files,
        await readTreeFiles({ gitdir: input.gitdir, treeOid: entry.oid, prefix: filepath }),
      );
      continue;
    }
    if (entry.type === "blob") {
      const { blob } = await git.readBlob({
        fs,
        gitdir: input.gitdir,
        oid: entry.oid,
      });
      files[filepath] = Buffer.from(blob).toString("utf8");
    }
  }

  return files;
}

export async function commitCustomRef(input: {
  projectId: string;
  ref: string;
  files: Record<string, string>;
  message: string;
  replace?: boolean;
}) {
  return withProjectLock(input.projectId, async () => {
    const gitdir = await ensureProjectRepo(input.projectId);
    const previous = await git.resolveRef({ fs, gitdir, ref: input.ref }).catch(() => undefined);
    const previousFiles =
      previous && !input.replace
        ? await git
            .readCommit({ fs, gitdir, oid: previous })
            .then(({ commit }) => readTreeFiles({ gitdir, treeOid: commit.tree }))
            .catch(() => ({}))
        : {};
    const tree = await writeTreeFromFiles(gitdir, { ...previousFiles, ...input.files });
    const timestamp = Math.floor(Date.now() / 1000);
    const oid = await git.writeCommit({
      fs,
      gitdir,
      commit: {
        message: input.message,
        tree,
        parent: previous ? [previous] : [],
        author: { ...AUTHOR, timestamp, timezoneOffset: 0 },
        committer: { ...AUTHOR, timestamp, timezoneOffset: 0 },
      },
    });
    await git.writeRef({ fs, gitdir, ref: input.ref, value: oid, force: true });
    return oid;
  });
}

export async function readFileAtRef(input: { projectId: string; ref: string; filepath: string }) {
  const gitdir = await ensureProjectRepo(input.projectId);
  const oid = await git.resolveRef({ fs, gitdir, ref: input.ref });
  const { commit } = await git.readCommit({ fs, gitdir, oid });
  const { blob } = await git.readBlob({ fs, gitdir, oid: commit.tree, filepath: input.filepath });
  return Buffer.from(blob).toString("utf8");
}

export async function readFilesAtRef(input: { projectId: string; ref: string }) {
  const gitdir = await ensureProjectRepo(input.projectId);
  const oid = await git.resolveRef({ fs, gitdir, ref: input.ref });
  const { commit } = await git.readCommit({ fs, gitdir, oid });
  return await readTreeFiles({ gitdir, treeOid: commit.tree });
}

export async function resolveRef(projectId: string, ref: string) {
  const gitdir = await ensureProjectRepo(projectId);
  return await git.resolveRef({ fs, gitdir, ref }).catch(() => null);
}

export async function listLog(input: { projectId: string; ref: string; depth?: number }) {
  const gitdir = await ensureProjectRepo(input.projectId);
  const head = await resolveRef(input.projectId, input.ref);
  if (!head) return [];
  return await git.log({ fs, gitdir, ref: input.ref, depth: input.depth });
}
