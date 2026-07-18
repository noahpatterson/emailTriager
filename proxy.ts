import { NextResponse, type NextRequest } from "next/server";
import { getNeonAuth } from "@/src/server/auth/neon";

const authMiddleware = getNeonAuth().middleware({
  loginUrl: "/auth/sign-in",
});

export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // App JSON APIs authorize in the route handler. Neon Auth middleware
  // redirects anonymous requests to an HTML login page, which breaks fetch().
  if (pathname.startsWith("/api/") && !pathname.startsWith("/api/auth")) {
    return NextResponse.next();
  }
  return authMiddleware(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
