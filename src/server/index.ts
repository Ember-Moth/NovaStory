import { createRpcHandler } from "@codehz/rpc/server";
import { serve } from "bun";

import index from "@/client/index.html";
import { ensureAiCatalogFresh } from "@/domain/ai-catalog";
import * as api from "@/server/rpc";

import "@/db";

const server = serve({
  routes: {
    "/api/rpc": createRpcHandler(api, { batchConcurrency: 4 }),
    "/*": index,
  },

  development: process.env.NODE_ENV !== "production" && {
    hmr: true,
    console: true,
  },
});

console.log(`🚀 Server running at ${server.url}`);

void ensureAiCatalogFresh().catch((error) => {
  console.error("Failed to refresh AI catalog on startup:", error);
});
