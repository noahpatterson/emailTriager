import { NextResponse, type NextRequest } from "next/server";
import {
  assertInsecureLocalDevAllowed,
  isInsecureLocalDevRequested,
} from "@/src/server/auth/local-dev-flags";

export default async function proxy(request: NextRequest) {
  try {
    const driver = process.env.DATABASE_DRIVER?.trim().toLowerCase() || "neon-http";
    assertInsecureLocalDevAllowed(driver);
  } catch (error) {
    return new NextResponse(
      error instanceof Error ? error.message : "Invalid insecure local configuration",
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
  if (pathname.startsWith("/brand/") || /\.(?:png|jpe?g|gif|webp|svg|ico)$/i.test(pathname)) {
    return NextResponse.next();
  }

  const { getNeonAuth } = await import("@/src/server/auth/neon");
  return getNeonAuth().middleware({ loginUrl: "/auth/sign-in" })(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|brand/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
