import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const {
  FORBIDDEN_BARE_SET_NOTE,
  probeSetLocalOwnerScoping,
} = await import("../server/db/rls-session-probe");

describe("RLS session variable probe", () => {
  test("documents bare SET without a transaction as forbidden", () => {
    expect(FORBIDDEN_BARE_SET_NOTE).toMatch(/SET LOCAL/);
    expect(FORBIDDEN_BARE_SET_NOTE).toMatch(/forbidden|must not|never/i);
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  "RLS SET LOCAL under pg pooler",
  () => {
    test("SET LOCAL scopes per transaction; bare SET leaks on the same connection", async () => {
      const url = process.env.TEST_DATABASE_URL;
      if (!url) throw new Error("TEST_DATABASE_URL required");
      const result = await probeSetLocalOwnerScoping(url);
      expect(result.ownerARows).toEqual(["a-only"]);
      expect(result.ownerBRows).toEqual(["b-only"]);
      expect(result.settingAfterCommit).toBe("");
      expect(result.bareSetLeakedAfterCommit).toBe(true);
    });
  },
);
