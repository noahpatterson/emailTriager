import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

let ownerImpl: () => Promise<{ userId: string }> = async () => ({ userId: "owner-1" });
let startImpl: (ownerId: string, options: unknown) => Promise<unknown> = async () => {
  throw new Error("start not stubbed");
};
let statusImpl: (ownerId: string, id: string) => Promise<unknown> = async () => null;

mock.module("@/src/server/auth/owner", () => ({
  requireOwner: () => ownerImpl(),
}));

mock.module("@/src/server/gmail/audit-run", () => ({
  AuditRunService: class {
    start(ownerId: string, options: unknown): Promise<unknown> {
      return startImpl(ownerId, options);
    }
    getStatus(ownerId: string, id: string): Promise<unknown> {
      return statusImpl(ownerId, id);
    }
  },
}));

const { POST } = await import("../../app/api/audit/route");
const { GET } = await import("../../app/api/audit/[id]/route");

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

describe("POST /api/audit", () => {
  test("starts an audit run for the owner", async () => {
    ownerImpl = async () => ({ userId: "owner-1" });
    startImpl = async (ownerId, options) => {
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
      };
    };
    const response = await POST(postRequest({ syncRunId: "sync-1" }));
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      id: "audit-1",
      syncRunId: "sync-1",
      status: "completed",
      processedCount: 3,
      totalEligible: 3,
      nextCursor: null,
      malformedCount: 0,
    });
  });

  test("rejects cross-origin with sanitized error", async () => {
    ownerImpl = async () => ({ userId: "owner-1" });
    const response = await POST(postRequest({ syncRunId: "sync-1" }, "http://evil.example"));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Request could not be completed" });
  });

  test("rejects non-owner with sanitized error", async () => {
    ownerImpl = async () => {
      throw new Error("Not found");
    };
    const response = await POST(postRequest({ syncRunId: "sync-1" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Request could not be completed" });
  });

  test("returns 400 when category intent is incomplete", async () => {
    ownerImpl = async () => ({ userId: "owner-1" });
    startImpl = async () => {
      throw new Error("Category intent is required for every category before starting an audit run");
    };
    const response = await POST(postRequest({ syncRunId: "sync-1" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Category intent is required for every category before starting an audit run",
    });
  });

  test("returns 400 when sync run is not completed", async () => {
    ownerImpl = async () => ({ userId: "owner-1" });
    startImpl = async () => {
      throw new Error("Audit requires a completed sync run");
    };
    const response = await POST(postRequest({ syncRunId: "sync-1" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Audit requires a completed sync run",
    });
  });

  test("does not disclose missing model config details", async () => {
    ownerImpl = async () => ({ userId: "owner-1" });
    startImpl = async () => {
      throw new Error("Missing required server configuration: MODEL_API_KEY");
    };
    const response = await POST(postRequest({ syncRunId: "sync-1" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Request could not be completed" });
  });

  test("requires syncRunId", async () => {
    ownerImpl = async () => ({ userId: "owner-1" });
    const response = await POST(postRequest({}));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "syncRunId is required." });
  });
});

describe("GET /api/audit/:id", () => {
  test("returns status for the owner", async () => {
    ownerImpl = async () => ({ userId: "owner-1" });
    statusImpl = async (ownerId, id) => {
      expect(ownerId).toBe("owner-1");
      expect(id).toBe("audit-1");
      return {
        id: "audit-1",
        syncRunId: "sync-1",
        status: "completed",
        processedCount: 2,
        totalEligible: 2,
        nextCursor: null,
        modelProvider: "mock",
        modelName: "mock-model",
        promptVersionId: "pv",
        errorSummary: null,
        startedAt: new Date("2026-01-01T00:00:00.000Z"),
        finishedAt: new Date("2026-01-01T00:01:00.000Z"),
      };
    };
    const response = await GET(new Request("http://localhost:3000/api/audit/audit-1"), {
      params: Promise.resolve({ id: "audit-1" }),
    });
    expect(response.status).toBe(200);
    const body = await response.json() as { id: string; startedAt: string };
    expect(body.id).toBe("audit-1");
    expect(body.startedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  test("returns 404 when missing", async () => {
    ownerImpl = async () => ({ userId: "owner-1" });
    statusImpl = async () => null;
    const response = await GET(new Request("http://localhost:3000/api/audit/missing"), {
      params: Promise.resolve({ id: "missing" }),
    });
    expect(response.status).toBe(404);
  });
});
