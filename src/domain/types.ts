import type { InferSelectModel } from "drizzle-orm";

import type { schema } from "@/db";
import type { ORIGIN_TIMELINE_POINT_ID } from "@/shared/constants";

type AuxNodeRow = InferSelectModel<typeof schema.auxNodes>;

export type AiCatalogProviderRow = InferSelectModel<typeof schema.aiCatalogProviders>;
export type AiCatalogModelRow = InferSelectModel<typeof schema.aiCatalogModels>;
export type AiConnectionRow = InferSelectModel<typeof schema.aiConnections>;
export type AiConnectionCatalogOverrideRow = InferSelectModel<
  typeof schema.aiConnectionCatalogOverrides
>;
export type AiConnectionCustomModelRow = InferSelectModel<typeof schema.aiConnectionCustomModels>;
export type AiRegistryStateRow = InferSelectModel<typeof schema.aiRegistryState>;

export interface AiCatalogProviderView {
  id: string;
  name: string;
  sdkPackage: string | null;
  apiUrl: string | null;
  docsUrl: string | null;
  envKeys: string[];
  isActive: boolean;
  isSupported: boolean;
  modelCount: number;
}

export interface AiCatalogModelView {
  id: string;
  providerId: string;
  modelId: string;
  displayName: string;
  family: string | null;
  inputModalities: string[];
  outputModalities: string[];
  contextWindow: number | null;
  maxOutputTokens: number | null;
  supportsVision: boolean;
  supportsToolUse: boolean;
  supportsReasoning: boolean;
  supportsTemperature: boolean;
  inputPricePer1m: number | null;
  outputPricePer1m: number | null;
  isActive: boolean;
}

export interface AiSupportedSdkPackage {
  sdkPackage: string;
  label: string;
  providerFactoryId: string;
  requiresBaseUrl: boolean;
  allowsCustomEndpoint: boolean;
  supportsRegistryProvider: boolean;
}

export interface AiCatalogStatusView {
  lastAttemptAt: number | null;
  lastSuccessAt: number | null;
  lastError: string | null;
  contentHash: string | null;
  providerCount: number;
  activeProviderCount: number;
  modelCount: number;
  activeModelCount: number;
  isStale: boolean;
}

export interface AiResolvedModelView {
  id: string;
  connectionId: string;
  origin: "catalog" | "custom";
  sdkPackage: string;
  modelId: string;
  displayName: string;
  family: string | null;
  contextWindow: number | null;
  maxOutputTokens: number | null;
  supportsVision: boolean;
  supportsToolUse: boolean;
  supportsReasoning: boolean;
  supportsTemperature: boolean;
  inputPricePer1m: number | null;
  outputPricePer1m: number | null;
  isEnabled: boolean;
  catalogModelId: string | null;
  customModelId: string | null;
  isActive: boolean;
}

export type TimelinePointRef = string | null | undefined | typeof ORIGIN_TIMELINE_POINT_ID;
export type AuxNodeType = AuxNodeRow["nodeType"];

export interface TimelinePointView {
  id: string | typeof ORIGIN_TIMELINE_POINT_ID;
  key: string;
  label: string;
  description: string | null;
  prevPointId: string | typeof ORIGIN_TIMELINE_POINT_ID | null;
  isImplicitOrigin: boolean;
}

export interface ExportedContentNode {
  id: string;
  anchorTimelinePointId: string | typeof ORIGIN_TIMELINE_POINT_ID;
  kind: string | null;
  title: string | null;
  body: string | null;
  children: ExportedContentNode[];
}

export interface ExportedContentSubtree {
  rootNodeId: string;
  isWorkspaceRoot: boolean;
  nodes: ExportedContentNode[];
}

export interface ExportedAuxNode {
  id: string;
  nodeType: AuxNodeType;
  parentAuxNodeId: string | null;
  name: string | null;
  content: string | null;
  symlinkTargetAuxNodeId: string | null;
  symlinkTargetPath: string | null;
  timelinePointId: string | typeof ORIGIN_TIMELINE_POINT_ID;
  path: string;
  children: ExportedAuxNode[];
}

export interface ExportedAuxSnapshotTree {
  rootNodeId: string;
  timelinePointId: string | typeof ORIGIN_TIMELINE_POINT_ID;
  nodes: ExportedAuxNode[];
}

export interface AuxLayerChangeView {
  path: string;
  isDeleted: boolean;
}

export interface ResolvedAuxNode {
  id: string;
  nodeType: AuxNodeType;
  parentAuxNodeId: string | null;
  name: string | null;
  content: string | null;
  symlinkTargetAuxNodeId: string | null;
  timelinePointId: string | typeof ORIGIN_TIMELINE_POINT_ID;
  path: string;
}

export interface WritingContext {
  contentNode: ExportedContentNode;
  timelinePointId: string | typeof ORIGIN_TIMELINE_POINT_ID;
  auxSnapshot: ResolvedAuxNode[];
}

export interface ResolvedAuxSnapshotNode extends ResolvedAuxNode {
  reachable: boolean;
}
