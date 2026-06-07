import { query } from "@codehz/rpc";

export const healthcheck = query<void, "ok">(() => "ok");
