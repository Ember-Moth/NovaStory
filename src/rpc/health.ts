export async function healthcheck(_input: undefined): Promise<{ data: "ok" }> {
  const data = "ok" as const;
  return { data };
}
