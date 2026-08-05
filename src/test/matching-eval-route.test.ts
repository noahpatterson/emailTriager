import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

let ownerImpl: () => Promise<{ userId: string }> = async () => ({ userId: "owner-1" });
let runImpl: (
  ownerId: string,
  terms: unknown,
  options?: unknown,
) => Promise<unknown> = async () => {
  throw new Error("run not stubbed");
};

mock.module("@/src/server/auth/owner", () => ({
  requireOwner: () => ownerImpl(),
}));

mock.module("@/src/server/gmail/matching-eval-service", () => ({
  MatchingEvalService: class {
    run(
      ownerId: string,
      terms: unknown,
      options?: unknown,
    ): Promise<unknown> {
      return runImpl(ownerId, terms, options);
    }
  },
}));

const { POST } = await import("../../app/api/eval/matching/route");

function request(body: unknown, origin = "http://localhost:3000"): Request {
  return new Request("http://localhost:3000/api/eval/matching", {
    method: "POST",
    headers: {
      origin,
      host: "localhost:3000",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/eval/matching", () => {
  test("returns metrics for an owner with valid terms", async () => {
    ownerImpl = async () => ({ userId: "owner-1" });
    runImpl = async (ownerId, terms, options) => {
      expect(ownerId).toBe("owner-1");
      expect(terms).toEqual({ priority: ["urgent"], review: [], new: [] });
      expect(options).toEqual({
        bounds: { maxPages: 3, maxMessagesPerPage: 50, maxTotalMessages: 100 },
      });
      return {
        id: "run-1",
        candidate: {
          terms,
          bounds: { maxPages: 3, maxMessagesPerPage: 50, maxTotalMessages: 100 },
        },
        metrics: { holdoutSize: 75, weightedError: 19.3, scored: 75, skipped: 0 },
      };
    };

    const response = await POST(
      request({
        terms: { priority: ["urgent"], review: [], new: [] },
        bounds: { maxPages: 3, maxMessagesPerPage: 50, maxTotalMessages: 100 },
      }),
    );
    expect(response.status).toBe(200);
    const body = await response.json() as {
      id: string;
      type: string;
      metrics: { weightedError: number };
      candidate: { terms: { priority: string[] } };
    };
    expect(body.id).toBe("run-1");
    expect(body.type).toBe("matching");
    expect(body.metrics.weightedError).toBe(19.3);
    expect(body.candidate.terms.priority).toEqual(["urgent"]);
    expect(JSON.stringify(body)).not.toContain("bodyText");
  });

  test("rejects cross-origin requests with sanitized error", async () => {
    ownerImpl = async () => ({ userId: "owner-1" });
    const response = await POST(
      request({ terms: { priority: [], review: [], new: [] } }, "http://evil.example"),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Request could not be completed" });
  });

  test("rejects non-owner with sanitized error", async () => {
    ownerImpl = async () => {
      throw new Error("Not found");
    };
    const response = await POST(request({ terms: { priority: [], review: [], new: [] } }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Request could not be completed" });
  });

  test("returns 400 for invalid classification terms", async () => {
    ownerImpl = async () => ({ userId: "owner-1" });
    runImpl = async () => {
      throw new Error("Invalid classification term");
    };
    const response = await POST(request({ terms: { priority: [""], review: [], new: [] } }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid classification term" });
  });

  test("rejects non-JSON body with 400", async () => {
    ownerImpl = async () => ({ userId: "owner-1" });
    const response = await POST(
      new Request("http://localhost:3000/api/eval/matching", {
        method: "POST",
        headers: {
          origin: "http://localhost:3000",
          host: "localhost:3000",
          "content-type": "application/json",
        },
        body: "not-json",
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Request body must be JSON with terms." });
  });
});
