import { DEFAULT_GMAIL_MESSAGE_LINK_ROOT } from "@/src/server/config/owner-preferences-validate";
import { gmailMessageUrl } from "@/src/server/gmail/gmail-url";

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
  new: "New",
  unmatched: "Unmatched",
  protected: "Protected",
  failed: "Failed",
  blocked: "Blocked",
};

export { DEFAULT_GMAIL_MESSAGE_LINK_ROOT, gmailMessageUrl };

export function RunResultsList({
  results,
  emptyTitle,
  emptyDescription,
  gmailMessageLinkRoot = DEFAULT_GMAIL_MESSAGE_LINK_ROOT,
}: {
  results: readonly RunResultRow[];
  emptyTitle: string;
  emptyDescription: string;
  gmailMessageLinkRoot?: string;
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
        const href = gmailMessageUrl(row, gmailMessageLinkRoot);
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
