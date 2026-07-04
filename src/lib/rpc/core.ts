export function defineSchema<T>(parse: (input: unknown) => T): {
  parse: (input: unknown) => T;
} {
  return { parse };
}

export function defineTags<T extends Record<string, (...args: any[]) => readonly unknown[]>>(
  tags: T,
): T {
  return tags;
}

export type TagValue<T extends Record<string, (...args: any[]) => readonly unknown[]>> = ReturnType<
  T[keyof T]
>;

export type TagKeyList = readonly (string | readonly unknown[])[];

export function query<TInput = void, TOutput = unknown, TWatch extends TagKeyList = TagKeyList>(
  definition:
    | ((input: TInput, ctx: QueryCtx) => TOutput | Promise<TOutput>)
    | {
        input?: { parse: (v: unknown) => TInput };
        serial?: boolean;
        watch?: (input: TInput, data: Awaited<TOutput>) => TWatch;
        handler: (input: TInput, ctx: QueryCtx) => TOutput | Promise<TOutput>;
      },
): RpcQueryDef<TInput, Awaited<TOutput>, TWatch> {
  const handler = typeof definition === "function" ? definition : definition.handler;
  const declarativeWatch = typeof definition === "function" ? undefined : definition.watch;
  const inputSchema = typeof definition === "function" ? undefined : definition.input;
  const serial = typeof definition === "function" ? undefined : definition.serial;
  return {
    kind: "query",
    serial,
    inputSchema,
    async handler(input: TInput, requestCtx: RequestCtx) {
      let manualWatch: TagKeyList | undefined;
      const data = await handler(input, {
        ...requestCtx,
        watch(...keys: TagKeyList) {
          manualWatch = appendKeys(manualWatch, keys);
        },
      });
      const declaredWatch = declarativeWatch?.(input, data as Awaited<TOutput>);
      const watch = mergeKeys(declaredWatch as TagKeyList | undefined, manualWatch);
      return { data, watch };
    },
  } as unknown as RpcQueryDef<TInput, Awaited<TOutput>, TWatch>;
}

export function mutation<
  TInput = void,
  TOutput = unknown,
  TInvalidate extends TagKeyList = TagKeyList,
>(
  definition:
    | ((input: TInput, ctx: MutationCtx) => TOutput | Promise<TOutput>)
    | {
        input?: { parse: (v: unknown) => TInput };
        invalidate?: (input: TInput, data: Awaited<TOutput>) => TInvalidate;
        handler: (input: TInput, ctx: MutationCtx) => TOutput | Promise<TOutput>;
      },
): RpcMutationDef<TInput, Awaited<TOutput>, TInvalidate> {
  const handler = typeof definition === "function" ? definition : definition.handler;
  const declarativeInvalidate =
    typeof definition === "function" ? undefined : definition.invalidate;
  const inputSchema = typeof definition === "function" ? undefined : definition.input;
  return {
    kind: "mutation",
    inputSchema,
    async handler(input: TInput, requestCtx: RequestCtx) {
      let manualInvalidate: TagKeyList | undefined;
      const data = await handler(input, {
        ...requestCtx,
        invalidate(...keys: TagKeyList) {
          manualInvalidate = appendKeys(manualInvalidate, keys);
        },
      });
      const declaredInvalidate = declarativeInvalidate?.(input, data as Awaited<TOutput>);
      const invalidate = mergeKeys(declaredInvalidate as TagKeyList | undefined, manualInvalidate);
      return { data, invalidate };
    },
  } as unknown as RpcMutationDef<TInput, Awaited<TOutput>, TInvalidate>;
}

export function task(options: any): any {
  const handler = options.handler;
  const declarativeInvalidate = options.invalidate;
  const inputSchema = options.input;
  return {
    kind: "task",
    inputSchema,
    async handler(input: any, requestCtx: any, bridge: any) {
      let manualInvalidate: any;
      const cancelSignal = bridge.cancelSignal ?? requestCtx.req.signal;
      const connectionSignal = bridge.connectionSignal ?? requestCtx.req.signal;
      const result = await handler(input, {
        ...requestCtx,
        cancelSignal,
        connectionSignal,
        get isCancelled() {
          return cancelSignal.aborted;
        },
        get isDisconnected() {
          return connectionSignal.aborted;
        },
        emit(event: any) {
          bridge.emit(event);
        },
        setSnapshot(snapshot: any) {
          bridge.setSnapshot(snapshot);
        },
        invalidate(...keys: any[]) {
          manualInvalidate = appendKeys(manualInvalidate, keys);
          bridge.invalidate(keys);
        },
      });
      const declaredInvalidate = declarativeInvalidate?.(input, result);
      const invalidate = mergeKeys(declaredInvalidate, manualInvalidate);
      return { result, invalidate };
    },
  };
}

