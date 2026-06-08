import * as aiHandlers from "./ai";
import * as auxHandlers from "./aux";
import * as contentHandlers from "./content";
import * as projectHandlers from "./projects";
import * as timelineHandlers from "./timeline";
import * as workspaceHandlers from "./workspaces";

export { healthcheck } from "./health";

export const ai = {
  listSupportedSdkPackages: aiHandlers.listSupportedSdkPackages,
  getCatalogStatus: aiHandlers.getCatalogStatus,
  refreshCatalog: aiHandlers.refreshCatalog,
  listCatalogProviders: aiHandlers.listCatalogProviders,
  listCatalogModels: aiHandlers.listCatalogModels,
  listConnections: aiHandlers.listConnections,
  createConnection: aiHandlers.createConnection,
  updateConnection: aiHandlers.updateConnection,
  deleteConnection: aiHandlers.deleteConnection,
  listResolvedModels: aiHandlers.listResolvedModels,
  setCatalogModelEnabled: aiHandlers.setCatalogModelEnabled,
  createCustomModel: aiHandlers.createCustomModel,
  updateCustomModel: aiHandlers.updateCustomModel,
  deleteCustomModel: aiHandlers.deleteCustomModel,
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
