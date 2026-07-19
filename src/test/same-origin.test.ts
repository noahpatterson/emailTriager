import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const { publicAppUrl, requireSameOrigin } = await import(
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

describe("publicAppUrl", () => {
  test("uses the configured OAuth callback origin for redirects", () => {
    expect(
      publicAppUrl(
        "https://mail-triage.example/api/oauth/google/callback",
        "/",
      ).toString(),
    ).toBe("https://mail-triage.example/");
  });

  test("supports the configured loopback callback used by Docker", () => {
    expect(
      publicAppUrl(
        "http://localhost:3000/api/oauth/google/callback",
        "/",
      ).toString(),
    ).toBe("http://localhost:3000/");
  });
});