export function subscription(options: any): any {
  const handler = options.handler;
  const inputSchema = options.input;
  return {
    kind: "subscription",
    inputSchema,
    async handler(input: any, requestCtx: any, bridge: any) {
      const connectionSignal = bridge.connectionSignal ?? requestCtx.req.signal;
      await handler(input, {
        ...requestCtx,
        connectionSignal,
        get isDisconnected() {
          return connectionSignal.aborted;
        },
        emit(event: any) {
          bridge.emit(event);
        },
        invalidate(...keys: any[]) {
          bridge.invalidate(keys);
        },
      });
    },
  };
}

export function stream(options: any): any {
  return task({
    ...options,
    handler: async (input: any, ctx: any) =>
      options.handler(input, {
        ...ctx,
        signal: ctx.cancelSignal,
        get isAborted() {
          return ctx.isCancelled;
        },
      }),
  });
}

function mergeKeys(
  first: TagKeyList | undefined,
  second: TagKeyList | undefined,
): TagKeyList | undefined {
  const normalizedFirst = first && first.length > 0 ? first : undefined;
  if (!second) return normalizedFirst;
  return appendKeys(normalizedFirst, second);
}

function appendKeys(existing: TagKeyList | undefined, incoming: TagKeyList): TagKeyList {
  if (incoming.length === 0) return existing ?? [];
  if (!existing || existing.length === 0) return [...incoming];
  const seen = new Set<string>();
  const keys: (string | readonly unknown[])[] = [];
  for (const key of [...existing, ...incoming]) {
    const indexKey = serializeTagKey(key);
    if (seen.has(indexKey)) continue;
    seen.add(indexKey);
    keys.push(key);
  }
  return keys;
}

export function serializeTagKey(key: string | readonly unknown[]): string {
  return typeof key === "string" ? `string:${key}` : `tuple:${JSON.stringify(key)}`;
}

export const RpcErrorCodes = {
  BAD_REQUEST: "BAD_REQUEST",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  RATE_LIMITED: "RATE_LIMITED",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  PROCEDURE_NOT_FOUND: "PROCEDURE_NOT_FOUND",
  INVALID_JSON: "INVALID_JSON",
  INVALID_BATCH: "INVALID_BATCH",
  METHOD_NOT_ALLOWED: "METHOD_NOT_ALLOWED",
  HTTP_ERROR: "HTTP_ERROR",
  STREAM_PROTOCOL_ERROR: "STREAM_PROTOCOL_ERROR",
  STREAM_ABORTED: "STREAM_ABORTED",
} as const;

export type RpcErrorCode = (typeof RpcErrorCodes)[keyof typeof RpcErrorCodes];

const DEFAULT_STATUS_BY_CODE: Record<string, number> = {
  [RpcErrorCodes.BAD_REQUEST]: 400,
  [RpcErrorCodes.VALIDATION_ERROR]: 400,
  [RpcErrorCodes.UNAUTHORIZED]: 401,
  [RpcErrorCodes.FORBIDDEN]: 403,
  [RpcErrorCodes.NOT_FOUND]: 404,
  [RpcErrorCodes.CONFLICT]: 409,
  [RpcErrorCodes.RATE_LIMITED]: 429,
  [RpcErrorCodes.INTERNAL_ERROR]: 500,
  [RpcErrorCodes.PROCEDURE_NOT_FOUND]: 404,
  [RpcErrorCodes.INVALID_JSON]: 400,
  [RpcErrorCodes.INVALID_BATCH]: 400,
  [RpcErrorCodes.METHOD_NOT_ALLOWED]: 405,
  [RpcErrorCodes.HTTP_ERROR]: 500,
  [RpcErrorCodes.STREAM_PROTOCOL_ERROR]: 400,
  [RpcErrorCodes.STREAM_ABORTED]: 499,
};

export interface RpcErrorBody {
  code: string;
  status: number;
  message: string;
  data?: unknown;
}

