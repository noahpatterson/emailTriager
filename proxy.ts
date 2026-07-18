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
  // Public brand assets must stay reachable; otherwise next/image fetches the
  // login HTML and returns 400 ("isn't a valid image").
  if (pathname.startsWith("/brand/") || /\.(?:png|jpe?g|gif|webp|svg|ico)$/i.test(pathname)) {
    return NextResponse.next();
  }
  return authMiddleware(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|brand/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
