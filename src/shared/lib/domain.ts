import { randomUUID } from "node:crypto";

export function createId(prefix: string) {
  return `${prefix}_${randomUUID()}`;
}

export function now() {
  return Date.now();
}

export function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
