import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { deflateSync, inflateSync } from "node:zlib";

import git from "isomorphic-git";

import { getProjectRepoGitDir, getProjectWorktreeDir } from "./paths";
import { withProjectLock } from "./lock";

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

export function aiRunsRef() {
  return `refs/novel-evolver/ai-runs`;
}

export async function ensureProjectRepo(projectId: string) {
  const gitdir = getProjectRepoGitDir(projectId);
  await fs.promises.mkdir(gitdir, { recursive: true });
  if (!fs.existsSync(path.join(gitdir, "HEAD"))) {
    await git.init({ fs, gitdir, bare: true, defaultBranch: "main" });
  }
  return gitdir;
}

function ensureProjectRepoSync(projectId: string) {
  const gitdir = getProjectRepoGitDir(projectId);
  fs.mkdirSync(path.join(gitdir, "objects"), { recursive: true });
  fs.mkdirSync(path.join(gitdir, "refs"), { recursive: true });
  if (!fs.existsSync(path.join(gitdir, "HEAD"))) {
    fs.writeFileSync(path.join(gitdir, "HEAD"), "ref: refs/heads/main\n");
  }
  if (!fs.existsSync(path.join(gitdir, "config"))) {
    fs.writeFileSync(
      path.join(gitdir, "config"),
      "[core]\n\trepositoryformatversion = 0\n\tfilemode = false\n\tbare = true\n",
    );
  }
  return gitdir;
}

export function writeRefSync(input: { projectId: string; ref: string; value: string }) {
  const gitdir = ensureProjectRepoSync(input.projectId);
  const refPath = path.join(gitdir, input.ref);
  fs.mkdirSync(path.dirname(refPath), { recursive: true });
  fs.writeFileSync(refPath, `${input.value}\n`);
}

export function deleteRefSync(input: { projectId: string; ref: string }) {
  const gitdir = ensureProjectRepoSync(input.projectId);
  fs.rmSync(path.join(gitdir, input.ref), { force: true });
}

async function removeWorktreeGitFile(dir: string) {
  await fs.promises.rm(path.join(dir, ".git"), { force: true });
}

