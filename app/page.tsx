import { and, desc, eq, isNull } from "drizzle-orm";
import Link from "next/link";
import { BrandLogo } from "@/app/brand-logo";
import { gmailConnection, syncRun, triageConfig } from "@/db/schema";
import { Dashboard, type DashboardState } from "@/app/dashboard";
import { ownerUserFromSession } from "@/app/owner-user";
import { SignOutButton } from "@/app/auth/sign-out-button";
import { getServerConfig } from "@/src/config/server";
import { OwnerPreferencesService } from "@/src/server/config/owner-preferences";
import { getSession } from "@/src/server/auth/session";
import { database, withDemoOwnerScope } from "@/src/server/db";
import { googleProviderForOwner } from "@/src/server/gmail/factory";
import { buildGmailLabelJumps } from "@/src/server/gmail/gmail-url";

export const dynamic = "force-dynamic";

type HomeView =
  | { kind: "dashboard"; state: DashboardState; user: { name: string; email: string } }
  | { kind: "signed-out" }
  | { kind: "wrong-owner"; userId: string };

async function getDashboardState(ownerId: string): Promise<DashboardState> {
  const db = database();
  // Demo RLS uses one PoolClient per request — do not parallelize queries on it.
  const connection = await db
    .select({ ownerAuthUserId: gmailConnection.ownerAuthUserId })
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
  const runs = await db
    .select({
      id: syncRun.id,
      status: syncRun.status,
      trial: syncRun.trial,
      startedAt: syncRun.startedAt,
      finishedAt: syncRun.finishedAt,
      errorSummary: syncRun.errorSummary,
      nextPageToken: syncRun.nextPageToken,
    })
    .from(syncRun)
    .where(eq(syncRun.ownerAuthUserId, ownerId))
    .orderBy(desc(syncRun.startedAt))
    .limit(30);
  const gmailMessageLinkRoot = await new OwnerPreferencesService(db).getGmailMessageLinkRoot(ownerId);

  const connected = connection.length > 0;
  const configured = configuration.length > 0;
  let gmailLabelJumps: DashboardState["gmailLabelJumps"] = [];
  if (connected && configuration[0]) {
    try {
      const provider = await googleProviderForOwner(ownerId);
      const catalog = await provider.listLabels();
      gmailLabelJumps = [...buildGmailLabelJumps(configuration[0], gmailMessageLinkRoot, catalog)];
    } catch {
      gmailLabelJumps = [];
    }
  }

  return {
    connected,
    configured,
    gmailMessageLinkRoot,
    gmailLabelJumps,
    runs: runs.map((run) => ({
      ...run,
      trial: run.trial,
      startedAt: run.startedAt.toISOString(),
      finishedAt: run.finishedAt?.toISOString() ?? null,
    })),
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
        ? "Try the deterministic triage path against a fixture mailbox. No Google account or model calls required."
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
