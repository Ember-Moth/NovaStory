// Stub — useSubscription and useTask are not used in this project
export function createSessionTransport(_endpoint: string, _fetchImpl: any) {
  return {
    startTask: () => {
      throw new Error("startTask not implemented");
    },

    subscribeTask: () => {
      throw new Error("subscribeTask not implemented");
    },
    openSubscription: () => {
      throw new Error("openSubscription not implemented");
    },
    getTask: () => {
      throw new Error("getTask not implemented");
    },
    cancelTask: () => {
      throw new Error("cancelTask not implemented");
    },
  };
}

export function createStreamCaller(_endpoint: string, _fetchImpl: any) {
  return function callStream() {
    throw new Error("stream calls not implemented");
  };
}
