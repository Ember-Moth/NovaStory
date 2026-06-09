import { createRpcClient } from "@codehz/rpc/react";

import type * as api from "./router";

export const rpc = createRpcClient<typeof api>({
  queryCacheTime: 10 * 60 * 1000,
});
