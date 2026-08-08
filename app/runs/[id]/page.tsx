import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { BrandLogo } from "@/app/brand-logo";
import { DeleteRunButton } from "@/app/delete-run-button";
import { GmailLabelJumpLinks } from "@/app/gmail-label-jumps";
import { OwnerNav } from "@/app/owner-nav";
import { ownerUserFromSession } from "@/app/owner-user";
import { UserMenu } from "@/app/user-menu";
import { RunResultsList } from "@/app/run-results";
import { formatRunTime, runMessage, type RunStatus } from "@/app/run-status";
import { SignOutButton } from "@/app/auth/sign-out-button";
import { triageConfig } from "@/db/schema";
import { getServerConfig } from "@/src/config/server";
import { OwnerPreferencesService } from "@/src/server/config/owner-preferences";
import { getSession } from "@/src/server/auth/session";
import { database, withDemoOwnerScope } from "@/src/server/db";
import { googleProviderForOwner } from "@/src/server/gmail/factory";
import { buildGmailLabelJumps } from "@/src/server/gmail/gmail-url";
import { RunDetailService } from "@/src/server/gmail/run-detail";

export const dynamic = "force-dynamic";

const statusText: Record<RunStatus, string> = {
  running: "Syncing",
  bounded_incomplete: "Complete for this bounded run",
  completed: "Completed",
  partial_failure: "Completed with some failures",
  failed: "Failed",
};

export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const config = getServerConfig();
  const { data, error } = await getSession();
  const userId = data?.user?.id;
  if (error || !userId) redirect("/auth/sign-in");
  if (!config.demoProfile && userId !== config.ownerNeonAuthUserId) {
    return <main className="shell signed-out">
      <BrandLogo href={null} size="lg" />
      <p className="eyebrow">PRIVATE OWNER CONSOLE</p>
      <h1>Wrong account</h1>
      <p>Run details are only available to the configured owner.</p>
      <SignOutButton />
      <Link className="back-link" href="/">← Back to Email Triage</Link>
    </main>;
  }

  return withDemoOwnerScope(userId, async () => {
    let provider;
    try {
      provider = await googleProviderForOwner(userId);
    } catch {
      provider = undefined;
    }

    // Demo RLS uses one PoolClient — keep these sequential.
    const detail = await new RunDetailService().get(userId, id, provider);
    const gmailMessageLinkRoot = await new OwnerPreferencesService().getGmailMessageLinkRoot(userId);
    if (!detail) notFound();

    let gmailLabelJumps: ReturnType<typeof buildGmailLabelJumps> = [];
    if (provider) {
      try {
        const [labelConfig] = await database()
          .select({
            sourceLabelId: triageConfig.sourceLabelId,
            priorityLabelId: triageConfig.priorityLabelId,
            reviewLabelId: triageConfig.reviewLabelId,
            newLabelId: triageConfig.newLabelId,
            archiveLabelId: triageConfig.archiveLabelId,
          })
          .from(triageConfig)
          .where(and(
            eq(triageConfig.ownerAuthUserId, userId),
            eq(triageConfig.version, detail.configVersion),
          ))
          .limit(1);
        if (labelConfig) {
          const catalog = await provider.listLabels();
          gmailLabelJumps = buildGmailLabelJumps(labelConfig, gmailMessageLinkRoot, catalog);
        }
      } catch {
        gmailLabelJumps = [];
      }
    }

    const user = ownerUserFromSession(data.user);

    return <main className="shell">
      <header className="hero">
        <div className="brand-heading">
          <BrandLogo size="md" />
          <div className="brand-heading-copy">
            <p className="eyebrow">{config.demoProfile ? "PUBLIC DEMO" : "OWNER CONSOLE"}</p>
            <h1>{detail.trial ? "Trial run" : "Sync run"}</h1>
            <p className="lede">
              {detail.trial
                ? "Proposed label changes from this dry-run. Gmail was not mutated. Blocked and unmatched propose archive."
                : "Messages processed in this bounded sync. Classified destinations plus archive for blocked and unmatched were applied."}
            </p>
            <OwnerNav active="run" />
          </div>
        </div>
        <div className="hero-aside">
          <UserMenu user={user} demoProfile={config.demoProfile} />
          <Link className="back-link" href="/">← Back to Email Triage</Link>
        </div>
      </header>

      <section className={`history ${detail.trial ? "trial-results" : ""}`} aria-label="Run summary">
        <div className="section-heading">
          <div>
            <p className="step">RUN DETAIL</p>
            <h2>
              {statusText[detail.status]}
              {detail.trial ? <span className="trial-badge">Trial</span> : null}
            </h2>
          </div>
          <p>
            Started {formatRunTime(detail.startedAt)}
            {detail.finishedAt ? ` · Finished ${formatRunTime(detail.finishedAt)}` : ""}
            {` · Config v${detail.configVersion}`}
            {` · ${detail.results.length} message${detail.results.length === 1 ? "" : "s"}`}
          </p>
        </div>
        <p className="run-detail-summary">{detail.errorSummary ?? runMessage(detail.status, detail.trial)}</p>
        <p className="field-help">
          {detail.trial
            ? "Subjects and senders only — no message bodies. Labels shown are proposals."
            : "Subjects and senders only — no message bodies. Labels shown are destinations for classified messages."}
        </p>
        {gmailLabelJumps.length > 0 ? (
          <GmailLabelJumpLinks
            links={gmailLabelJumps}
            heading="Open triage labels in Gmail"
          />
        ) : null}
        <div className="run-detail-actions">
          <DeleteRunButton runId={detail.id} trial={detail.trial} />
        </div>
        <RunResultsList
          results={detail.results}
          emptyTitle="No messages in this run"
          emptyDescription="This run finished without recording any processed messages."
          gmailMessageLinkRoot={gmailMessageLinkRoot}
        />
      </section>
    </main>;
  });
}
