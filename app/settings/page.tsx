import Link from "next/link";
import { and, desc, eq, isNull } from "drizzle-orm";
import { redirect } from "next/navigation";
import { SignOutButton } from "@/app/auth/sign-out-button";
import { ContestArchiveTrashPanel } from "@/app/settings/contest-archive-trash";
import { gmailConnection, triageConfig } from "@/db/schema";
import { getServerConfig } from "@/src/config/server";
import { getNeonAuth } from "@/src/server/auth/neon";
import { database } from "@/src/server/db";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const config = getServerConfig();
  const { data, error } = await getNeonAuth().getSession();
  const userId = data?.user?.id;
  if (error || !userId) redirect("/auth/sign-in");
  if (userId !== config.ownerNeonAuthUserId) {
    return <main className="shell signed-out">
      <div className="lock">✦</div>
      <p className="eyebrow">PRIVATE OWNER CONSOLE</p>
      <h1>Wrong account</h1>
      <p>Settings are only available to the configured owner.</p>
      <SignOutButton />
      <Link className="back-link" href="/">← Back to Email Triage</Link>
    </main>;
  }

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
      <div>
        <p className="eyebrow">OWNER CONSOLE</p>
        <h1>Settings</h1>
        <p className="lede">Owner tools that can change mailbox state. Classification labels and terms live under Configuration.</p>
      </div>
      <Link className="back-link" href="/">← Back to Email Triage</Link>
    </header>
    <ContestArchiveTrashPanel
      gmailConnected={connection.length > 0}
      configured={configuration.length > 0}
    />
  </main>;
}
