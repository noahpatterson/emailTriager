import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

let executeImpl: () => Promise<unknown> = async () => undefined;

mock.module("@/src/server/db", () => ({
  database: () => ({
    execute: () => executeImpl(),
  }),
}));

const { GET } = await import("../../app/api/health/route");

describe("GET /api/health", () => {
  test("returns 200 with { ok: true } after a successful database round-trip", async () => {
    executeImpl = async () => undefined;
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  test("returns 503 with { ok: false } when the database ping fails", async () => {
    executeImpl = async () => {
      throw new Error("connection refused");
    };
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false });
  });

  test("never puts error details or connection strings in the body", async () => {
    executeImpl = async () => {
      throw new Error("postgresql://secret@host/db failed");
    };
    const response = await GET();
    const body = await response.text();
    expect(body).toBe(JSON.stringify({ ok: false }));
    expect(body).not.toContain("postgresql");
    expect(body).not.toContain("secret");
  });
});
