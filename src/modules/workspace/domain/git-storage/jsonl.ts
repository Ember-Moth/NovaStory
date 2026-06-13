export function parseJsonl<T>(content: string | null | undefined): T[] {
  if (!content) return [];
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

export function stringifyJsonl(rows: readonly unknown[]) {
  return rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : "");
}
