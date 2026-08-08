import type { GmailLabelJump } from "@/src/server/gmail/gmail-url";

export function GmailLabelJumpLinks({
  links,
  heading = "Open in Gmail",
  showHeading = true,
}: {
  links: readonly GmailLabelJump[];
  heading?: string;
  showHeading?: boolean;
}) {
  if (links.length === 0) return null;
  return (
    <nav className="gmail-label-jumps" aria-label={heading}>
      {showHeading ? <p className="gmail-label-jumps-heading">{heading}</p> : null}
      <div className="gmail-label-jumps-list">
        {links.map((link) => (
          <a
            key={link.key}
            className="button secondary-ink gmail-label-jump"
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            title={`Open ${link.name} in Gmail`}
          >
            {link.title}
          </a>
        ))}
      </div>
    </nav>
  );
}
