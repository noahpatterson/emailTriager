import "server-only";

function requestHost(headers: Headers): string | null {
  const forwardedHost = headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  return forwardedHost || headers.get("host")?.trim() || null;
}

/** Build browser redirects from the configured OAuth callback, never request headers. */
export function publicAppUrl(googleRedirectUri: string, path: string): URL {
  const configuredOrigin = new URL(googleRedirectUri).origin;
  return new URL(path, `${configuredOrigin}/`);
}

/**
 * CSRF guard for browser-initiated state-changing requests.
 * Prefer Host / X-Forwarded-Host over `request.url`: Next standalone with
 * HOSTNAME=0.0.0.0 makes `new URL(request.url).origin` `http://0.0.0.0:3000`,
 * which never matches a browser Origin of `http://localhost:3000`.
 */
export function requireSameOrigin(request: Request): void {
  const originHeader = request.headers.get("origin");
  if (!originHeader) throw new Error("Invalid request origin");
  let origin: URL;
  try {
    origin = new URL(originHeader);
  } catch {
    throw new Error("Invalid request origin");
  }

  const host = requestHost(request.headers);
  if (!host) throw new Error("Invalid request origin");

  let expected: URL;
  try {
    expected = new URL(`${origin.protocol}//${host}`);
  } catch {
    throw new Error("Invalid request origin");
  }

  if (origin.origin !== expected.origin) throw new Error("Invalid request origin");
}

export function sanitizedErrorResponse(status = 400): Response {
  return Response.json({ error: "Request could not be completed" }, { status });
}
