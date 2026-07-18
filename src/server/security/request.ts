import "server-only";
export function requireSameOrigin(request: Request): void { const origin = request.headers.get("origin"); if (!origin || origin !== new URL(request.url).origin) throw new Error("Invalid request origin"); }
export function sanitizedErrorResponse(status = 400): Response { return Response.json({ error: "Request could not be completed" }, { status }); }
