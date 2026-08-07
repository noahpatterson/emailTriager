import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

let ownerImpl: () => Promise<{ userId: string }> = async () => ({ userId: "owner-1" });

mock.module("@/src/server/auth/owner", () => ({
  requireOwner: () => ownerImpl(),
}));

// Do not mock audit-run — that pollutes audit-run.test.ts (same module graph in bun).
const { handleAuditPost } = await import("../../app/api/audit/route");
const { handleAuditGet } = await import("../../app/api/audit/[id]/route");
const { AuditAlreadyRunningError } = await import("../../src/server/gmail/audit-run");

function postRequest(body: unknown, origin = "http://localhost:3000"): Request {
  return new Request("http://localhost:3000/api/audit", {
    method: "POST",
    headers: {
      origin,
      host: "localhost:3000",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function stubService(overrides: {
  start?: (ownerId: string, options: unknown) => Promise<unknown>;
  getStatus?: (ownerId: string, id: string) => Promise<unknown>;
}) {
  return {
    start: overrides.start ?? (async () => {
      throw new Error("start not stubbed");
    }),
    getStatus: overrides.getStatus ?? (async () => null),
  } as never;
}

describe("POST /api/audit", () => {
  test("starts an audit run for the owner", async () => {
    ownerImpl = async () => ({ userId: "owner-1" });
    const service = stubService({
      start: async (ownerId, options) => {
        expect(ownerId).toBe("owner-1");
        expect(options).toEqual({ syncRunId: "sync-1", auditRunId: undefined });
        return {
          id: "audit-1",
          syncRunId: "sync-1",
          status: "completed",
          processedCount: 3,
          totalEligible: 3,
          nextCursor: null,
          malformedCount: 0,
          errorCode: null,
        };
      },
    });
    const response = await handleAuditPost(postRequest({ syncRunId: "sync-1" }), service);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      id: "audit-1",
      syncRunId: "sync-1",
      status: "completed",
      processedCount: 3,
      totalEligible: 3,
      nextCursor: null,
      malformedCount: 0,
      errorCode: null,
    });
  });

  test("passes trimmed auditRunId for resume", async () => {
    ownerImpl = async () => ({ userId: "owner-1" });
    const service = stubService({
      start: async (_ownerId, options) => {
        expect(options).toEqual({ syncRunId: "sync-1", auditRunId: "audit-1" });
        return {
          id: "audit-1",
          syncRunId: "sync-1",
          status: "completed",
          processedCount: 1,
          totalEligible: 1,
          nextCursor: null,
          malformedCount: 0,
          errorCode: null,
        };
      },
    });
    const response = await handleAuditPost(
      postRequest({ syncRunId: "sync-1", auditRunId: " audit-1 " }),
      service,
    );
    expect(response.status).toBe(200);
  });

  test("treats empty auditRunId as undefined", async () => {
    ownerImpl = async () => ({ userId: "owner-1" });
    const service = stubService({
      start: async (_ownerId, options) => {
        expect(options).toEqual({ syncRunId: "sync-1", auditRunId: undefined });
        return {
          id: "audit-2",
          syncRunId: "sync-1",
          status: "completed",
          processedCount: 0,
          totalEligible: 0,
          nextCursor: null,
          malformedCount: 0,
          errorCode: null,
        };
      },
    });
    const response = await handleAuditPost(
      postRequest({ syncRunId: "sync-1", auditRunId: "" }),
      service,
    );
    expect(response.status).toBe(200);
  });

  test("rejects cross-origin with sanitized error", async () => {
    ownerImpl = async () => ({ userId: "owner-1" });
    const response = await handleAuditPost(
      postRequest({ syncRunId: "sync-1" }, "http://evil.example"),
      stubService({}),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Request could not be completed" });
  });

  test("rejects non-owner with sanitized error", async () => {
    ownerImpl = async () => {
      throw new Error("Not found");
    };
    const response = await handleAuditPost(postRequest({ syncRunId: "sync-1" }), stubService({}));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Request could not be completed" });
  });

  test("returns 400 when category intent is incomplete", async () => {
    ownerImpl = async () => ({ userId: "owner-1" });
    const service = stubService({
      start: async () => {
        throw new Error("Category intent is required for every category before starting an audit run");
      },
    });
    const response = await handleAuditPost(postRequest({ syncRunId: "sync-1" }), service);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Category intent is required for every category before starting an audit run",
    });
  });

  test("returns 400 when sync run is not completed", async () => {
    ownerImpl = async () => ({ userId: "owner-1" });
    const service = stubService({
      start: async () => {
        throw new Error("Audit requires a completed sync run");
      },
    });
    const response = await handleAuditPost(postRequest({ syncRunId: "sync-1" }), service);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Audit requires a completed sync run",
    });
  });

  test("returns 400 for AuditAlreadyRunningError", async () => {
    ownerImpl = async () => ({ userId: "owner-1" });
    const service = stubService({
      start: async () => {
        throw new AuditAlreadyRunningError();
      },
    });
    const response = await handleAuditPost(postRequest({ syncRunId: "sync-1" }), service);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Synchronization already running" });
  });

  test("does not disclose missing model config details", async () => {
    ownerImpl = async () => ({ userId: "owner-1" });
    const service = stubService({
      start: async () => {
        throw new Error("Missing required server configuration: MODEL_API_KEY");
      },
    });
    const response = await handleAuditPost(postRequest({ syncRunId: "sync-1" }), service);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Request could not be completed" });
  });

  test("requires syncRunId", async () => {
    ownerImpl = async () => ({ userId: "owner-1" });
    const response = await handleAuditPost(postRequest({}), stubService({}));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "syncRunId is required." });
  });
});

