import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

let ownerImpl: () => Promise<{ userId: string }> = async () => ({ userId: "owner-1" });
let getQueueImpl: (ownerId: string) => Promise<unknown> = async () => {
  throw new Error("getQueue not stubbed");
};
let submitImpl: (
  ownerId: string,
  messageId: string,
  ownerLabel: unknown,
) => Promise<unknown> = async () => {
  throw new Error("submit not stubbed");
};

mock.module("@/src/server/auth/owner", () => ({
  requireOwner: () => ownerImpl(),
}));

mock.module("@/src/server/gmail/review-service", () => ({
  ReviewService: class {
    getQueue(ownerId: string): Promise<unknown> {
      return getQueueImpl(ownerId);
    }
    submitOwnerLabel(
      ownerId: string,
      messageId: string,
      ownerLabel: unknown,
    ): Promise<unknown> {
      return submitImpl(ownerId, messageId, ownerLabel);
    }
  },
}));

const { ReviewClientError } = await import("../../src/server/gmail/review-queue");
const { GET } = await import("../../app/api/review/queue/route");
const { POST } = await import("../../app/api/review/[messageId]/route");

function getRequest(origin = "http://localhost:3000"): Request {
  return new Request("http://localhost:3000/api/review/queue", {
    method: "GET",
    headers: { origin, host: "localhost:3000" },
  });
}

function postRequest(
  messageId: string,
  body: unknown,
  origin = "http://localhost:3000",
): Request {
  return new Request(`http://localhost:3000/api/review/${encodeURIComponent(messageId)}`, {
    method: "POST",
    headers: {
      origin,
      host: "localhost:3000",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("GET /api/review/queue", () => {
  test("returns stratified queue for owner", async () => {
    ownerImpl = async () => ({ userId: "owner-1" });
    getQueueImpl = async (ownerId) => {
      expect(ownerId).toBe("owner-1");
      return {
        auditRunId: "audit-1",
        syncRunId: "sync-1",
        categoryIntent: {
          priority: "p",
          review: "r",
          new: "n",
          archive: "a",
        },
        items: [
          {
            gmailMessageId: "m1",
            agreesWithFiling: false,
            deterministicOutcome: "archive",
            recommendedCategory: "priority",
            subject: "Urgent outage",
            from: "ops@example.com",
            bodyExcerpt: "down",
          },
        ],
      };
    };
    const response = await GET(getRequest());
    expect(response.status).toBe(200);
    const body = await response.json() as {
      auditRunId: string;
      items: Array<{ gmailMessageId: string }>;
    };
    expect(body.auditRunId).toBe("audit-1");
    expect(body.items[0]?.gmailMessageId).toBe("m1");
  });

  test("rejects non-owner with sanitized error", async () => {
    ownerImpl = async () => {
      throw new Error("Not found");
    };
    const response = await GET(getRequest());
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Request could not be completed" });
  });
});

describe("POST /api/review/:messageId", () => {
  test("persists owner label without Gmail mutation surface", async () => {
    ownerImpl = async () => ({ userId: "owner-1" });
    submitImpl = async (ownerId, messageId, ownerLabel) => {
      expect(ownerId).toBe("owner-1");
      expect(messageId).toBe("msg/1");
      expect(ownerLabel).toBe("priority");
      return {
        gmailMessageId: messageId,
        ownerLabel: "priority",
        goldenSetId: 9,
        partition: "holdout",
        created: true,
      };
    };
    const response = await POST(postRequest("msg/1", { ownerLabel: "priority" }), {
      params: Promise.resolve({ messageId: "msg%2F1" }),
    });
    expect(response.status).toBe(200);
    const body = await response.json() as {
      partition: string;
      created: boolean;
      ownerLabel: string;
    };
    expect(body.partition).toBe("holdout");
    expect(body.created).toBe(true);
    expect(body.ownerLabel).toBe("priority");
    expect(JSON.stringify(body)).not.toContain("modifyLabels");
  });

  test("rejects cross-origin requests", async () => {
    ownerImpl = async () => ({ userId: "owner-1" });
    const response = await POST(
      postRequest("m1", { ownerLabel: "priority" }, "http://evil.example"),
      { params: Promise.resolve({ messageId: "m1" }) },
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Request could not be completed" });
  });

  test("maps ReviewClientError to 400", async () => {
    ownerImpl = async () => ({ userId: "owner-1" });
    submitImpl = async () => {
      throw new ReviewClientError("ownerLabel must be priority, review, new, or archive.");
    };
    const response = await POST(postRequest("m1", { ownerLabel: "nope" }), {
      params: Promise.resolve({ messageId: "m1" }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "ownerLabel must be priority, review, new, or archive.",
    });
  });
});
