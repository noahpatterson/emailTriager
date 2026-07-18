import { requireOwner } from "@/src/server/auth/owner";
import { GoogleConnectionService } from "@/src/server/oauth/google";
import { requireSameOrigin, sanitizedErrorResponse } from "@/src/server/security/request";
export async function POST(request: Request): Promise<Response> { try { requireSameOrigin(request); const owner = await requireOwner(); const result = await new GoogleConnectionService().begin(owner.userId); return Response.json(result); } catch { return sanitizedErrorResponse(); } }
