import { mock } from "bun:test";

import { mockedDbModule } from "./mock-db";

mock.module("@/db", () => mockedDbModule);
