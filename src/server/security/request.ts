import "server-only";

function requestHost(headers: Headers): string | null {
  const forwardedHost = headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  return forwardedHost || headers.get("host")?.trim() || null;
}

/**
 * Browser-facing origin for redirects. Do not use `request.url` when the
 * process listens on 0.0.0.0 — that makes redirects point at http://0.0.0.0:3000.
 */
export function publicAppOrigin(request: Request): string {
  const originHeader = request.headers.get("origin");
  if (originHeader) {
    try {
      return new URL(originHeader).origin;
    } catch {
      /* fall through */
    }
  }
  const referer = request.headers.get("referer");
  if (referer) {
    try {
      return new URL(referer).origin;
    } catch {
      /* fall through */
    }
  }
  const host = requestHost(request.headers);
  if (!host) throw new Error("Missing Host for public origin");
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const proto =
    forwardedProto
    || (host.startsWith("localhost") || host.startsWith("127.") || host.startsWith("[::1]")
      ? "http"
      : "https");
  return new URL(`${proto}://${host}`).origin;
}

export function publicAppUrl(request: Request, path: string): URL {
  return new URL(path, `${publicAppOrigin(request)}/`);
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
