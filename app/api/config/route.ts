import { withOwner } from "@/src/server/auth/owner";
import { TriageConfigService } from "@/src/server/config/triage";
import {
  asCategoryIntent,
  asStringArray,
  asTerms,
  type TriageConfigInput,
} from "@/src/server/config/triage-validate";
import { googleProviderForOwner } from "@/src/server/gmail/factory";
import { requireSameOrigin, sanitizedErrorResponse } from "@/src/server/security/request";

function readBounds(value: unknown): TriageConfigInput["bounds"] | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const maxPages = Number(record.maxPages);
  const maxMessagesPerPage = Number(record.maxMessagesPerPage);
  const maxTotalMessages = Number(record.maxTotalMessages);
  if (![maxPages, maxMessagesPerPage, maxTotalMessages].every(Number.isFinite)) return null;
  return { maxPages, maxMessagesPerPage, maxTotalMessages };
}

function parseBody(body: unknown): TriageConfigInput | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const bounds = readBounds(record.bounds);
  if (
    typeof record.sourceLabelId !== "string"
    || typeof record.priorityLabelId !== "string"
    || typeof record.reviewLabelId !== "string"
    || typeof record.newLabelId !== "string"
    || typeof record.archiveLabelId !== "string"
    || !bounds
  ) {
    return null;
  }
  return {
    sourceLabelId: record.sourceLabelId,
    priorityLabelId: record.priorityLabelId,
    reviewLabelId: record.reviewLabelId,
    newLabelId: record.newLabelId,
    archiveLabelId: record.archiveLabelId,
    terms: asTerms(record.terms),
    senderWhitelist: asStringArray(record.senderWhitelist),
    senderBlocklist: asStringArray(record.senderBlocklist),
    categoryIntent: asCategoryIntent(record.categoryIntent),
    autoApplyPromotions: record.autoApplyPromotions === true,
    bounds,
  };
}

export async function GET(): Promise<Response> {
  try {
    return await withOwner(async (owner) => {
      let provider;
      try {
        provider = await googleProviderForOwner(owner.userId);
      } catch {
        provider = undefined;
      }
      const config = await new TriageConfigService().getLatestForForm(owner.userId, provider);
      return Response.json({ config, gmailConnected: Boolean(provider) });
    });
  } catch {
    return sanitizedErrorResponse();
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    requireSameOrigin(request);
    return await withOwner(async (owner) => {
      const input = parseBody(await request.json());
      if (!input) return sanitizedErrorResponse();
      let provider;
      try {
        provider = await googleProviderForOwner(owner.userId);
      } catch {
        return Response.json({ error: "Connect Gmail before saving label names." }, { status: 400 });
      }
      try {
        const config = await new TriageConfigService().save(owner.userId, input, provider);
        return Response.json({ config });
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : "";
        if (
          message.includes("label")
          || message.includes("Label")
          || message.includes("distinct")
          || message.includes("term")
          || message.includes("whitelist")
          || message.includes("blocklist")
          || message.includes("bound")
          || message.includes("intent")
        ) {
          return Response.json({ error: message }, { status: 400 });
        }
        throw caught;
      }
    });
  } catch {
    return sanitizedErrorResponse();
  }
}
