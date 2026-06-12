export type AssistantToolSuccess<T> = {
  ok: true;
  truncated: boolean;
  data: T;
};

export type AssistantToolError = {
  ok: false;
  error: string;
};

export type AssistantToolEnvelope<T> = AssistantToolSuccess<T> | AssistantToolError;

export function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "工具执行失败。";
}

export function failure(error: unknown): AssistantToolError {
  return {
    ok: false,
    error: getErrorMessage(error),
  };
}

export function withEnvelope<T>(execute: () => AssistantToolSuccess<T>): AssistantToolEnvelope<T> {
  try {
    return execute();
  } catch (error) {
    return failure(error);
  }
}
