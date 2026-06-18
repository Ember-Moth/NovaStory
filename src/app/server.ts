import { createRpcHandler } from "@codehz/rpc/server";
import { serve } from "bun";

import index from "@/app/client/index.html";
import { ensureAiCatalogFresh } from "@/modules/ai/domain/catalog";
import {
  handleProjectChatArchiveRequest,
  handleProjectChatDetailRequest,
  handleProjectChatRequest,
  handleProjectChatsRequest,
  handleProjectChatSelectionRequest,
  handleProjectChatStateRequest,
  handleProjectModelConfigRequest,
} from "@/modules/ai/server/project-chat/http";
import * as api from "@/rpc/router";

const server = serve({
  routes: {
    "/api/rpc": createRpcHandler(api, { batchConcurrency: 4 }),
    "/api/chat": {
      POST: handleProjectChatRequest,
    },
    "/api/chats": {
      GET: handleProjectChatsRequest,
      POST: handleProjectChatsRequest,
    },
    "/api/chats/:id": {
      GET: (request) => handleProjectChatDetailRequest(request, request.params.id),
      PUT: (request) => handleProjectChatDetailRequest(request, request.params.id),
      DELETE: (request) => handleProjectChatDetailRequest(request, request.params.id),
    },
    "/api/chats/:id/archive": {
      PUT: (request) => handleProjectChatArchiveRequest(request, request.params.id),
    },
    "/api/chats/:id/state": {
      GET: (request) => handleProjectChatStateRequest(request, request.params.id),
    },
    "/api/chats/:id/selection": {
      PUT: (request) => handleProjectChatSelectionRequest(request, request.params.id),
    },
    "/api/projects/:projectId/model-config": {
      GET: (request) => handleProjectModelConfigRequest(request, request.params.projectId),
      PUT: (request) => handleProjectModelConfigRequest(request, request.params.projectId),
    },
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
