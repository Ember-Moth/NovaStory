import { useCallback, useMemo, useRef, useState } from "react";
import { toRpcError } from "../core";

export function createUseMutation(
  callMutation: (
    key: string,
    input: unknown,
  ) => Promise<{
    data: unknown;
    invalidate?: readonly (string | readonly unknown[])[];
  }>,
  invalidateQueries: (keys: readonly (string | readonly unknown[])[] | undefined) => void,
) {
  return function useMutation(key: string, options?: any) {
    const optionsRef = useRef(options);
    optionsRef.current = options;
    const mutationIdRef = useRef(0);
    const [state, setState] = useState<any>({
      submittedAt: 0,
      failureCount: 0,
      status: "idle",
    });

    const reset = useCallback(() => {
      mutationIdRef.current += 1;
      setState({ submittedAt: 0, failureCount: 0, status: "idle" });
    }, []);

    const mutateAsync = useCallback(
      async (input: unknown, callOptions?: any) => {
        const mutationId = mutationIdRef.current + 1;
        mutationIdRef.current = mutationId;
        const submittedAt = Date.now();
        const hookOptions = optionsRef.current;
        let hookContext: unknown;
        let callContext: unknown;
        setState((current: any) => ({
          ...current,
          error: undefined,
          variables: input,
          submittedAt,
          failureCount: 0,
          status: "pending",
        }));
        try {
          hookContext = await hookOptions?.onMutate?.(input);
          callContext = await callOptions?.onMutate?.(input);
        } catch (error) {
          const nextError = toRpcError(error);
          if (mutationIdRef.current === mutationId)
            setState({
              data: undefined,
              error: nextError,
              variables: input,
              submittedAt,
              failureCount: 1,
              status: "error",
            });
          let callbackError: Error | undefined;
          callbackError = await captureMutationCallbackError(callbackError, () =>
            hookOptions?.onError?.(nextError, input, hookContext),
          );
          callbackError = await captureMutationCallbackError(callbackError, () =>
            callOptions?.onError?.(nextError, input, callContext),
          );
          callbackError = await captureMutationCallbackError(callbackError, () =>
            hookOptions?.onSettled?.(undefined, nextError, input, hookContext),
          );
          callbackError = await captureMutationCallbackError(callbackError, () =>
            callOptions?.onSettled?.(undefined, nextError, input, callContext),
          );
          throw callbackError ?? nextError;
        }
        let result: {
          data: unknown;
          invalidate?: readonly (string | readonly unknown[])[];
        };
        try {
          result = await callMutation(key, input);
        } catch (error) {
          const nextError = toRpcError(error);
          if (mutationIdRef.current === mutationId)
            setState({
              data: undefined,
              error: nextError,
              variables: input,
              submittedAt,
              failureCount: 1,
              status: "error",
            });
          let callbackError: Error | undefined;
          callbackError = await captureMutationCallbackError(callbackError, () =>
            hookOptions?.onError?.(nextError, input, hookContext),
          );
          callbackError = await captureMutationCallbackError(callbackError, () =>
            callOptions?.onError?.(nextError, input, callContext),
          );
          callbackError = await captureMutationCallbackError(callbackError, () =>
            hookOptions?.onSettled?.(undefined, nextError, input, hookContext),
          );
          callbackError = await captureMutationCallbackError(callbackError, () =>
            callOptions?.onSettled?.(undefined, nextError, input, callContext),
          );
          throw callbackError ?? nextError;
        }
        invalidateQueries(result.invalidate);
        if (mutationIdRef.current === mutationId)
          setState({
            data: result.data,
            error: undefined,
            variables: input,
            submittedAt,
            failureCount: 0,
            status: "success",
          });
        let callbackError: Error | undefined;
        callbackError = await captureMutationCallbackError(callbackError, () =>
          hookOptions?.onSuccess?.(result.data, input, hookContext),
        );
        callbackError = await captureMutationCallbackError(callbackError, () =>
          callOptions?.onSuccess?.(result.data, input, callContext),
        );
        callbackError = await captureMutationCallbackError(callbackError, () =>
          hookOptions?.onSettled?.(result.data, null, input, hookContext),
        );
        callbackError = await captureMutationCallbackError(callbackError, () =>
          callOptions?.onSettled?.(result.data, null, input, callContext),
        );
        if (callbackError) throw callbackError;
        return result.data;
      },
      [key],
    );

    return useMemo(
      () => ({
        data: state.data,
        error: state.error ?? null,
        isPending: state.status === "pending",
        variables: state.variables,
        submittedAt: state.submittedAt,
        failureCount: state.failureCount,
        status: state.status,
        reset,
        mutate: mutateAsync,
        mutateAsync,
      }),
      [
        state.data,
        state.error,
        state.variables,
        state.submittedAt,
        state.failureCount,
        state.status,
        reset,
        mutateAsync,
      ],
    );
  };
}

async function captureMutationCallbackError(
  current: Error | undefined,
  callback: () => unknown,
): Promise<Error | undefined> {
  try {
    await callback();
    return current;
  } catch (error) {
    return current ?? toRpcError(error);
  }
}
