import { createRpcClient } from "@/lib/rpc/react/client";
import { ipcFetch } from "./ipc-transport";
import type * as api from "./router";

export const rpc = createRpcClient<typeof api>({
  queryCacheTime: 10 * 60 * 1000,
  fetch: ipcFetch,
});
