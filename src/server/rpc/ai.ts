import { mutation, query } from "@codehz/rpc";
import { type InferInsertModel, type InferSelectModel, and, eq } from "drizzle-orm";

import { db, schema } from "@/db";
import { createId, now } from "@/domain/internal/ids";

type ProviderRow = InferSelectModel<typeof schema.aiProviders>;
type ModelRow = InferSelectModel<typeof schema.aiModels>;
type ProviderInsert = InferInsertModel<typeof schema.aiProviders>;
type ModelInsert = InferInsertModel<typeof schema.aiModels>;

// --- Providers ---

export const listProviders = query<void, ProviderRow[]>((_, ctx) => {
  const providers = db.query.aiProviders.findMany().sync();
  ctx.watch("ai.providers");
  return providers;
});

export const getProvider = query<{ id: string }, ProviderRow | undefined>(({ id }, ctx) => {
  ctx.watch(`ai.providers:${id}`);
  return db.query.aiProviders.findFirst({ where: eq(schema.aiProviders.id, id) }).sync();
});

export const createProvider = mutation<
  Pick<ProviderInsert, "name" | "providerType" | "baseUrl" | "apiKey">,
  ProviderRow
>((input, ctx) => {
  const id = createId("prov");
  const timestamp = now();
  db.insert(schema.aiProviders)
    .values({ id, ...input, isEnabled: true, createdAt: timestamp, updatedAt: timestamp })
    .run();
  ctx.invalidate("ai.providers");
  return db.query.aiProviders.findFirst({ where: eq(schema.aiProviders.id, id) }).sync()!;
});

export const updateProvider = mutation<
  Pick<ProviderInsert, "id"> &
    Partial<Pick<ProviderInsert, "name" | "providerType" | "baseUrl" | "apiKey" | "isEnabled">>,
  ProviderRow
>((input, ctx) => {
  const { id, ...rest } = input;
  db.update(schema.aiProviders)
    .set({ ...rest, updatedAt: now() })
    .where(eq(schema.aiProviders.id, id))
    .run();
  ctx.invalidate("ai.providers", `ai.providers:${id}`);
  return db.query.aiProviders.findFirst({ where: eq(schema.aiProviders.id, id) }).sync()!;
});

export const deleteProvider = mutation<{ id: string }, void>(({ id }, ctx) => {
  db.delete(schema.aiProviders).where(eq(schema.aiProviders.id, id)).run();
  ctx.invalidate("ai.providers", `ai.providers:${id}`, "ai.models");
});

// --- Models ---

export const listModels = query<void, ModelRow[]>((_, ctx) => {
  ctx.watch("ai.models");
  return db.query.aiModels.findMany().sync();
});

export const listModelsForProvider = query<{ providerId: string }, ModelRow[]>(
  ({ providerId }, ctx) => {
    ctx.watch(`ai.models:provider:${providerId}`);
    return db.query.aiModels.findMany({ where: eq(schema.aiModels.providerId, providerId) }).sync();
  },
);

export const createModel = mutation<
  Pick<
    ModelInsert,
    | "providerId"
    | "modelId"
    | "displayName"
    | "contextWindow"
    | "maxOutputTokens"
    | "supportsVision"
    | "supportsToolUse"
    | "inputPricePer1m"
    | "outputPricePer1m"
  >,
  ModelRow
