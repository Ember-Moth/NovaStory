import { query } from "@codehz/rpc/core";

export const healthcheck = query<void, "ok">(() => "ok");
