import * as aiHandlers from "@/modules/ai/rpc";
import * as configHandlers from "@/modules/config/rpc";
import * as projectHandlers from "@/modules/projects/rpc";
import * as auxHandlers from "@/modules/workspace/rpc/aux";
import * as contentHandlers from "@/modules/workspace/rpc/content";
import * as timelineHandlers from "@/modules/workspace/rpc/timeline";
import * as workspaceHandlers from "@/modules/workspace/rpc/workspaces";

export { healthcheck } from "./health";

export const ai = {
  listSupportedSdkPackages: aiHandlers.listSupportedSdkPackages,
  getCatalogStatus: aiHandlers.getCatalogStatus,
  refreshCatalog: aiHandlers.refreshCatalog,
  listCatalogProviders: aiHandlers.listCatalogProviders,
  listCatalogModels: aiHandlers.listCatalogModels,
  listConnections: aiHandlers.listConnections,
  listEnabledConnectionModels: aiHandlers.listEnabledConnectionModels,
  createConnection: aiHandlers.createConnection,
  updateConnection: aiHandlers.updateConnection,
  deleteConnection: aiHandlers.deleteConnection,
  listResolvedModels: aiHandlers.listResolvedModels,
  setCatalogModelEnabled: aiHandlers.setCatalogModelEnabled,
  createCustomModel: aiHandlers.createCustomModel,
  updateCustomModel: aiHandlers.updateCustomModel,
  deleteCustomModel: aiHandlers.deleteCustomModel,
  getProjectAssistantState: aiHandlers.getProjectAssistantState,
  listProjectHeads: aiHandlers.listProjectHeads,
  getHeadMessages: aiHandlers.getHeadMessages,
  getMessageChildren: aiHandlers.getMessageChildren,
  createHead: aiHandlers.createHead,
  createProjectAssistantSession: aiHandlers.createProjectAssistantSession,
  setProjectAssistantActiveHead: aiHandlers.setProjectAssistantActiveHead,
  renameProjectHead: aiHandlers.renameProjectHead,
  appendMessage: aiHandlers.appendMessage,
  forkHeadFromMessage: aiHandlers.forkProjectHeadFromMessage,
  archiveHead: aiHandlers.archiveProjectHead,
  recordGenerationAttempt: aiHandlers.createGenerationAttempt,
  finishGenerationAttemptSuccess: aiHandlers.finishGenerationAttemptSuccess,
  finishGenerationAttemptError: aiHandlers.finishGenerationAttemptError,
  sendProjectAssistantMessage: aiHandlers.sendProjectAssistantMessage,
  retryProjectAssistantMessage: aiHandlers.retryProjectAssistantMessage,
};

export const config = {
  getAiAssistantModelSelection: configHandlers.getAiAssistantModelSelection,
  setAiAssistantModelSelection: configHandlers.setAiAssistantModelSelection,
};

export const projects = {
  list: projectHandlers.list,
  create: projectHandlers.create,
  update: projectHandlers.update,
  delete: projectHandlers.deleteMutation,
};

export const workspaces = {
  list: workspaceHandlers.list,
  default: workspaceHandlers.defaultWorkspace,
};

export const timeline = {
  list: timelineHandlers.list,
  create: timelineHandlers.create,
  move: timelineHandlers.move,
  delete: timelineHandlers.deleteMutation,
  update: timelineHandlers.update,
};

export const content = {
  create: contentHandlers.create,
  move: contentHandlers.move,
  update: contentHandlers.update,
  delete: contentHandlers.deleteMutation,
  exportSubtree: contentHandlers.exportSubtree,
  composeWritingContext: contentHandlers.composeWritingContext,
};

export const aux = {
  mkdir: auxHandlers.mkdir,
  writeFile: auxHandlers.writeFile,
  link: auxHandlers.link,
  move: auxHandlers.move,
  delete: auxHandlers.deleteMutation,
  restore: auxHandlers.restore,
  readById: auxHandlers.readById,
  readByPath: auxHandlers.readByPath,
  listDir: auxHandlers.listDir,
  snapshotTree: auxHandlers.snapshotTree,
  listChangesAt: auxHandlers.listChangesAt,
};
