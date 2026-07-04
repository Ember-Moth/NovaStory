import type { RpcErrorInit } from "./core";
import { fromRpcErrorBody, RpcError, RpcErrorCodes } from "./core";

export type RpcStreamErrorKind = "setup" | "event" | "transport";

export class RpcStreamAborted {
  kind = "aborted" as const;
  name = "RpcStreamAborted";
  message: string;
  reason?: string;
  constructor(reason?: string) {
    this.reason = reason;
    this.message = reason ?? "Stream aborted";
  }
}

export class RpcStreamSetupError extends RpcError {
  streamErrorKind = "setup" as const;
  constructor(init: RpcErrorInit) {
    super(init);
    this.name = "RpcStreamSetupError";
  }
}

export class RpcStreamEventError extends RpcError {
  streamErrorKind = "event" as const;
  constructor(init: RpcErrorInit) {
    super(init);
    this.name = "RpcStreamEventError";
  }
}

export class RpcStreamTransportError extends RpcError {
  streamErrorKind = "transport" as const;
  constructor(init: RpcErrorInit) {
    super(init);
    this.name = "RpcStreamTransportError";
  }
}

export function isRpcStreamError(
  error: unknown,
): error is RpcStreamSetupError | RpcStreamEventError | RpcStreamTransportError {
  return (
    error instanceof RpcStreamSetupError ||
    error instanceof RpcStreamEventError ||
    error instanceof RpcStreamTransportError
  );
}

export function isRpcStreamAborted(error: unknown): error is RpcStreamAborted {
  return error instanceof RpcStreamAborted;
}

export function getRpcStreamErrorKind(error: unknown): RpcStreamErrorKind | undefined {
  if (error instanceof RpcStreamSetupError) return "setup";
  if (error instanceof RpcStreamEventError) return "event";
  if (error instanceof RpcStreamTransportError) return "transport";
  return undefined;
}

export function toRpcStreamSetupError(
  error: unknown,
  options: { procedure?: string } = {},
): RpcStreamSetupError {
  if (error instanceof RpcStreamSetupError) return error;
  if (error instanceof RpcError) {
    return new RpcStreamSetupError({
      code: error.code,
      status: error.status,
      message: error.message,
      data: error.data,
      procedure: error.procedure ?? options.procedure,
      cause: error.cause ?? error,
    });
  }
  return new RpcStreamSetupError({
    code: RpcErrorCodes.BAD_REQUEST,
    status: 400,
    message: error instanceof Error ? error.message : "Stream setup failed",
    procedure: options.procedure,
    cause: error,
  });
}

export function fromRpcStreamEventErrorBody(
  body: Parameters<typeof fromRpcErrorBody>[0],
  options: { procedure?: string; cause?: unknown } = {},
): RpcStreamEventError {
  const error = fromRpcErrorBody(body, options);
  return new RpcStreamEventError({
    code: error.code,
    status: error.status,
    message: error.message,
    data: error.data,
    procedure: error.procedure ?? options.procedure,
    cause: options.cause ?? error,
  });
}

export function toRpcStreamTransportError(
  message: string,
  options: {
    code?: string;
    status?: number;
    procedure?: string;
    cause?: unknown;
  } = {},
): RpcStreamTransportError {
  return new RpcStreamTransportError({
    code: options.code ?? RpcErrorCodes.STREAM_PROTOCOL_ERROR,
    status: options.status ?? 400,
    message,
    procedure: options.procedure,
    cause: options.cause,
  });
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
