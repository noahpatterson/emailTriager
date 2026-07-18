export type RunResultRow = Readonly<{
  gmailMessageId: string;
  gmailThreadId: string | null;
  subject: string | null;
  senderAddress: string | null;
  outcome: string;
  reason: string | null;
  proposedLabelId: string | null;
}>;

const outcomeLabel: Record<string, string> = {
  priority: "Priority",
  review: "Review",
  new_contest: "New contest",
  unmatched: "Unmatched",
  protected: "Protected",
  failed: "Failed",
  blocked: "Blocked",
};

/** Open the thread in Gmail web (All Mail). Uses thread id when available. */
export function gmailMessageUrl(
  row: Pick<RunResultRow, "gmailMessageId" | "gmailThreadId">,
): string {
  const id = (row.gmailThreadId || row.gmailMessageId).trim();
  return `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(id)}`;
}

export function RunResultsList({
  results,
  emptyTitle,
  emptyDescription,
}: {
  results: readonly RunResultRow[];
  emptyTitle: string;
  emptyDescription: string;
}) {
  if (results.length === 0) {
    return (
      <div className="empty">
        <span aria-hidden="true">◎</span>
        <h3>{emptyTitle}</h3>
        <p>{emptyDescription}</p>
      </div>
    );
  }

  return (
    <div className="trial-list">
      {results.map((row) => {
        const title = row.subject?.trim() || "(No subject)";
        const href = gmailMessageUrl(row);
        const reason = row.reason?.trim();
        return (
          <article className="trial-row" key={row.gmailMessageId}>
            <div className="trial-row-copy">
              <strong>
                <a
                  className="gmail-link"
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Open in Gmail"
                >
                  {title}
                </a>
              </strong>
              <span>{row.senderAddress ?? "Sender unavailable"}</span>
              {reason ? <p className="trial-reason">{reason}</p> : null}
            </div>
            <div className="trial-row-meta">
              <span className={`trial-outcome ${row.outcome}`}>
                {outcomeLabel[row.outcome] ?? row.outcome}
              </span>
              <code>{row.proposedLabelId ?? "—"}</code>
            </div>
          </article>
        );
      })}
    </div>
  );
}
