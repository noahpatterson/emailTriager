import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

let ownerImpl: () => Promise<{ userId: string }> = async () => ({ userId: "owner-1" });
let getQueueImpl: (ownerId: string) => Promise<unknown> = async () => {
  throw new Error("getQueue not stubbed");
};
let confirmImpl: (ownerId: string, messageId: string) => Promise<unknown> = async () => {
  throw new Error("confirm not stubbed");
};

mock.module("@/src/server/auth/owner", () => ({
  requireOwner: () => ownerImpl(),
}));

mock.module("@/src/server/gmail/demotion-service", () => ({
  DemotionClientError: class DemotionClientError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "DemotionClientError";
    }
  },
  DemotionService: class {
    getQueue(ownerId: string): Promise<unknown> {
      return getQueueImpl(ownerId);
    }
    confirmDemotion(ownerId: string, messageId: string): Promise<unknown> {
      return confirmImpl(ownerId, messageId);
    }
  },
}));

const { DemotionClientError } = await import("../../src/server/gmail/demotion-service");
const { GET } = await import("../../app/api/demotion/queue/route");
const { POST } = await import("../../app/api/demotion/[messageId]/route");

function getRequest(origin = "http://localhost:3000"): Request {
  return new Request("http://localhost:3000/api/demotion/queue", {
    method: "GET",
    headers: { origin, host: "localhost:3000" },
  });
}

function postRequest(messageId: string, origin = "http://localhost:3000"): Request {
  return new Request(`http://localhost:3000/api/demotion/${encodeURIComponent(messageId)}`, {
    method: "POST",
    headers: {
      origin,
      host: "localhost:3000",
      "content-type": "application/json",
    },
  });
}

describe("GET /api/demotion/queue", () => {
  test("returns pending demotions for owner", async () => {
    ownerImpl = async () => ({ userId: "owner-1" });
    getQueueImpl = async (ownerId) => {
      expect(ownerId).toBe("owner-1");
      return {
        pendingCount: 1,
        items: [{
          id: 1,
          gmailMessageId: "m1",
          verdictId: 9,
          recommendedCategory: "archive",
          rationale: "noise",
          subject: "Sale",
          from: "promo@x",
          bodyExcerpt: "buy now",
          createdAt: "2026-08-07T00:00:00.000Z",
        }],
      };
    };
    const response = await GET(getRequest());
    expect(response.status).toBe(200);
    const body = await response.json() as { pendingCount: number; items: unknown[] };
    expect(body.pendingCount).toBe(1);
    expect(body.items).toHaveLength(1);
  });
});

describe("POST /api/demotion/:messageId", () => {
  test("confirms demotion for owner", async () => {
    ownerImpl = async () => ({ userId: "owner-1" });
    confirmImpl = async (ownerId, messageId) => {
      expect(ownerId).toBe("owner-1");
      expect(messageId).toBe("m1");
      return { gmailMessageId: "m1", confirmed: true, alreadyConfirmed: false };
    };
    const response = await POST(postRequest("m1"), { params: Promise.resolve({ messageId: "m1" }) });
    expect(response.status).toBe(200);
    const body = await response.json() as { confirmed: boolean };
    expect(body.confirmed).toBe(true);
  });

  test("maps DemotionClientError to 400", async () => {
    ownerImpl = async () => ({ userId: "owner-1" });
    confirmImpl = async () => {
      throw new DemotionClientError("Pending demotion not found");
    };
    const response = await POST(postRequest("missing"), {
      params: Promise.resolve({ messageId: "missing" }),
    });
    expect(response.status).toBe(400);
    const body = await response.json() as { error: string };
    expect(body.error).toBe("Pending demotion not found");
  });

  test("rejects cross-origin posts", async () => {
    const response = await POST(postRequest("m1", "https://evil.example"), {
      params: Promise.resolve({ messageId: "m1" }),
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
  });
});
