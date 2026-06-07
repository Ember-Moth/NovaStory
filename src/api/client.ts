import { createRpcClient } from "@codehz/rpc";

import type * as api from ".";

export const rpc = createRpcClient<typeof api>();
