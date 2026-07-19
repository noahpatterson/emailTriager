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
    const invalidBody = Response.json(
      { error: "Gmail message link root is required." },
      { status: 400 },
    );
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return invalidBody;
    }
    if (body === null || typeof body !== "object") {
      return invalidBody;
    }
    const gmailMessageLinkRootValue = (body as { gmailMessageLinkRoot?: unknown }).gmailMessageLinkRoot;
    if (typeof gmailMessageLinkRootValue !== "string") {
      return invalidBody;
    }
    try {
      const gmailMessageLinkRoot = await new OwnerPreferencesService()
        .setGmailMessageLinkRoot(owner.userId, gmailMessageLinkRootValue);
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