>((input, ctx) => {
  const id = createId("model");
  const timestamp = now();
  db.insert(schema.aiModels)
    .values({
      id,
      ...input,
      isDefault: false,
      isEnabled: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();
  ctx.invalidate("ai.models", `ai.models:provider:${input.providerId}`);
  return db.query.aiModels.findFirst({ where: eq(schema.aiModels.id, id) }).sync()!;
});

export const updateModel = mutation<
  Pick<ModelInsert, "id"> & Partial<Omit<ModelInsert, "id" | "createdAt" | "updatedAt">>,
  ModelRow
>((input, ctx) => {
  const { id, ...rest } = input;
  db.update(schema.aiModels)
    .set({ ...rest, updatedAt: now() })
    .where(eq(schema.aiModels.id, id))
    .run();
  ctx.invalidate(
    "ai.models",
    rest.providerId ? `ai.models:provider:${rest.providerId}` : "ai.models",
  );
  return db.query.aiModels.findFirst({ where: eq(schema.aiModels.id, id) }).sync()!;
});

export const deleteModel = mutation<{ id: string }, void>(({ id }, ctx) => {
  const model = db.query.aiModels.findFirst({ where: eq(schema.aiModels.id, id) }).sync();
  db.delete(schema.aiModels).where(eq(schema.aiModels.id, id)).run();
  ctx.invalidate("ai.models", model ? `ai.models:provider:${model.providerId}` : "ai.models");
});

export const setDefaultModel = mutation<{ id: string }, ModelRow>(({ id }, ctx) => {
  const model = db.query.aiModels.findFirst({ where: eq(schema.aiModels.id, id) }).sync();
  if (!model) throw new Error("Model not found");
  db.transaction((tx) => {
    tx.update(schema.aiModels)
      .set({ isDefault: false, updatedAt: now() })
      .where(eq(schema.aiModels.providerId, model.providerId))
      .run();
    tx.update(schema.aiModels)
      .set({ isDefault: true, updatedAt: now() })
      .where(eq(schema.aiModels.id, id))
      .run();
  });
  ctx.invalidate("ai.models", `ai.models:provider:${model.providerId}`);
  return db.query.aiModels.findFirst({ where: eq(schema.aiModels.id, id) }).sync()!;
});

// --- Model Sync ---

interface FetchedModel {
  modelId: string;
  displayName: string;
}

async function fetchModelsFromProvider(provider: ProviderRow): Promise<FetchedModel[]> {
  const baseUrl = provider.baseUrl!.replace(/\/+$/, "");
  const apiKey = provider.apiKey!;
  const type = provider.providerType;

  let url: string;
  let headers: Record<string, string>;

  switch (type) {
    case "anthropic": {
      url = `${baseUrl}/models`;
      headers = { "x-api-key": apiKey };
      break;
    }
    case "google": {
      url = `${baseUrl}/models?key=${encodeURIComponent(apiKey)}`;
      headers = {};
      break;
    }
    default: {
      url = `${baseUrl}/models`;
      headers = { Authorization: `Bearer ${apiKey}` };
    }
  }

  const response = await fetch(url, { headers });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch models from ${provider.name}: HTTP ${response.status} ${response.statusText}`,
    );
  }

  const json = (await response.json()) as any;

  if (type === "google") {
    const models: any[] = json?.models ?? [];
    return models.map((m: any) => {
      const rawId: string = m.name ?? "";
      return {
        modelId: rawId.startsWith("models/") ? rawId.slice("models/".length) : rawId,
        displayName: m.displayName ?? rawId,
      };
    });
  }

  const data: any[] = json?.data ?? [];
  return data.map((m: any) => ({
    modelId: m.id ?? "",
    displayName: m.display_name ?? m.id ?? "",
  }));
}

export const syncModels = mutation<{ providerId: string }, ModelRow[]>(
  async ({ providerId }, ctx) => {
    const provider = db.query.aiProviders
      .findFirst({ where: eq(schema.aiProviders.id, providerId) })
      .sync();
    if (!provider) throw new Error("Provider not found");
    if (!provider.apiKey) throw new Error("Provider has no API key configured");
    if (!provider.baseUrl) throw new Error("Provider has no base URL configured");

    const fetchedModels = await fetchModelsFromProvider(provider);
    const timestamp = now();

    db.transaction((tx) => {
      for (const fm of fetchedModels) {
        const existing = tx.query.aiModels
          .findFirst({
            where: and(
              eq(schema.aiModels.providerId, providerId),
              eq(schema.aiModels.modelId, fm.modelId),
            ),
          })
          .sync();

        if (existing) {
          if (existing.displayName !== fm.displayName) {
            tx.update(schema.aiModels)
              .set({ displayName: fm.displayName, updatedAt: timestamp })
              .where(eq(schema.aiModels.id, existing.id))
              .run();
          }
        } else {
          tx.insert(schema.aiModels)
            .values({
              id: createId("model"),
              providerId,
              modelId: fm.modelId,
              displayName: fm.displayName,
              isDefault: false,
              isEnabled: true,
              supportsVision: false,
              supportsToolUse: false,
              createdAt: timestamp,
              updatedAt: timestamp,
            })
            .run();
        }
      }
    });

    ctx.invalidate("ai.models", `ai.models:provider:${providerId}`);
    return db.query.aiModels.findMany({ where: eq(schema.aiModels.providerId, providerId) }).sync();
  },
);
