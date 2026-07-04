declare global {
  interface Window {
    electronAPI: {
      invoke: (channel: string, args?: unknown) => Promise<unknown>;
      on: (channel: string, callback: (...args: unknown[]) => void) => () => void;
      once: (channel: string, callback: (...args: unknown[]) => void) => void;
    };
  }
}

export async function ipcFetch(_url: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const body = init?.body;
  if (!body) {
    return new Response(JSON.stringify([]), { status: 200 });
  }

  const batch = JSON.parse(typeof body === "string" ? body : await new Response(body).text()) as {
    key: string;
    input: unknown;
  }[];

  const results = await Promise.all(
    batch.map(async ({ key, input }) => {
      try {
        const result = await window.electronAPI.invoke(key, input);
        const { data, watch, invalidate } = result as {
          data: unknown;
          watch?: unknown[];
          invalidate?: unknown[];
        };
        return {
          ok: true,
          data,
          ...(watch ? { watch } : {}),
          ...(invalidate ? { invalidate } : {}),
        };
      } catch (err) {
        return {
          ok: false,
          error: {
            code: "INTERNAL_ERROR",
            status: 500,
            message: err instanceof Error ? err.message : String(err),
          },
        };
      }
    }),
  );

  return new Response(JSON.stringify(results), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
