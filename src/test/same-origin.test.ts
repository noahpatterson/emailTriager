import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const { publicAppOrigin, publicAppUrl, requireSameOrigin } = await import(
  "../server/security/request"
);

describe("requireSameOrigin", () => {
  test("accepts Origin matching Host when request.url uses 0.0.0.0", () => {
    const request = new Request("http://0.0.0.0:3000/api/oauth/google/start", {
      method: "POST",
      headers: {
        origin: "http://localhost:3000",
        host: "localhost:3000",
      },
    });
    expect(() => requireSameOrigin(request)).not.toThrow();
  });

  test("rejects Origin that does not match Host", () => {
    const request = new Request("http://localhost:3000/api/oauth/google/start", {
      method: "POST",
      headers: {
        origin: "http://evil.example",
        host: "localhost:3000",
      },
    });
    expect(() => requireSameOrigin(request)).toThrow(/origin/i);
  });

  test("rejects missing Origin", () => {
    const request = new Request("http://localhost:3000/api/oauth/google/start", {
      method: "POST",
      headers: { host: "localhost:3000" },
    });
    expect(() => requireSameOrigin(request)).toThrow(/origin/i);
  });
});

describe("publicAppOrigin", () => {
  test("prefers Host over 0.0.0.0 request.url for redirects", () => {
    const request = new Request("http://0.0.0.0:3000/api/oauth/google/callback?code=1", {
      headers: { host: "localhost:3000" },
    });
    expect(publicAppOrigin(request)).toBe("http://localhost:3000");
    expect(publicAppUrl(request, "/").toString()).toBe("http://localhost:3000/");
  });

  test("prefers Origin when present", () => {
    const request = new Request("http://0.0.0.0:3000/", {
      headers: {
        host: "127.0.0.1:3000",
        origin: "http://localhost:3000",
      },
    });
    expect(publicAppOrigin(request)).toBe("http://localhost:3000");
  });
});