describe("GET /api/audit/:id", () => {
  test("returns status with stable errorCode only", async () => {
    ownerImpl = async () => ({ userId: "owner-1" });
    const service = stubService({
      getStatus: async (ownerId, id) => {
        expect(ownerId).toBe("owner-1");
        expect(id).toBe("audit-1");
        return {
          id: "audit-1",
          syncRunId: "sync-1",
          status: "partial_failure",
          processedCount: 2,
          totalEligible: 2,
          nextCursor: "m3",
          modelProvider: "mock",
          modelName: "mock-model",
          promptVersionId: "pv",
          errorSummary: "lease_lost",
          startedAt: new Date("2026-01-01T00:00:00.000Z"),
          finishedAt: new Date("2026-01-01T00:01:00.000Z"),
        };
      },
    });
    const response = await handleAuditGet(
      new Request("http://localhost:3000/api/audit/audit-1"),
      { params: Promise.resolve({ id: "audit-1" }) },
      service,
    );
    expect(response.status).toBe(200);
    const body = await response.json() as {
      id: string;
      startedAt: string;
      errorCode: string | null;
      errorSummary?: string;
    };
    expect(body.id).toBe("audit-1");
    expect(body.startedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(body.errorCode).toBe("lease_lost");
    expect(body.errorSummary).toBeUndefined();
  });

  test("scrubs non-stable errorSummary values", async () => {
    ownerImpl = async () => ({ userId: "owner-1" });
    const service = stubService({
      getStatus: async () => ({
        id: "audit-1",
        syncRunId: "sync-1",
        status: "failed",
        processedCount: 0,
        totalEligible: 0,
        nextCursor: null,
        modelProvider: "mock",
        modelName: "mock-model",
        promptVersionId: "pv",
        errorSummary: "Missing required server configuration: MODEL_API_KEY",
        startedAt: new Date("2026-01-01T00:00:00.000Z"),
        finishedAt: new Date("2026-01-01T00:01:00.000Z"),
      }),
    });
    const response = await handleAuditGet(
      new Request("http://localhost:3000/api/audit/audit-1"),
      { params: Promise.resolve({ id: "audit-1" }) },
      service,
    );
    const body = await response.json() as { errorCode: string };
    expect(body.errorCode).toBe("audit_failed");
  });

  test("returns 404 when missing", async () => {
    ownerImpl = async () => ({ userId: "owner-1" });
    const response = await handleAuditGet(
      new Request("http://localhost:3000/api/audit/missing"),
      { params: Promise.resolve({ id: "missing" }) },
      stubService({ getStatus: async () => null }),
    );
    expect(response.status).toBe(404);
  });
});
