import { expect, test } from "vitest";

import { hashBlob, hashCommit, hashTreeObject } from "./hash";

test("blob hash is deterministic and content-addressed", () => {
  expect(hashBlob("hello")).toBe(hashBlob("hello"));
  expect(hashBlob("hello")).not.toBe(hashBlob("world"));
  expect(hashBlob("")).toMatch(/^blob_[0-9a-f]{64}$/);
});

test("blob hash is not vulnerable to length-prefix ambiguity", () => {
  expect(hashBlob("a")).not.toBe(hashBlob(""));
  expect(hashBlob("12:ab")).not.toBe(hashBlob("ab"));
});

test("tree hash depends on kind, project and payload", () => {
  const base = { kind: "content_node", projectId: "p1", payloadJson: '{"a":1}' };
  expect(hashTreeObject(base)).toBe(hashTreeObject({ ...base }));
  expect(hashTreeObject(base)).not.toBe(hashTreeObject({ ...base, kind: "aux_node" }));
  expect(hashTreeObject(base)).not.toBe(hashTreeObject({ ...base, projectId: "p2" }));
  expect(hashTreeObject(base)).not.toBe(hashTreeObject({ ...base, payloadJson: '{"a":2}' }));
});

test("commit hash is order-independent over parents", () => {
  const base = {
    treeId: "tree_1",
    message: "init",
    author: "alice",
    committedAt: 1000,
    parentIds: ["commit_a", "commit_b"],
  };
  expect(hashCommit(base)).toBe(hashCommit({ ...base, parentIds: ["commit_b", "commit_a"] }));
  expect(hashCommit(base)).not.toBe(hashCommit({ ...base, parentIds: ["commit_a"] }));
  expect(hashCommit(base)).not.toBe(hashCommit({ ...base, committedAt: 1001 }));
  expect(hashCommit(base)).not.toBe(hashCommit({ ...base, author: null }));
});
