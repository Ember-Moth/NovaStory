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
