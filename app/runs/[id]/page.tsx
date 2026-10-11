import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { BrandLogo } from "@/app/brand-logo";
import { ContestResults, ContestRunActivity } from "@/app/contests/contest-client";
import { OwnerNav } from "@/app/owner-nav";
import { ownerUserFromSession } from "@/app/owner-user";
import { UserMenu } from "@/app/user-menu";
import { formatRunTime } from "@/app/run-status";
import { SignOutButton } from "@/app/auth/sign-out-button";
import { getServerConfig } from "@/src/config/server";
import { OwnerPreferencesService } from "@/src/server/config/owner-preferences";
import { getSession } from "@/src/server/auth/session";
import { database, withDemoOwnerScope } from "@/src/server/db";
import { ContestRunDetailService } from "@/src/server/gmail/contest-run-detail";

export const dynamic = "force-dynamic";

export default async function RunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const config = getServerConfig();
  const { data, error } = await getSession();
  const userId = data?.user?.id;
  if (error || !userId) redirect("/auth/sign-in");
  if (!config.demoProfile && userId !== config.ownerNeonAuthUserId) {
    return <main className="shell signed-out">
      <BrandLogo href={null} size="lg" />
      <h1>Wrong account</h1>
      <p>Run details are only available to the configured owner.</p>
      <SignOutButton />
      <Link className="back-link" href="/">Back to Email Triage</Link>
    </main>;
  }
  if (config.demoProfile) notFound();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) notFound();

  return withDemoOwnerScope(userId, async () => {
    const db = database();
    const linkRoot = await new OwnerPreferencesService(db).getGmailMessageLinkRoot(userId);
    const detail = await new ContestRunDetailService(db).get(userId, id, linkRoot);
    if (!detail) notFound();
    const { run, results } = detail;

    return <main className="shell">
      <header className="hero">
        <div className="brand-heading">
          <BrandLogo size="md" />
          <div className="brand-heading-copy">
            <p className="eyebrow">OWNER CONSOLE</p>
            <h1>Jev {run.trial ? "trial" : "scan"}</h1>
            <p className="lede">{run.trial
              ? "Classification preview for this bounded batch. Gmail labels and notifications were not changed."
              : "Jev classifications and filing outcomes for this bounded batch."}</p>
            <OwnerNav active="run" />
          </div>
        </div>
        <div className="hero-aside">
          <UserMenu user={ownerUserFromSession(data.user)} />
          <Link className="back-link" href="/">Back to Email Triage</Link>
        </div>
      </header>

      <div className="contest-content">
        <section className="history" aria-label="Jev run summary">
          <div className="section-heading">
            <div><p className="step">RUN DETAIL</p><h2>Batch summary</h2></div>
            <p>Started {formatRunTime(run.startedAt)}{run.finishedAt ? ` · Finished ${formatRunTime(run.finishedAt)}` : ""}</p>
          </div>
          <ContestRunActivity run={run} showDetails />
          <p className="contest-muted">Run ID: {run.id}</p>
          {run.status !== "completed" && run.nextPageToken && <Link className="button secondary-ink" href="/#contest-scan-heading">Open scan controls</Link>}
          {run.status === "running" && <p className="contest-muted">This page shows saved progress at the time it was opened. The dashboard updates progress while a scan runs.</p>}
        </section>
        <section className="history" aria-label="Jev classifications">
          <div className="section-heading"><h2>{run.trial ? "Trial classifications" : "Jev classifications"}</h2><p>{results.length} saved results · highest win probability first</p></div>
          {run.trial ? <p>Trial previews are not saved. This run retains batch counts and usage; message previews were available only during the trial.</p>
            : <>
              <p className="contest-muted">These messages belong to this batch. Corrections, Gmail filing status, and notification status show their current saved values. Apply category corrections from the latest results on the dashboard.</p>
              {!run.progress?.resultMessageIds && <p>Message membership was not recorded for this older batch. Its counts and usage remain available.</p>}
              <ContestResults results={results} trial={false} busy={false} />
            </>}
        </section>
      </div>
    </main>;
  });
}
