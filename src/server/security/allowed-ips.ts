/**
 * Operator IP allowlist for the public Vercel spike.
 * Empty allowlist means "gate disabled" at the call site — never treat empty as allow-all inside isIpAllowed.
 */

export function parseAllowedCidrs(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export function clientIpFromHeaders(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded) return forwarded;
  return headers.get("x-real-ip")?.trim() || null;
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
    value = (value << 8) + octet;
  }
  return value >>> 0;
}

/** True when `ip` is listed exactly or falls inside an IPv4 CIDR entry. */
export function isIpAllowed(ip: string, allowedCidrs: readonly string[]): boolean {
  if (allowedCidrs.length === 0) return false;
  const ipInt = ipv4ToInt(ip);
  if (ipInt === null) return false;

  for (const entry of allowedCidrs) {
    const [base, prefixRaw] = entry.split("/");
    const baseInt = ipv4ToInt(base ?? "");
    if (baseInt === null) continue;
    if (prefixRaw === undefined) {
      if (ipInt === baseInt) return true;
      continue;
    }
    const prefix = Number(prefixRaw);
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) continue;
    const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
    if ((ipInt & mask) === (baseInt & mask)) return true;
  }
  return false;
}
