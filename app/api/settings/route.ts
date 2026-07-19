import { requireOwner } from "@/src/server/auth/owner";
import { OwnerPreferencesService } from "@/src/server/config/owner-preferences";
import { requireSameOrigin, sanitizedErrorResponse } from "@/src/server/security/request";

export async function GET(): Promise<Response> {
  try {
    const owner = await requireOwner();
    const gmailMessageLinkRoot = await new OwnerPreferencesService()
      .getGmailMessageLinkRoot(owner.userId);
    return Response.json({ gmailMessageLinkRoot });
  } catch {
    return sanitizedErrorResponse();
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    requireSameOrigin(request);
    const owner = await requireOwner();
    const body = await request.json() as { gmailMessageLinkRoot?: unknown };
    if (typeof body.gmailMessageLinkRoot !== "string") {
      return Response.json({ error: "Gmail message link root is required." }, { status: 400 });
    }
    try {
      const gmailMessageLinkRoot = await new OwnerPreferencesService()
        .setGmailMessageLinkRoot(owner.userId, body.gmailMessageLinkRoot);
      return Response.json({ gmailMessageLinkRoot });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "";
      if (message.includes("Gmail message link root")) {
        return Response.json({ error: message }, { status: 400 });
      }
      throw caught;
    }
  } catch {
    return sanitizedErrorResponse();
  }
}
