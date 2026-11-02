import { afterEach, describe, expect, test } from "bun:test";
import config from "../../next.config";
import { requireSameOrigin } from "../server/security/request";
import { listBounded, syncBoundsFor } from "../server/gmail/sync";
import { GoogleGmailProvider } from "../server/gmail/google";

const originalProfile = process.env.APP_PROFILE;
const originalCallback = process.env.GOOGLE_REDIRECT_URI;
afterEach(() => {
  if (originalProfile === undefined) delete process.env.APP_PROFILE;
  else process.env.APP_PROFILE = originalProfile;
  if (originalCallback === undefined) delete process.env.GOOGLE_REDIRECT_URI;
  else process.env.GOOGLE_REDIRECT_URI = originalCallback;
});

describe("personal hosting boundaries", () => {
  test("requires the canonical origin even when forwarded host agrees with another deployment URL", () => {
    process.env.APP_PROFILE = "personal";
    process.env.GOOGLE_REDIRECT_URI = "https://mail.example.com/api/oauth/google/callback";
    const request = (origin: string) => new Request(`${origin}/api/sync`, {
      method: "POST", headers: { origin, "x-forwarded-host": new URL(origin).host },
    });
    expect(() => requireSameOrigin(request("https://preview.example.com"))).toThrow("Invalid request origin");
    expect(requireSameOrigin(request("https://mail.example.com"))).toBeUndefined();
  });

  test("returns only one small personal Gmail page and preserves continuation", async () => {
    process.env.APP_PROFILE = "personal";
    const messages = Array.from({ length: 12 }, (_, index) => ({ id: `m${index}`, threadId: `t${index}` }));
    const provider = new GoogleGmailProvider("fixture-token", async (input) => {
      const params = new URL(String(input)).searchParams;
      const offset = Number(params.get("pageToken") ?? 0);
      const end = offset + Number(params.get("maxResults"));
      return Response.json({ messages: messages.slice(offset, end), nextPageToken: end < messages.length ? String(end) : undefined });
    });
    const bounds = syncBoundsFor(false, { maxPages: 10, maxMessagesPerPage: 100, maxTotalMessages: 100 });
    const first = await listBounded(provider, "Label_source", bounds);
    expect(first.messageIds).toEqual(["m0", "m1", "m2", "m3", "m4"]);
    expect(first.exhausted).toBe(false);
    const next = await listBounded(provider, "Label_source", bounds, first.nextPageToken);
    expect(next.messageIds).toEqual(["m5", "m6", "m7", "m8", "m9"]);
    expect(next.exhausted).toBe(false);
  });

  test("sends private API responses with no-store and blocks framing", async () => {
    const rules = await config.headers!();
    expect(rules.find(rule => rule.source === "/api/:path*")?.headers).toContainEqual({ key: "Cache-Control", value: "private, no-store, max-age=0" });
    expect(rules.find(rule => rule.source === "/:path*")?.headers).toContainEqual({ key: "X-Frame-Options", value: "DENY" });
  });
});
