/** Make `server-only` a no-op under bun test so sync/factory imports load locally. */
import { mock } from "bun:test";

mock.module("server-only", () => ({}));