export interface RpcErrorInit {
  code: string;
  status?: number;
  message: string;
  data?: unknown;
  procedure?: string;
  cause?: unknown;
}

export class RpcError extends Error {
  code: string;
  status: number;
  data?: unknown;
  procedure?: string;
  override cause?: unknown;

  constructor(init: RpcErrorInit) {
    super(init.message);
    this.name = "RpcError";
    this.code = init.code;
    this.status = resolveRpcErrorStatus(init.code, init.status);
    this.data = init.data;
    this.procedure = init.procedure;
    this.cause = init.cause;
  }
}

export function isRpcError(error: unknown): error is RpcError {
  return error instanceof RpcError;
}

export function isRpcErrorBody(value: unknown): value is RpcErrorBody {
  return Boolean(
    value &&
      typeof value === "object" &&
      "code" in value &&
      typeof (value as any).code === "string" &&
      "status" in value &&
      typeof (value as any).status === "number" &&
      "message" in value &&
      typeof (value as any).message === "string",
  );
}

export function resolveRpcErrorStatus(code: string, status?: number): number {
  return status ?? DEFAULT_STATUS_BY_CODE[code] ?? 400;
}

export function toRpcError(
  error: unknown,
  options: {
    procedure?: string;
    defaultCode?: string;
    defaultStatus?: number;
  } = {},
): RpcError {
  if (error instanceof RpcError) {
    if (options.procedure && !error.procedure) {
      return new RpcError({
        code: error.code,
        status: error.status,
        message: error.message,
        data: error.data,
        cause: error.cause ?? error,
        procedure: options.procedure,
      });
    }
    return error;
  }
  if (error instanceof Error) {
    const message = error.message;
    let code = options.defaultCode ?? RpcErrorCodes.BAD_REQUEST;
    let status = options.defaultStatus ?? resolveRpcErrorStatus(code);
    if (!options.defaultCode && message.toLowerCase().includes("not found")) {
      code = RpcErrorCodes.NOT_FOUND;
      status = 404;
    }
    return new RpcError({
      code,
      status,
      message,
      cause: error,
      procedure: options.procedure,
    });
  }
  return new RpcError({
    code: options.defaultCode ?? RpcErrorCodes.INTERNAL_ERROR,
    status:
      options.defaultStatus ??
      resolveRpcErrorStatus(options.defaultCode ?? RpcErrorCodes.INTERNAL_ERROR),
    message: "Internal server error",
    cause: error,
    procedure: options.procedure,
  });
}

export function toRpcErrorBody(
  error: unknown,
  options?: Parameters<typeof toRpcError>[1],
): RpcErrorBody {
  return serializeRpcError(toRpcError(error, options));
}

export function serializeRpcError(error: RpcError): RpcErrorBody {
  return error.data === undefined
    ? { code: error.code, status: error.status, message: error.message }
    : {
        code: error.code,
        status: error.status,
        message: error.message,
        data: error.data,
      };
}

export function fromRpcErrorBody(
  body: RpcErrorBody,
  options: { procedure?: string; cause?: unknown } = {},
): RpcError {
  return new RpcError({
    code: body.code,
    status: body.status,
    message: body.message,
    data: body.data,
    procedure: options.procedure,
    cause: options.cause,
  });
}

// Internal types used by ipc-router and ipc-transport
export interface RequestCtx {
  req: { signal: AbortSignal };
}

export interface QueryCtx extends RequestCtx {
  watch(...keys: TagKeyList): void;
}

export interface MutationCtx extends RequestCtx {
  invalidate(...keys: TagKeyList): void;
}

export interface RpcQueryDef<TInput, TOutput, TWatch extends TagKeyList> {
  kind: "query";
  serial?: boolean;
  inputSchema?: { parse: (v: unknown) => TInput };
  handler(input: TInput, ctx: RequestCtx): Promise<{ data: TOutput; watch?: TWatch }>;
}

export interface RpcMutationDef<TInput, TOutput, TInvalidate extends TagKeyList> {
  kind: "mutation";
  inputSchema?: { parse: (v: unknown) => TInput };
  handler(input: TInput, ctx: RequestCtx): Promise<{ data: TOutput; invalidate?: TInvalidate }>;
}

// Re-export for API compatibility
export type AnyKey = string | readonly unknown[];
export type ApiTree = Record<string, any>;
export type { TagKeyList as TagKeyListType };