async function clearVersionedWorktreeFiles(dir: string) {
  await Promise.all(
    ["novel-evolver", "manuscript", "aux"].map((entry) =>
      fs.promises.rm(path.join(dir, entry), { recursive: true, force: true }),
    ),
  );
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
    await clearVersionedWorktreeFiles(dir);
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
    await clearVersionedWorktreeFiles(dir);
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

function readRefSync(gitdir: string, ref: string): string | null {
  const refPath = path.join(gitdir, ref);
  if (fs.existsSync(refPath)) {
    const value = fs.readFileSync(refPath, "utf8").trim();
    if (value.startsWith("ref: ")) {
      return readRefSync(gitdir, value.slice(5).trim());
    }
    return value || null;
  }

  const packedRefsPath = path.join(gitdir, "packed-refs");
  if (!fs.existsSync(packedRefsPath)) return null;
  for (const line of fs.readFileSync(packedRefsPath, "utf8").split("\n")) {
    if (!line || line.startsWith("#") || line.startsWith("^")) continue;
    const [oid, name] = line.trim().split(/\s+/, 2);
    if (name === ref && oid) return oid;
  }
  return null;
}

function readLooseObjectSync(gitdir: string, oid: string) {
  const objectPath = path.join(gitdir, "objects", oid.slice(0, 2), oid.slice(2));
  const inflated = inflateSync(fs.readFileSync(objectPath));
  const nulIndex = inflated.indexOf(0);
  if (nulIndex < 0) {
    throw new Error(`Invalid git object: ${oid}`);
  }
  const header = inflated.subarray(0, nulIndex).toString("utf8");
  const [type] = header.split(" ", 1);
  return { type, body: inflated.subarray(nulIndex + 1) };
}

function writeLooseObjectSync(gitdir: string, type: string, body: Buffer) {
  const header = Buffer.from(`${type} ${body.length}\0`, "utf8");
  const raw = Buffer.concat([header, body]);
  const oid = createHash("sha1").update(raw).digest("hex");
  const objectDir = path.join(gitdir, "objects", oid.slice(0, 2));
  const objectPath = path.join(objectDir, oid.slice(2));
  fs.mkdirSync(objectDir, { recursive: true });
  if (!fs.existsSync(objectPath)) {
    fs.writeFileSync(objectPath, deflateSync(raw));
  }
  return oid;
}

function readCommitTreeOidSync(gitdir: string, oid: string) {
  const object = readLooseObjectSync(gitdir, oid);
  if (object.type !== "commit") {
    throw new Error(`Expected commit object at ${oid}, got ${object.type}`);
  }
  const match = /^tree ([0-9a-f]{40})$/m.exec(object.body.toString("utf8"));
  if (!match?.[1]) {
    throw new Error(`Commit ${oid} is missing a tree`);
  }
  return match[1];
}

function readTreeFilesSync(input: {
  gitdir: string;
  treeOid: string;
  prefix?: string;
}): Record<string, string> {
  const object = readLooseObjectSync(input.gitdir, input.treeOid);
  if (object.type !== "tree") {
    throw new Error(`Expected tree object at ${input.treeOid}, got ${object.type}`);
  }

  const files: Record<string, string> = {};
  let offset = 0;
  while (offset < object.body.length) {
    const spaceIndex = object.body.indexOf(0x20, offset);
    const nulIndex = object.body.indexOf(0, spaceIndex + 1);
    if (spaceIndex < 0 || nulIndex < 0 || nulIndex + 21 > object.body.length) {
      throw new Error(`Invalid git tree object: ${input.treeOid}`);
    }
    const mode = object.body.subarray(offset, spaceIndex).toString("utf8");
    const entryPath = object.body.subarray(spaceIndex + 1, nulIndex).toString("utf8");
    const oid = object.body.subarray(nulIndex + 1, nulIndex + 21).toString("hex");
    const filepath = input.prefix ? `${input.prefix}/${entryPath}` : entryPath;

    if (mode === "40000" || mode === "040000") {
      Object.assign(
        files,
        readTreeFilesSync({ gitdir: input.gitdir, treeOid: oid, prefix: filepath }),
      );
    } else {
      const blob = readLooseObjectSync(input.gitdir, oid);
      if (blob.type === "blob") {
        files[filepath] = blob.body.toString("utf8");
      }
    }
    offset = nulIndex + 21;
  }

  return files;
}

function writeTreeFromFilesSync(gitdir: string, files: Record<string, string>): string {
  const { blobs, dirs } = splitTreeFiles(files);
  const entries: Buffer[] = [];

  for (const [filepath, content] of [...blobs.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const oid = writeLooseObjectSync(gitdir, "blob", Buffer.from(content, "utf8"));
    entries.push(
      Buffer.concat([Buffer.from(`100644 ${filepath}\0`, "utf8"), Buffer.from(oid, "hex")]),
    );
  }

  for (const [dirname, childFiles] of [...dirs.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const oid = writeTreeFromFilesSync(gitdir, childFiles);
    entries.push(
      Buffer.concat([Buffer.from(`40000 ${dirname}\0`, "utf8"), Buffer.from(oid, "hex")]),
    );
  }

  return writeLooseObjectSync(gitdir, "tree", Buffer.concat(entries));
}

export function commitCustomRefSync(input: {
  projectId: string;
  ref: string;
  files: Record<string, string>;
  message: string;
  replace?: boolean;
}) {
  const gitdir = ensureProjectRepoSync(input.projectId);
  const previous = readRefSync(gitdir, input.ref);
  const previousFiles =
    previous && !input.replace
      ? readTreeFilesSync({ gitdir, treeOid: readCommitTreeOidSync(gitdir, previous) })
      : {};
  const tree = writeTreeFromFilesSync(gitdir, { ...previousFiles, ...input.files });
  const timestamp = Math.floor(Date.now() / 1000);
  const parentLines = previous ? `parent ${previous}\n` : "";
  const commitBody = Buffer.from(
    [
      `tree ${tree}`,
      parentLines.trimEnd(),
      `author ${AUTHOR.name} <${AUTHOR.email}> ${timestamp} +0000`,
      `committer ${AUTHOR.name} <${AUTHOR.email}> ${timestamp} +0000`,
      "",
      input.message,
      "",
    ]
      .filter((line, index) => line || index === 4 || index === 6)
      .join("\n"),
    "utf8",
  );
  const oid = writeLooseObjectSync(gitdir, "commit", commitBody);
  const refPath = path.join(gitdir, input.ref);
  fs.mkdirSync(path.dirname(refPath), { recursive: true });
  fs.writeFileSync(refPath, `${oid}\n`);
  return oid;
}

export function readFilesAtRefSync(input: { projectId: string; ref: string }) {
  const gitdir = ensureProjectRepoSync(input.projectId);
  const oid = readRefSync(gitdir, input.ref);
  if (!oid) {
    throw new Error(`Git ref not found: ${input.ref}`);
  }
  return readTreeFilesSync({ gitdir, treeOid: readCommitTreeOidSync(gitdir, oid) });
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
