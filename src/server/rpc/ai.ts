import { type MutationCtx, mutation, query } from "@codehz/rpc";
import { type InferInsertModel, and, eq } from "drizzle-orm";

import { db, schema } from "@/db";
import {
  assertConnectionSupportsCustomModel,
  ensureAiCatalogFresh,
  getAiCatalogStatus,
  listCatalogModelsView,
  listCatalogProvidersView,
  listResolvedModelsForConnection,
  refreshAiCatalog,
} from "@/domain/ai-catalog";
import { SUPPORTED_AI_SDK_PACKAGES, getAiSdkPackageRecipe } from "@/domain/ai-packages";
import { createId, invariant, now } from "@/domain/internal/ids";
import type {
  AiCatalogModelView,
  AiCatalogProviderView,
  AiCatalogStatusView,
  AiConnectionRow,
  AiResolvedModelView,
  AiSupportedSdkPackage,
} from "@/domain/types";

type ConnectionInsert = InferInsertModel<typeof schema.aiConnections>;
type CustomModelInsert = InferInsertModel<typeof schema.aiConnectionCustomModels>;
type CustomModelRow = typeof schema.aiConnectionCustomModels.$inferSelect;

interface CreateRegistryConnectionInput {
  kind: "registry";
  name: string;
  catalogProviderId: string;
  baseUrl?: string | null;
  apiKey?: string | null;
  isEnabled?: boolean;
}

interface CreateCustomConnectionInput {
  kind: "custom";
  name: string;
  sdkPackage: string;
  baseUrl?: string | null;
  apiKey?: string | null;
  isEnabled?: boolean;
}

type CreateConnectionInput = CreateRegistryConnectionInput | CreateCustomConnectionInput;

type UpdateConnectionInput = {
  id: string;
  name?: string;
  catalogProviderId?: string;
  sdkPackage?: string;
  baseUrl?: string | null;
  apiKey?: string | null;
  isEnabled?: boolean;
};

type CustomModelMutationInput = Pick<
  CustomModelInsert,
  | "modelId"
  | "displayName"
  | "contextWindow"
  | "maxOutputTokens"
  | "supportsVision"
  | "supportsToolUse"
  | "supportsReasoning"
  | "supportsTemperature"
  | "inputPricePer1m"
  | "outputPricePer1m"
  | "isEnabled"
>;

function invalidateConnection(ctx: MutationCtx, connectionId: string) {
  ctx.invalidate("ai.connections", `ai.connections.models:${connectionId}`);
}

function sanitizeName(name: string): string {
  const trimmed = name.trim();
  invariant(trimmed.length > 0, "Name cannot be empty");
  return trimmed;
}

function sanitizeBaseUrl(baseUrl: string | null | undefined): string | null {
  const trimmed = baseUrl?.trim();
  return trimmed ? trimmed : null;
}

function sanitizeApiKey(apiKey: string | null | undefined): string | null {
  const trimmed = apiKey?.trim();
  return trimmed ? trimmed : null;
}

function validateSdkPackageForInput(sdkPackage: string) {
  const recipe = getAiSdkPackageRecipe(sdkPackage);
  invariant(recipe, "Unsupported AI SDK package");
  return recipe;
}

function validateConnectionBaseUrl({
  sdkPackage,
  baseUrl,
}: {
  sdkPackage: string;
  baseUrl: string | null;
}) {
  const recipe = validateSdkPackageForInput(sdkPackage);
  if (recipe.requiresBaseUrl) {
    invariant(baseUrl, "Base URL is required for this AI SDK package");
  }
  if (!recipe.requiresBaseUrl && !recipe.allowsCustomEndpoint) {
    invariant(baseUrl == null, "This AI SDK package does not allow custom endpoints");
  }
}

