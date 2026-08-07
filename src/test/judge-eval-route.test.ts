import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

let ownerImpl: () => Promise<{ userId: string }> = async () => ({ userId: "owner-1" });
let runImpl: (ownerId: string) => Promise<unknown> = async () => {
  throw new Error("run not stubbed");
};

mock.module("@/src/server/auth/owner", () => ({
  requireOwner: () => ownerImpl(),
}));

mock.module("@/src/server/gmail/judge-eval-service", () => {
  class JudgeEvalClientError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "JudgeEvalClientError";
    }
  }
  return {
    JudgeEvalClientError,
    JudgeEvalService: class {
      run(ownerId: string): Promise<unknown> {
        return runImpl(ownerId);
      }
    },
  };
});

mock.module("@/src/server/gmail/judge", () => {
  class JudgeTransportError extends Error {
    readonly code = "judge_transport" as const;
    constructor(message: string) {
      super(message);
      this.name = "JudgeTransportError";
    }
  }
  return { JudgeTransportError };
});

const { POST } = await import("../../app/api/eval/judge/route");
const { JudgeEvalClientError } = await import("../../src/server/gmail/judge-eval-service");
const { JudgeTransportError } = await import("../../src/server/gmail/judge");

function request(origin = "http://localhost:3000"): Request {
  return new Request("http://localhost:3000/api/eval/judge", {
    method: "POST",
    headers: {
      origin,
      host: "localhost:3000",
      "content-type": "application/json",
    },
    body: "{}",
  });
}

describe("POST /api/eval/judge", () => {
  test("returns judge metrics tagged with model, provider, prompt version", async () => {
    ownerImpl = async () => ({ userId: "owner-1" });
    runImpl = async (ownerId) => {
      expect(ownerId).toBe("owner-1");
      return {
        id: "eval-1",
        candidate: {
          model: "gpt-test",
          provider: "openai-compatible",
          promptVersion: "abc123",
        },
        metrics: {
          holdoutSize: 10,
          accuracy: 0.8,
          disagreementRate: 0.2,
          malformedOutputRate: 0.1,
        },
        tags: {
          model: "gpt-test",
          provider: "openai-compatible",
          promptVersion: "abc123",
        },
      };
    };
    const response = await POST(request());
    expect(response.status).toBe(200);
    const body = await response.json() as {
      type: string;
      tags: { model: string; provider: string; promptVersion: string };
      metrics: { accuracy: number; malformedOutputRate: number };
    };
    expect(body.type).toBe("judge");
    expect(body.tags).toEqual({
      model: "gpt-test",
      provider: "openai-compatible",
      promptVersion: "abc123",
    });
    expect(body.metrics.accuracy).toBe(0.8);
    expect(body.metrics.malformedOutputRate).toBe(0.1);
  });

  test("rejects cross-origin requests", async () => {
    ownerImpl = async () => ({ userId: "owner-1" });
    const response = await POST(request("http://evil.example"));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Request could not be completed" });
  });

  test("maps JudgeEvalClientError to 400", async () => {
    ownerImpl = async () => ({ userId: "owner-1" });
    runImpl = async () => {
      throw new JudgeEvalClientError("Category intent is required for every category before running judge eval");
    };
    const response = await POST(request());
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Category intent is required for every category before running judge eval",
    });
  });

  test("maps JudgeTransportError to 502", async () => {
    ownerImpl = async () => ({ userId: "owner-1" });
    runImpl = async () => {
      throw new JudgeTransportError("timeout");
    };
    const response = await POST(request());
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Judge call failed" });
  });
});
