import { NextRequest, NextResponse } from "next/server";
import {
  assertInsecureLocalDevAllowed,
  assertInsecureLocalDevRequest,
  isInsecureLocalDevRequested,
} from "@/src/server/auth/local-dev-flags";

/** Rewrite listen-address hostnames so Neon Auth redirects keep the browser origin. */
function withBrowserFacingUrl(request: NextRequest): NextRequest {
  const hostname = request.nextUrl.hostname;
  if (hostname !== "0.0.0.0" && hostname !== "::" && hostname !== "[::]") {
    return request;
  }
  const hostHeader =
    request.headers.get("x-forwarded-host")?.split(",")[0]?.trim()
    || request.headers.get("host")?.trim();
  if (!hostHeader) return request;
  try {
    const authority = new URL(`http://${hostHeader}`);
    const url = request.nextUrl.clone();
    url.hostname = authority.hostname;
    url.port = authority.port;
    return new NextRequest(url, request);
  } catch {
    return request;
  }
}

export default async function proxy(request: NextRequest) {
  try {
    const driver =
      process.env.DATABASE_DRIVER?.trim().toLowerCase() || "neon-http";
    assertInsecureLocalDevAllowed(driver);
    if (isInsecureLocalDevRequested())
      assertInsecureLocalDevRequest(request.headers);
  } catch (error) {
    return new NextResponse(
      error instanceof Error
        ? error.message
        : "Invalid insecure local configuration",
      { status: 500 },
    );
  }

  if (isInsecureLocalDevRequested()) {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;
  // App JSON APIs authorize in the route handler. Neon Auth middleware
  // redirects anonymous requests to an HTML login page, which breaks fetch().
  if (pathname.startsWith("/api/") && !pathname.startsWith("/api/auth")) {
    return NextResponse.next();
  }
  // Public brand assets must stay reachable; otherwise next/image fetches the
  // login HTML and returns 400 ("isn't a valid image").
  if (
    pathname.startsWith("/brand/") ||
    /\.(?:png|jpe?g|gif|webp|svg|ico)$/i.test(pathname)
  ) {
    return NextResponse.next();
  }

  const { getNeonAuth } = await import("@/src/server/auth/neon");
  return getNeonAuth().middleware({ loginUrl: "/auth/sign-in" })(
    withBrowserFacingUrl(request),
  );
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|brand/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
