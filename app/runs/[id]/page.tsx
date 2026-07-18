import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { BrandLogo } from "@/app/brand-logo";
import { DeleteRunButton } from "@/app/delete-run-button";
import { RunResultsList } from "@/app/run-results";
import { formatRunTime, runMessage, type RunStatus } from "@/app/run-status";
import { SignOutButton } from "@/app/auth/sign-out-button";
import { getServerConfig } from "@/src/config/server";
import { getSession } from "@/src/server/auth/session";
import { googleProviderForOwner } from "@/src/server/gmail/factory";
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
  if (userId !== config.ownerNeonAuthUserId) {
    return <main className="shell signed-out">
      <BrandLogo href={null} size="lg" />
      <p className="eyebrow">PRIVATE OWNER CONSOLE</p>
      <h1>Wrong account</h1>
      <p>Run details are only available to the configured owner.</p>
      <SignOutButton />
      <Link className="back-link" href="/">← Back to Email Triage</Link>
    </main>;
  }

  let provider;
  try {
    provider = await googleProviderForOwner(userId);
  } catch {
    provider = undefined;
  }

  const detail = await new RunDetailService().get(userId, id, provider);
  if (!detail) notFound();

  return <main className="shell">
    <header className="hero">
      <div className="brand-heading">
        <BrandLogo size="md" />
        <div className="brand-heading-copy">
          <p className="eyebrow">OWNER CONSOLE</p>
          <h1>{detail.trial ? "Trial run" : "Sync run"}</h1>
          <p className="lede">
            {detail.trial
              ? "Proposed label changes from this dry-run. Gmail was not mutated. Blocked and unmatched propose contest-archive."
              : "Messages processed in this bounded sync. Classified destinations plus contest-archive for blocked and unmatched were applied."}
          </p>
        </div>
      </div>
      <Link className="back-link" href="/">← Back to Email Triage</Link>
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
          ? "Message links and normalized senders only — subjects and bodies are not retained. Labels shown are proposals."
          : "Message links and normalized senders only — subjects and bodies are not retained. Labels shown are destinations for classified messages."}
      </p>
      <div className="run-detail-actions">
        <DeleteRunButton runId={detail.id} trial={detail.trial} />
      </div>
      <RunResultsList
        results={detail.results}
        emptyTitle="No messages in this run"
        emptyDescription="This run finished without recording any processed messages."
      />
    </section>
  </main>;
}
