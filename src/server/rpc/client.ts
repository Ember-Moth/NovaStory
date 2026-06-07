import { createRpcClient } from "@codehz/rpc";

import type * as api from "./index";

export const rpc = createRpcClient<typeof api>();
