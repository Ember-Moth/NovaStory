import { createRpcHandler } from "@codehz/rpc/server";
import { serve } from "bun";

import index from "@/app/client/index.html";
import { ensureAiCatalogFresh } from "@/modules/ai/domain/catalog";
import { rebuildVolatileCachesFromStorage } from "@/modules/workspace/domain/git-storage/restore-cache";
import * as api from "@/rpc/router";

import "@/db";

await rebuildVolatileCachesFromStorage().catch((error) => {
  console.error("Failed to rebuild volatile caches from storage:", error);
});

const server = serve({
  routes: {
    "/api/rpc": createRpcHandler(api, { batchConcurrency: 4 }),
    "/*": index,
  },

  idleTimeout: -1,

  development: process.env.NODE_ENV !== "production" && {
    hmr: true,
    console: true,
  },
});

console.log(`🚀 Server running at ${server.url}`);

void ensureAiCatalogFresh().catch((error) => {
  console.error("Failed to refresh AI catalog on startup:", error);
});
