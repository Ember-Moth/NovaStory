import { createRpcHandler } from "@codehz/rpc";
import { serve } from "bun";

import * as api from "./api";
import "./db";
import index from "./index.html";

const server = serve({
  routes: {
    "/api/rpc": createRpcHandler(api),
    // Serve index.html for all unmatched routes.
    "/*": index,
  },

  development: process.env.NODE_ENV !== "production" && {
    // Enable browser hot reloading in development
    hmr: true,

    // Echo console logs from the browser to the server
    console: true,
  },
});

console.log(`🚀 Server running at ${server.url}`);
