import { and, desc, eq, isNull } from "drizzle-orm";
import Link from "next/link";
import { BrandLogo } from "@/app/brand-logo";
import { contestSettings, gmailConnection, triageConfig } from "@/db/schema";
import { Dashboard, type DashboardState } from "@/app/dashboard";
import { ownerUserFromSession } from "@/app/owner-user";
import { SignOutButton } from "@/app/auth/sign-out-button";
import { getServerConfig } from "@/src/config/server";
import { OwnerPreferencesService } from "@/src/server/config/owner-preferences";
import { getSession } from "@/src/server/auth/session";
import { database, withDemoOwnerScope } from "@/src/server/db";
import { ContestRunDetailService } from "@/src/server/gmail/contest-run-detail";
import { inspectGmailConnection } from "@/src/server/gmail/connection-health";
import { googleProviderForOwner } from "@/src/server/gmail/factory";
import { buildContestGmailLabelJumps, buildGmailLabelJumps } from "@/src/server/gmail/gmail-url";
import type { ContestLabels } from "@/src/server/gmail/contest-contracts";

export const dynamic = "force-dynamic";

type HomeView =
  | { kind: "dashboard"; state: DashboardState; user: { name: string; email: string } }
  | { kind: "signed-out" }
  | { kind: "wrong-owner"; userId: string };

async function getDashboardState(ownerId: string): Promise<DashboardState> {
  const db = database();
  // Demo RLS uses one PoolClient per request — do not parallelize queries on it.
  const connection = await db
    .select({ ownerAuthUserId: gmailConnection.ownerAuthUserId, googleSubject: gmailConnection.googleSubject })
    .from(gmailConnection)
    .where(and(eq(gmailConnection.ownerAuthUserId, ownerId), isNull(gmailConnection.disconnectedAt)))
    .limit(1);
  const configuration = await db
    .select({
      version: triageConfig.version,
      sourceLabelId: triageConfig.sourceLabelId,
      priorityLabelId: triageConfig.priorityLabelId,
      reviewLabelId: triageConfig.reviewLabelId,
      newLabelId: triageConfig.newLabelId,
      archiveLabelId: triageConfig.archiveLabelId,
    })
    .from(triageConfig)
    .where(eq(triageConfig.ownerAuthUserId, ownerId))
    .orderBy(desc(triageConfig.version))
    .limit(1);
  const runs = getServerConfig().demoProfile ? [] : await new ContestRunDetailService(db).history(ownerId);
  const gmailMessageLinkRoot = await new OwnerPreferencesService(db).getGmailMessageLinkRoot(ownerId);

  const connectionHealth = await inspectGmailConnection(
    connection.length > 0,
    () => googleProviderForOwner(ownerId),
  );
  const configured = configuration.length > 0;
  let gmailLabelJumps: DashboardState["gmailLabelJumps"] = [];
  if (connectionHealth.provider && configuration[0]) {
    try {
      const catalog = await connectionHealth.provider.listLabels();
      if (getServerConfig().demoProfile) {
        gmailLabelJumps = buildGmailLabelJumps(configuration[0], gmailMessageLinkRoot, catalog);
      } else if (connection[0]) {
        const [settings] = await db.select({ labels: contestSettings.labels }).from(contestSettings)
          .where(and(eq(contestSettings.ownerAuthUserId, ownerId), eq(contestSettings.googleSubject, connection[0].googleSubject))).limit(1);
        gmailLabelJumps = buildContestGmailLabelJumps(configuration[0].sourceLabelId, settings ? settings.labels as ContestLabels : null, gmailMessageLinkRoot, catalog);
      }
    } catch {
      gmailLabelJumps = [];
    }
  }

  return {
    connected: connectionHealth.connected,
    reconnectRequired: connectionHealth.reconnectRequired,
    configured,
    gmailMessageLinkRoot,
    gmailLabelJumps,
    runs,
  };
}

async function loadHomeView(): Promise<HomeView> {
  const config = getServerConfig();
  const { data, error } = await getSession();
  const user = data?.user;
  const userId = user?.id;
  if (error || !userId) return { kind: "signed-out" };
  if (!config.demoProfile && userId !== config.ownerNeonAuthUserId) {
    return { kind: "wrong-owner", userId };
  }
  const state = await withDemoOwnerScope(userId, () => getDashboardState(userId));
  return {
    kind: "dashboard",
    state,
    user: ownerUserFromSession(user),
  };
}

export default async function Home() {
  const view = await loadHomeView();
  const demoProfile = getServerConfig().demoProfile;
  if (view.kind === "dashboard") {
    return <Dashboard initialState={view.state} user={view.user} demoProfile={demoProfile} />;
  }

  if (view.kind === "wrong-owner") {
    return <main className="shell signed-out">
      <BrandLogo href={null} size="lg" />
      <p className="eyebrow">PRIVATE OWNER CONSOLE</p>
      <h1>Wrong account</h1>
      <p>You are signed in, but this workspace only accepts the configured owner. Signed-in user id:</p>
      <code className="owner-id">{view.userId}</code>
      <p>Set <code>OWNER_NEON_AUTH_USER_ID</code> to that value in <code>.env.local</code>, or sign out and use the owner account.</p>
      <SignOutButton />
      <Link className="back-link" href="/auth/sign-in">Sign in as owner</Link>
      <small>No Gmail, configuration, or run information is visible for other accounts.</small>
    </main>;
  }

  return <main className="shell signed-out">
    <BrandLogo href={null} size="lg" />
    <p className="eyebrow">{demoProfile ? "PUBLIC DEMO" : "PRIVATE OWNER CONSOLE"}</p>
    <h1>Email Triage</h1>
    <p>
      {demoProfile
        ? "Explore a fixture mailbox and seeded review decisions. No Google account or model calls required."
        : "This workspace is available only to the configured owner. Sign in with the owner account to continue."}
    </p>
    <Link className="button" href="/auth/sign-in">{demoProfile ? "Start demo" : "Sign in"}</Link>
    <small>
      {demoProfile
        ? "Each visitor gets an isolated session. Clear demo data anytime from the account menu."
        : "No Gmail, configuration, or run information is visible while signed out."}
    </small>
  </main>;
}
