import { describe, expect, test } from "bun:test";
import {
  clientIpFromHeaders,
  isIpAllowed,
  parseAllowedCidrs,
} from "../server/security/allowed-ips";

describe("parseAllowedCidrs", () => {
  test("splits comma-separated CIDRs and trims", () => {
    expect(parseAllowedCidrs(" 1.2.3.4 , 5.6.7.8/32 ")).toEqual([
      "1.2.3.4",
      "5.6.7.8/32",
    ]);
  });

  test("returns empty when unset", () => {
    expect(parseAllowedCidrs(undefined)).toEqual([]);
    expect(parseAllowedCidrs("")).toEqual([]);
  });
});

describe("clientIpFromHeaders", () => {
  test("prefers X-Vercel-Forwarded-For when present", () => {
    const headers = new Headers({
      "x-vercel-forwarded-for": "203.0.113.99",
      "x-forwarded-for": "203.0.113.10, 10.0.0.1",
      "x-real-ip": "198.51.100.1",
    });
    expect(clientIpFromHeaders(headers)).toBe("203.0.113.99");
  });

  test("prefers the first X-Forwarded-For hop", () => {
    const headers = new Headers({
      "x-forwarded-for": "203.0.113.10, 10.0.0.1",
      "x-real-ip": "198.51.100.1",
    });
    expect(clientIpFromHeaders(headers)).toBe("203.0.113.10");
  });

  test("falls back to X-Real-IP", () => {
    expect(clientIpFromHeaders(new Headers({ "x-real-ip": "198.51.100.1" }))).toBe(
      "198.51.100.1",
    );
  });
});

describe("isIpAllowed", () => {
  test("matches an exact IPv4", () => {
    expect(isIpAllowed("203.0.113.10", ["203.0.113.10"])).toBe(true);
    expect(isIpAllowed("1.2.3.4", ["203.0.113.10"])).toBe(false);
  });

  test("matches an IPv4 CIDR", () => {
    expect(isIpAllowed("203.0.113.10", ["203.0.113.0/24"])).toBe(true);
    expect(isIpAllowed("203.0.114.1", ["203.0.113.0/24"])).toBe(false);
  });

  test("empty allowlist denies everyone (caller should skip the gate)", () => {
    expect(isIpAllowed("1.2.3.4", [])).toBe(false);
  });
});