function buildConnectionInsert(input: CreateConnectionInput): ConnectionInsert {
  const timestamp = now();
  const name = sanitizeName(input.name);

  if (input.kind === "registry") {
    const provider = db.query.aiCatalogProviders
      .findFirst({ where: eq(schema.aiCatalogProviders.id, input.catalogProviderId) })
      .sync();
    invariant(provider, "Catalog provider not found");
    invariant(provider.sdkPackage, "Catalog provider has no AI SDK package");

    const recipe = validateSdkPackageForInput(provider.sdkPackage);
    invariant(recipe.supportsRegistryProvider, "Catalog provider package is not supported");
    const baseUrl = sanitizeBaseUrl(input.baseUrl);
    validateConnectionBaseUrl({ sdkPackage: provider.sdkPackage, baseUrl });

    return {
      id: createId("conn"),
      kind: "registry",
      name,
      sdkPackage: provider.sdkPackage,
      catalogProviderId: provider.id,
      baseUrl,
      apiKey: sanitizeApiKey(input.apiKey),
      configJson: "{}",
      isEnabled: input.isEnabled ?? true,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }

  const sdkPackage = input.sdkPackage;
  const baseUrl = sanitizeBaseUrl(input.baseUrl);
  validateConnectionBaseUrl({ sdkPackage, baseUrl });

  return {
    id: createId("conn"),
    kind: "custom",
    name,
    sdkPackage,
    catalogProviderId: null,
    baseUrl,
    apiKey: sanitizeApiKey(input.apiKey),
    configJson: "{}",
    isEnabled: input.isEnabled ?? true,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function normalizeCustomModelInput(input: CustomModelMutationInput) {
  const modelId = input.modelId.trim();
  const displayName = input.displayName.trim();
  invariant(modelId.length > 0, "Model ID cannot be empty");
  invariant(displayName.length > 0, "Display name cannot be empty");

  return {
    modelId,
    displayName,
    contextWindow: input.contextWindow ?? null,
    maxOutputTokens: input.maxOutputTokens ?? null,
    supportsVision: input.supportsVision ?? false,
    supportsToolUse: input.supportsToolUse ?? false,
    supportsReasoning: input.supportsReasoning ?? false,
    supportsTemperature: input.supportsTemperature ?? false,
    inputPricePer1m: input.inputPricePer1m ?? null,
    outputPricePer1m: input.outputPricePer1m ?? null,
    isEnabled: input.isEnabled ?? true,
  };
}

export const listSupportedSdkPackages = query<void, AiSupportedSdkPackage[]>((_, ctx) => {
  ctx.watch("ai.catalog.packages");
  return [...SUPPORTED_AI_SDK_PACKAGES];
});

export const getCatalogStatus = query<void, AiCatalogStatusView>((_, ctx) => {
  ctx.watch("ai.catalog.status");
  return getAiCatalogStatus();
});

export const refreshCatalog = mutation<{ force?: boolean } | void, AiCatalogStatusView>(
  async (input, ctx) => {
    const status = await refreshAiCatalog({ force: input?.force ?? false });
    ctx.invalidate(
      "ai.catalog.status",
      "ai.catalog.providers",
      "ai.connections",
      "ai.catalog.models",
    );
    return status;
  },
);

export const listCatalogProviders = query<
  { activeOnly?: boolean; supportedOnly?: boolean } | void,
  AiCatalogProviderView[]
>((input, ctx) => {
  ctx.watch("ai.catalog.providers");
  return listCatalogProvidersView({
    activeOnly: input?.activeOnly ?? true,
    supportedOnly: input?.supportedOnly ?? false,
  });
});

export const listCatalogModels = query<
  { catalogProviderId: string; activeOnly?: boolean; query?: string },
  AiCatalogModelView[]
>(({ catalogProviderId, activeOnly, query: search }, ctx) => {
  ctx.watch("ai.catalog.models", `ai.catalog.models:${catalogProviderId}`);
  return listCatalogModelsView({
    catalogProviderId,
    activeOnly: activeOnly ?? true,
    query: search,
  });
});

export const listConnections = query<void, AiConnectionRow[]>((_, ctx) => {
  ctx.watch("ai.connections");
  return db.query.aiConnections
    .findMany()
    .sync()
    .sort((a, b) => a.name.localeCompare(b.name));
});

export const createConnection = mutation<CreateConnectionInput, AiConnectionRow>((input, ctx) => {
  const values = buildConnectionInsert(input);
  db.insert(schema.aiConnections).values(values).run();
  ctx.invalidate("ai.connections");
  return db.query.aiConnections
    .findFirst({ where: eq(schema.aiConnections.id, values.id) })
    .sync()!;
});

export const updateConnection = mutation<UpdateConnectionInput, AiConnectionRow>((input, ctx) => {
  const existing = db.query.aiConnections
    .findFirst({ where: eq(schema.aiConnections.id, input.id) })
    .sync();
  invariant(existing, "Connection not found");

  const timestamp = now();
  const nextName = input.name != null ? sanitizeName(input.name) : existing.name;
  const nextKind = existing.kind;
  let nextSdkPackage = existing.sdkPackage;
  let nextCatalogProviderId = existing.catalogProviderId;

  if (nextKind === "registry") {
    const providerId = input.catalogProviderId ?? existing.catalogProviderId;
    invariant(providerId, "Registry connection must reference a catalog provider");
    const provider = db.query.aiCatalogProviders
      .findFirst({ where: eq(schema.aiCatalogProviders.id, providerId) })
      .sync();
    invariant(provider, "Catalog provider not found");
    invariant(provider.sdkPackage, "Catalog provider has no AI SDK package");
    const recipe = validateSdkPackageForInput(provider.sdkPackage);
    invariant(recipe.supportsRegistryProvider, "Catalog provider package is not supported");
    nextSdkPackage = provider.sdkPackage;
    nextCatalogProviderId = provider.id;
  } else if (input.sdkPackage != null) {
    validateSdkPackageForInput(input.sdkPackage);
    nextSdkPackage = input.sdkPackage;
  }

  const nextBaseUrl =
    input.baseUrl !== undefined ? sanitizeBaseUrl(input.baseUrl) : existing.baseUrl;
  validateConnectionBaseUrl({ sdkPackage: nextSdkPackage, baseUrl: nextBaseUrl });

  const nextValues: Partial<ConnectionInsert> = {
    name: nextName,
    sdkPackage: nextSdkPackage,
    catalogProviderId: nextCatalogProviderId,
    baseUrl: nextBaseUrl,
    isEnabled: input.isEnabled ?? existing.isEnabled,
    updatedAt: timestamp,
  };

  if (input.apiKey !== undefined) {
    nextValues.apiKey = sanitizeApiKey(input.apiKey);
  }

  db.update(schema.aiConnections)
    .set(nextValues)
    .where(eq(schema.aiConnections.id, input.id))
    .run();
  invalidateConnection(ctx, input.id);
  return db.query.aiConnections.findFirst({ where: eq(schema.aiConnections.id, input.id) }).sync()!;
});

export const deleteConnection = mutation<{ id: string }, void>(({ id }, ctx) => {
  db.delete(schema.aiConnections).where(eq(schema.aiConnections.id, id)).run();
  invalidateConnection(ctx, id);
});

export const listResolvedModels = query<
  { connectionId: string; includeDisabled?: boolean },
  AiResolvedModelView[]
>(({ connectionId, includeDisabled }, ctx) => {
  ctx.watch(`ai.connections.models:${connectionId}`);
  return listResolvedModelsForConnection({
    connectionId,
    includeDisabled: includeDisabled ?? false,
  });
});

export const setCatalogModelEnabled = mutation<
  { connectionId: string; catalogModelId: string; enabled: boolean },
  AiResolvedModelView[]
>(({ connectionId, catalogModelId, enabled }, ctx) => {
  const connection = db.query.aiConnections
    .findFirst({ where: eq(schema.aiConnections.id, connectionId) })
    .sync();
  invariant(connection, "Connection not found");
  invariant(connection.kind === "registry", "Only registry connections can toggle catalog models");

  const catalogModel = db.query.aiCatalogModels
    .findFirst({ where: eq(schema.aiCatalogModels.id, catalogModelId) })
    .sync();
  invariant(catalogModel, "Catalog model not found");
  invariant(
    catalogModel.providerId === connection.catalogProviderId,
    "Catalog model does not belong to this connection",
  );

  if (enabled) {
    db.delete(schema.aiConnectionCatalogOverrides)
      .where(
        and(
          eq(schema.aiConnectionCatalogOverrides.connectionId, connectionId),
          eq(schema.aiConnectionCatalogOverrides.catalogModelId, catalogModelId),
        ),
      )
      .run();
  } else {
    const timestamp = now();
    db.insert(schema.aiConnectionCatalogOverrides)
      .values({
        id: createId("ovr"),
        connectionId,
        catalogModelId,
        isEnabled: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .onConflictDoUpdate({
        target: [
          schema.aiConnectionCatalogOverrides.connectionId,
          schema.aiConnectionCatalogOverrides.catalogModelId,
        ],
        set: {
          isEnabled: false,
          updatedAt: timestamp,
        },
      })
      .run();
  }

  invalidateConnection(ctx, connectionId);
  return listResolvedModelsForConnection({ connectionId, includeDisabled: true });
});

export const createCustomModel = mutation<
  { connectionId: string } & CustomModelMutationInput,
  CustomModelRow
>(({ connectionId, ...input }, ctx) => {
  const connection = db.query.aiConnections
    .findFirst({ where: eq(schema.aiConnections.id, connectionId) })
    .sync();
  invariant(connection, "Connection not found");

  const values = normalizeCustomModelInput(input);
  assertConnectionSupportsCustomModel(connection, values.modelId);

  const timestamp = now();
  const id = createId("cmodel");
  db.insert(schema.aiConnectionCustomModels)
    .values({
      id,
      connectionId,
      ...values,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();

  invalidateConnection(ctx, connectionId);
  return db.query.aiConnectionCustomModels
    .findFirst({ where: eq(schema.aiConnectionCustomModels.id, id) })
    .sync()!;
});

export const updateCustomModel = mutation<
  { id: string } & Partial<CustomModelMutationInput>,
  CustomModelRow
>(({ id, ...input }, ctx) => {
  const existing = db.query.aiConnectionCustomModels
    .findFirst({ where: eq(schema.aiConnectionCustomModels.id, id) })
    .sync();
  invariant(existing, "Custom model not found");

  const connection = db.query.aiConnections
    .findFirst({ where: eq(schema.aiConnections.id, existing.connectionId) })
    .sync();
  invariant(connection, "Connection not found");

  const values = normalizeCustomModelInput({
    modelId: input.modelId ?? existing.modelId,
    displayName: input.displayName ?? existing.displayName,
    contextWindow: input.contextWindow ?? existing.contextWindow,
    maxOutputTokens: input.maxOutputTokens ?? existing.maxOutputTokens,
    supportsVision: input.supportsVision ?? existing.supportsVision,
    supportsToolUse: input.supportsToolUse ?? existing.supportsToolUse,
    supportsReasoning: input.supportsReasoning ?? existing.supportsReasoning,
    supportsTemperature: input.supportsTemperature ?? existing.supportsTemperature,
    inputPricePer1m: input.inputPricePer1m ?? existing.inputPricePer1m,
    outputPricePer1m: input.outputPricePer1m ?? existing.outputPricePer1m,
    isEnabled: input.isEnabled ?? existing.isEnabled,
  });
  if (values.modelId !== existing.modelId) {
    assertConnectionSupportsCustomModel(connection, values.modelId);
  }

  db.update(schema.aiConnectionCustomModels)
    .set({ ...values, updatedAt: now() })
    .where(eq(schema.aiConnectionCustomModels.id, id))
    .run();

  invalidateConnection(ctx, existing.connectionId);
  return db.query.aiConnectionCustomModels
    .findFirst({ where: eq(schema.aiConnectionCustomModels.id, id) })
    .sync()!;
});

export const deleteCustomModel = mutation<{ id: string }, void>(({ id }, ctx) => {
  const model = db.query.aiConnectionCustomModels
    .findFirst({ where: eq(schema.aiConnectionCustomModels.id, id) })
    .sync();
  invariant(model, "Custom model not found");
  db.delete(schema.aiConnectionCustomModels)
    .where(eq(schema.aiConnectionCustomModels.id, id))
    .run();
  invalidateConnection(ctx, model.connectionId);
});

// Warm the local catalog snapshot whenever the AI surface is touched.
void ensureAiCatalogFresh();
