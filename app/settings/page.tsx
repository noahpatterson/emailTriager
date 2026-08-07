import Link from "next/link";
import { and, desc, eq, isNull } from "drizzle-orm";
import { redirect } from "next/navigation";
import { BrandLogo } from "@/app/brand-logo";
import { SignOutButton } from "@/app/auth/sign-out-button";
import { ArchiveTrashPanel } from "@/app/settings/archive-trash";
import { gmailConnection, triageConfig } from "@/db/schema";
import { getServerConfig } from "@/src/config/server";
import { getSession } from "@/src/server/auth/session";
import { database, withDemoOwnerScope } from "@/src/server/db";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const config = getServerConfig();
  const { data, error } = await getSession();
  const userId = data?.user?.id;
  if (error || !userId) redirect("/auth/sign-in");
  if (!config.demoProfile && userId !== config.ownerNeonAuthUserId) {
    return <main className="shell signed-out">
      <BrandLogo href={null} size="lg" />
      <p className="eyebrow">PRIVATE OWNER CONSOLE</p>
      <h1>Wrong account</h1>
      <p>Settings are only available to the configured owner.</p>
      <SignOutButton />
      <Link className="back-link" href="/">← Back to Email Triage</Link>
    </main>;
  }

  return withDemoOwnerScope(userId, async () => {
    const db = database();
    const [connection, configuration] = await Promise.all([
      db.select({ ownerAuthUserId: gmailConnection.ownerAuthUserId })
        .from(gmailConnection)
        .where(and(eq(gmailConnection.ownerAuthUserId, userId), isNull(gmailConnection.disconnectedAt)))
        .limit(1),
      db.select({ version: triageConfig.version })
        .from(triageConfig)
        .where(eq(triageConfig.ownerAuthUserId, userId))
        .orderBy(desc(triageConfig.version))
        .limit(1),
    ]);

  return <main className="shell">
    <header className="hero">
      <div className="brand-heading">
        <BrandLogo size="md" />
        <div className="brand-heading-copy">
          <p className="eyebrow">OWNER CONSOLE</p>
          <h1>Settings</h1>
          <p className="lede">How triage uses Gmail, where to edit configuration, and owner tools that can change mailbox state.</p>
        </div>
      </div>
      <Link className="back-link" href="/">← Back to Email Triage</Link>
    </header>

    <section className="history" aria-label="How triage works in Gmail">
      <div className="section-heading">
        <div>
          <p className="step">GMAIL</p>
          <h2>How it works</h2>
        </div>
        <p>What sync and owner tools do to your mailbox — not a setup guide.</p>
      </div>
      <ul className="settings-guide">
        <li>
          <strong>Source label.</strong> Sync lists only messages that currently carry your configured source label. It never runs a Gmail search.
        </li>
        <li>
          <strong>Destination labels.</strong> After local classification, sync adds one destination label and removes the source label in a single modify. Priority, review, and new each have their own destination.
        </li>
        <li>
          <strong>Archive.</strong> Blocked senders and unmatched messages move to the archive destination instead of a triage bucket.
        </li>
        <li>
          <strong>Whitelist and blocklist.</strong> Whitelisted senders are never moved. Blocklisted senders skip term matching and go to archive. Whitelist wins if an address is on both lists.
        </li>
        <li>
          <strong>Starred protection.</strong> Messages with Gmail’s star (<code>STARRED</code>) are treated as protected: sync does not change their labels, and archive trash skips them.
        </li>
        <li>
          <strong>What sync never does.</strong> Sync does not trash, permanently delete, mark read/unread, spam, or archive outside the label move above.
        </li>
        <li>
          <strong>Archive trash.</strong> The danger-zone control below can move archive messages into Gmail Trash (recoverable). That path is owner-confirmed and separate from sync.
        </li>
      </ul>
    </section>

    <section className="history config-panel" aria-label="Configuration">
      <div className="section-heading">
        <div>
          <p className="step">CONFIGURATION</p>
          <h2>Labels, terms, and bounds</h2>
        </div>
        <p>Edit source and destination labels, classification terms, category intent, sender lists, sync bounds, and the Gmail message link root.</p>
      </div>
      <p className="field-help">Create the labels in Gmail first, then enter their exact names on the configuration page.</p>
      <Link className="button secondary-ink" href="/configuration">Open configuration</Link>
    </section>

    <ArchiveTrashPanel
      gmailConnected={connection.length > 0}
      configured={configuration.length > 0}
    />
  </main>;
  });
}
