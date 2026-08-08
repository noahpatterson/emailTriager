import { describe, expect, test } from "bun:test";
import {
  DEMO_RESET_COPY,
  DEMO_SESSION_COOKIE,
  hashDemoSessionToken,
  mintDemoSessionToken,
  mintFakeGoogleSubject,
  mintSyntheticOwnerId,
} from "@/src/server/demo/session-token";

describe("demo session tokens", () => {
  test("mints unique opaque tokens and hashes them stably", () => {
    const a = mintDemoSessionToken();
    const b = mintDemoSessionToken();
    expect(a).not.toEqual(b);
    expect(a).toHaveLength(64);
    expect(hashDemoSessionToken(a)).toHaveLength(64);
    expect(hashDemoSessionToken(a)).toEqual(hashDemoSessionToken(a));
    expect(hashDemoSessionToken(a)).not.toEqual(hashDemoSessionToken(b));
  });

  test("mints distinct synthetic owner ids and google subjects", () => {
    expect(mintSyntheticOwnerId()).toMatch(/^demo_[a-f0-9]{32}$/);
    expect(mintFakeGoogleSubject()).toMatch(/^demo-google-sub_[a-f0-9]{32}$/);
    expect(mintSyntheticOwnerId()).not.toEqual(mintSyntheticOwnerId());
    expect(mintFakeGoogleSubject()).not.toEqual(mintFakeGoogleSubject());
  });

  test("exposes the cookie name and reset copy from the issue", () => {
    expect(DEMO_SESSION_COOKIE).toBe("et_demo_session");
    expect(DEMO_RESET_COPY).toBe(
      "Clear my demo data removes everything associated with your session. Other visitors cannot see your messages. This cannot be undone.",
    );
  });
});
