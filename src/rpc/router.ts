import * as aiHandlers from "@/modules/ai/rpc";
import * as configHandlers from "@/modules/config/rpc";
import * as projectHandlers from "@/modules/projects/rpc";
import * as auxHandlers from "@/modules/workspace/rpc/aux";
import * as branchHandlers from "@/modules/workspace/rpc/branches";
import * as commitHandlers from "@/modules/workspace/rpc/commits";
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
  listGlobalPrompts: aiHandlers.listGlobalPrompts,
  createGlobalPrompt: aiHandlers.createGlobalPrompt,
  updateGlobalPrompt: aiHandlers.updateGlobalPrompt,
  deleteGlobalPrompt: aiHandlers.deleteGlobalPrompt,
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
};

export const config = {
  getAiAssistantModelSelection: configHandlers.getAiAssistantModelSelection,
  setAiAssistantModelSelection: configHandlers.setAiAssistantModelSelection,
  getAiAssistantMaxSteps: configHandlers.getAiAssistantMaxSteps,
  setAiAssistantMaxSteps: configHandlers.setAiAssistantMaxSteps,
};

export const projects = {
  list: projectHandlers.list,
  get: projectHandlers.get,
  create: projectHandlers.create,
  update: projectHandlers.update,
  setDefaultBranch: projectHandlers.setDefaultBranch,
  delete: projectHandlers.deleteMutation,
};

export const workspaces = {
  list: workspaceHandlers.list,
  default: workspaceHandlers.defaultWorkspace,
  get: workspaceHandlers.get,
};

export const branches = {
  list: branchHandlers.list,
  get: branchHandlers.get,
  heads: branchHandlers.heads,
  create: branchHandlers.create,
  delete: branchHandlers.deleteMutation,
};

export const commits = {
  history: commitHandlers.history,
  get: commitHandlers.get,
  diff: commitHandlers.diff,
  create: commitHandlers.create,
  checkout: commitHandlers.checkout,
  workingTreeStatus: commitHandlers.workingTreeStatus,
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
  revert: contentHandlers.revert,
};

export const aux = {
  mkdir: auxHandlers.mkdir,
  writeFile: auxHandlers.writeFile,
  link: auxHandlers.link,
  move: auxHandlers.move,
  retargetSymlink: auxHandlers.retargetSymlink,
  delete: auxHandlers.deleteMutation,
  restoreDeleted: auxHandlers.restoreDeleted,
  readByPath: auxHandlers.readByPath,
  listDir: auxHandlers.listDir,
  snapshotTree: auxHandlers.snapshotTree,
  listChangesAt: auxHandlers.listChangesAt,
};
