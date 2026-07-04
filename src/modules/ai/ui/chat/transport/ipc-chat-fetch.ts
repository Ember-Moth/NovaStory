/**
 * 把 /api/chat 的 POST 请求拦截，改用 Electron IPC 传输 AI 流。
 *
 * 调用流程：
 * 1. ipcRenderer.invoke('chat:start', body) → 返回 streamId
 * 2. 监听 'chat:chunk:${streamId}' 事件，逐块填充 ReadableStream
 * 3. 监听 'chat:end:${streamId}' 关闭流
 * 4. 返回伪 Response 给 Vercel AI SDK useChat
 */
export async function ipcChatFetch(url: string, init?: RequestInit): Promise<Response> {
  const body = init?.body;
  const parsed = body
    ? JSON.parse(typeof body === "string" ? body : await new Response(body).text())
    : {};

  const streamId = (await window.electronAPI.invoke("chat:start", parsed)) as string;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();

      const removeChunk = window.electronAPI.on(`chat:chunk:${streamId}`, (chunk: unknown) => {
        controller.enqueue(encoder.encode(chunk as string));
      });

      window.electronAPI.once(`chat:end:${streamId}`, () => {
        removeChunk();
        controller.close();
      });

      window.electronAPI.once(`chat:error:${streamId}`, (err: unknown) => {
        removeChunk();
        controller.error(new Error(String(err)));
      });
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}
