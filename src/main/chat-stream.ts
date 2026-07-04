import { ipcMain } from "electron";
import { nanoid } from "nanoid";
import { handleProjectChatRequest } from "@/modules/ai/server/project-chat/http";

/**
 * 把 handleProjectChatRequest 适配为 IPC 流。
 * 渲染进程调用 chat:start，主进程启动 AI 流并逐 chunk 推送 chat:chunk:${id}，
 * 结束时推送 chat:end:${id}，出错时推送 chat:error:${id}。
 */
export function registerChatStreamHandler(): void {
  ipcMain.handle("chat:start", async (event, body: unknown) => {
    const streamId = nanoid();
    const wc = event.sender;

    const request = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    void (async () => {
      try {
        const response = await handleProjectChatRequest(request);
        if (!response.body) {
          wc.send(`chat:error:${streamId}`, "No response body");
          return;
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          wc.send(`chat:chunk:${streamId}`, decoder.decode(value, { stream: true }));
        }
        wc.send(`chat:end:${streamId}`);
      } catch (err) {
        wc.send(`chat:error:${streamId}`, err instanceof Error ? err.message : String(err));
      }
    })();

    return streamId;
  });
}
