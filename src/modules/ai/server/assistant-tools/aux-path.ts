import { basename, dirname } from "node:path/posix";

import { readAuxByPathAt } from "@/modules/workspace/domain";
import { invariant } from "@/shared/lib/domain";

import { requireNonEmptyString } from "./string-args";

export function normalizeAuxPath(path: string, actionLabel: string) {
  const normalized = requireNonEmptyString(path, `${actionLabel}时路径`);
  invariant(normalized.startsWith("/"), `${actionLabel}只支持以 / 开头的绝对路径。`);
  const segments = normalized.split("/").filter(Boolean);
  invariant(segments.length > 0, `${actionLabel}不能作用于辅助资料根目录。`);
  return `/${segments.join("/")}`;
}

export function splitAuxPath(path: string, actionLabel: string) {
  const normalizedPath = normalizeAuxPath(path, actionLabel);
  return {
    normalizedPath,
    parentPath: dirname(normalizedPath),
    name: basename(normalizedPath),
  };
}

export async function assertParentDirPath(input: {
  projectId: string;
  workspaceId: string;
  timelinePointId: string;
  parentPath: string;
  actionLabel: string;
}) {
  if (input.parentPath === "/") return "/";

  const parentNode = await readAuxByPathAt(
    input.projectId,
    input.workspaceId,
    input.timelinePointId,
    input.parentPath,
  );
  invariant(parentNode, `${input.actionLabel}失败：父目录不存在或在当前时间点不可见。`);
  invariant(parentNode.nodeType === "dir", `${input.actionLabel}失败：父路径不是辅助资料目录。`);
  return parentNode.path;
}

export async function resolveAuxNodeByPathOrThrow(input: {
  projectId: string;
  workspaceId: string;
  timelinePointId: string;
  path: string;
  actionLabel: string;
  followSymlinks?: boolean;
}) {
  const node = await readAuxByPathAt(
    input.projectId,
    input.workspaceId,
    input.timelinePointId,
    input.path,
    {
      followSymlinks: input.followSymlinks,
    },
  );
  invariant(node, `${input.actionLabel}失败：目标路径不存在或在当前时间点不可见。`);
  return node;
}
