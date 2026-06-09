import { RpcError, RpcErrorCodes } from "@codehz/rpc/core";

export function assertRpcFound<TValue>(
  value: TValue,
  message: string,
): asserts value is NonNullable<TValue> {
  if (value == null) {
    throw new RpcError({
      code: RpcErrorCodes.NOT_FOUND,
      message,
    });
  }
}
