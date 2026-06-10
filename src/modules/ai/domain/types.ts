import type { InferSelectModel } from "drizzle-orm";

import type { schema } from "@/db";

export type AiCatalogProviderRow = InferSelectModel<typeof schema.aiCatalogProviders>;
export type AiCatalogModelRow = InferSelectModel<typeof schema.aiCatalogModels>;
export type AiConnectionRow = InferSelectModel<typeof schema.aiConnections>;
export type AiConnectionCatalogOverrideRow = InferSelectModel<
  typeof schema.aiConnectionCatalogOverrides
>;
export type AiConnectionCustomModelRow = InferSelectModel<typeof schema.aiConnectionCustomModels>;
export type AiRegistryStateRow = InferSelectModel<typeof schema.aiRegistryState>;
export type AiProjectMessageRow = InferSelectModel<typeof schema.aiProjectMessages>;
export type AiProjectHeadRow = InferSelectModel<typeof schema.aiProjectHeads>;
export type AiProjectAssistantStateRow = InferSelectModel<typeof schema.aiProjectAssistantState>;
export type AiProjectGenerationAttemptRow = InferSelectModel<
  typeof schema.aiProjectGenerationAttempts
>;

export type AiProjectMessageRole = "system" | "user" | "assistant" | "tool";
export type AiGenerationAttemptStatus = "pending" | "success" | "error";
export type AiSelectionSnapshotOrigin = "catalog" | "custom";

export interface AiSelectionCapabilitySnapshot {
  supportsVision: boolean;
  supportsToolUse: boolean;
  supportsReasoning: boolean;
  supportsTemperature: boolean;
}

export interface AiSelectionPricingSnapshot {
  inputPricePer1m: number | null;
  outputPricePer1m: number | null;
}

export interface AiSelectionSnapshotInput {
  connectionId?: string | null;
  catalogModelId?: string | null;
  customModelId?: string | null;
  connectionName?: string | null;
  sdkPackage?: string | null;
  baseUrl?: string | null;
  modelOrigin?: AiSelectionSnapshotOrigin | null;
  modelId?: string | null;
  modelDisplayName?: string | null;
  modelFamily?: string | null;
  capabilities?: Partial<AiSelectionCapabilitySnapshot> | null;
  pricing?: Partial<AiSelectionPricingSnapshot> | null;
}

export interface AiSelectionSnapshotView {
  connectionId: string | null;
  catalogModelId: string | null;
  customModelId: string | null;
  connectionName: string | null;
  sdkPackage: string | null;
  baseUrl: string | null;
  modelOrigin: AiSelectionSnapshotOrigin | null;
  modelId: string | null;
  modelDisplayName: string | null;
  modelFamily: string | null;
  capabilities: AiSelectionCapabilitySnapshot | null;
  pricing: AiSelectionPricingSnapshot | null;
}

export interface AiProjectMessageView {
  id: string;
  projectId: string;
  prevMessageId: string | null;
  role: AiProjectMessageRole;
  content: unknown;
  summaryText: string | null;
  selection: AiSelectionSnapshotView;
  metadata: unknown | null;
  createdAt: number;
}

export interface AiProjectHeadView {
  id: string;
  projectId: string;
  name: string;
  currentMessageId: string | null;
  forkedFromHeadId: string | null;
  forkedFromMessageId: string | null;
  isArchived: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface AiProjectAssistantStateView {
  projectId: string;
  activeHeadId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface AiProjectGenerationAttemptView {
  id: string;
  projectId: string;
  headId: string | null;
  triggerMessageId: string | null;
  assistantMessageId: string | null;
  status: AiGenerationAttemptStatus;
  request: unknown;
  usage: unknown | null;
  error: unknown | null;
  selection: AiSelectionSnapshotView;
  createdAt: number;
  completedAt: number | null;
}

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
