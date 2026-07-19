import "server-only";
import { desc, eq, sql } from "drizzle-orm";
import { ownerBinding, triageConfig } from "@/db/schema";
import { database, type Database } from "@/src/server/db";
import {
  asBounds,
  asStringArray,
  asTerms,
  normalizeTriageConfig,
  type TriageConfigInput,
  type TriageConfigView,
} from "@/src/server/config/triage-validate";
import type { GmailProvider } from "@/src/server/gmail/contracts";
import { displayLabelRefs, resolveLabelRefs } from "@/src/server/gmail/labels";

export type { TriageConfigInput, TriageConfigView } from "@/src/server/config/triage-validate";
export {
  DEFAULT_TRIAGE_CONFIG,
  normalizeTriageConfig,
  parseTermList,
} from "@/src/server/config/triage-validate";

export class TriageConfigService {
  constructor(private readonly db: Database = database()) {}

  async ensureOwnerBinding(ownerId: string): Promise<void> {
    const [existing] = await this.db
      .select({ authUserId: ownerBinding.authUserId })
      .from(ownerBinding)
      .limit(1);
    if (!existing) {
      await this.db.insert(ownerBinding).values({ authUserId: ownerId });
      return;
    }
    if (existing.authUserId !== ownerId) throw new Error("Owner binding mismatch");
  }

  async getLatest(ownerId: string): Promise<TriageConfigView | null> {
    const [row] = await this.db
      .select({
        version: triageConfig.version,
        sourceLabelId: triageConfig.sourceLabelId,
        priorityLabelId: triageConfig.priorityLabelId,
        reviewLabelId: triageConfig.reviewLabelId,
        newLabelId: triageConfig.newLabelId,
        archiveLabelId: triageConfig.archiveLabelId,
        terms: triageConfig.terms,
        senderWhitelist: triageConfig.senderWhitelist,
        senderBlocklist: triageConfig.senderBlocklist,
        bounds: triageConfig.bounds,
      })
      .from(triageConfig)
      .where(eq(triageConfig.ownerAuthUserId, ownerId))
      .orderBy(desc(triageConfig.version))
      .limit(1);
    if (!row) return null;
    return {
      version: row.version,
      sourceLabelId: row.sourceLabelId,
      priorityLabelId: row.priorityLabelId,
      reviewLabelId: row.reviewLabelId,
      newLabelId: row.newLabelId,
      archiveLabelId: row.archiveLabelId,
      terms: asTerms(row.terms),
      senderWhitelist: asStringArray(row.senderWhitelist),
      senderBlocklist: asStringArray(row.senderBlocklist),
      bounds: asBounds(row.bounds),
    };
  }

  /** Load config with label IDs mapped to Gmail display names when a catalog is available. */
  async getLatestForForm(ownerId: string, provider?: GmailProvider): Promise<TriageConfigView | null> {
    const latest = await this.getLatest(ownerId);
    if (!latest || !provider) return latest;
    const catalog = await provider.listLabels();
    return { ...latest, ...displayLabelRefs(latest, catalog) };
  }

  async save(ownerId: string, input: TriageConfigInput, provider: GmailProvider): Promise<TriageConfigView> {
    const catalog = await provider.listLabels();
    const resolvedLabels = resolveLabelRefs(input, catalog);
    const normalized = normalizeTriageConfig({ ...input, ...resolvedLabels });
    await this.ensureOwnerBinding(ownerId);
    const [latest] = await this.db
      .select({ version: triageConfig.version })
      .from(triageConfig)
      .where(eq(triageConfig.ownerAuthUserId, ownerId))
      .orderBy(desc(triageConfig.version))
      .limit(1);
    const version = (latest?.version ?? 0) + 1;
    await this.db.insert(triageConfig).values({
      ownerAuthUserId: ownerId,
      version,
      sourceLabelId: normalized.sourceLabelId,
      priorityLabelId: normalized.priorityLabelId,
      reviewLabelId: normalized.reviewLabelId,
      newLabelId: normalized.newLabelId,
      archiveLabelId: normalized.archiveLabelId,
      terms: normalized.terms,
      senderWhitelist: normalized.senderWhitelist,
      senderBlocklist: normalized.senderBlocklist,
      bounds: normalized.bounds,
      createdAt: sql`now()`,
    });
    return {
      ...normalized,
      ...displayLabelRefs(normalized, catalog),
      version,
    };
  }
}
