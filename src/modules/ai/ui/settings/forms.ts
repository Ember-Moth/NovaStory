import { type AiConnectionConfig, normalizeAiConnectionConfig } from "@/modules/ai/domain/config";

export interface ConnectionFormData {
  kind: "registry" | "custom";
  name: string;
  catalogProviderId: string | null;
  sdkPackage: string | null;
  baseUrl: string | null;
  apiKey: string | null;
  apiKeyChanged: boolean;
  config: AiConnectionConfig;
  isEnabled: boolean;
}

export interface CustomModelFormData {
  modelId: string;
  displayName: string;
  contextWindow: number | null;
  maxOutputTokens: number | null;
  supportsVision: boolean;
  supportsToolUse: boolean;
  supportsReasoning: boolean;
  supportsTemperature: boolean;
  inputPricePer1m: number | null;
  outputPricePer1m: number | null;
  isEnabled: boolean;
}

export function normalizeConnectionKind(kind: string | null | undefined): "registry" | "custom" {
  return kind === "custom" ? "custom" : "registry";
}

export function normalizeFormConnectionConfig(
  sdkPackage: string | null | undefined,
  config: AiConnectionConfig | null | undefined,
): AiConnectionConfig {
  if (!sdkPackage) return {};
  return normalizeAiConnectionConfig({ sdkPackage, config });
}
