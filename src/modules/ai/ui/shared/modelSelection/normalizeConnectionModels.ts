export interface ConnectionModelGroupLike<TConnection, TModel> {
  connection: TConnection;
  models: TModel[];
}

export interface EnabledModelLike {
  isEnabled?: boolean | null;
}

export function normalizeConnectionModels<
  TConnection,
  TModel extends EnabledModelLike,
  TGroup extends ConnectionModelGroupLike<TConnection, TModel>,
>(groups: TGroup[] | null | undefined) {
  return (groups ?? []).map((group) => ({
    connection: group.connection,
    models: group.models.filter((model) => model.isEnabled),
  }));
}
