import { and, desc, eq, isNull } from "drizzle-orm";
import Link from "next/link";
import { BrandLogo } from "@/app/brand-logo";
import { gmailConnection, syncRun, triageConfig } from "@/db/schema";
import { Dashboard, type DashboardState } from "@/app/dashboard";
import { SignOutButton } from "@/app/auth/sign-out-button";
import { getServerConfig } from "@/src/config/server";
import { OwnerPreferencesService } from "@/src/server/config/owner-preferences";
import { getSession } from "@/src/server/auth/session";
import { database } from "@/src/server/db";

export const dynamic = "force-dynamic";

type HomeView =
  | { kind: "dashboard"; state: DashboardState; user: { name: string; email: string } }
  | { kind: "signed-out" }
  | { kind: "wrong-owner"; userId: string };

async function getDashboardState(ownerId: string): Promise<DashboardState> {
  const db = database();
  const [connection, configuration, runs, gmailMessageLinkRoot] = await Promise.all([
    db.select({ ownerAuthUserId: gmailConnection.ownerAuthUserId }).from(gmailConnection).where(and(eq(gmailConnection.ownerAuthUserId, ownerId), isNull(gmailConnection.disconnectedAt))).limit(1),
    db.select({ version: triageConfig.version }).from(triageConfig).where(eq(triageConfig.ownerAuthUserId, ownerId)).orderBy(desc(triageConfig.version)).limit(1),
    db.select({
      id: syncRun.id,
      status: syncRun.status,
      trial: syncRun.trial,
      startedAt: syncRun.startedAt,
      finishedAt: syncRun.finishedAt,
      errorSummary: syncRun.errorSummary,
      nextPageToken: syncRun.nextPageToken,
    }).from(syncRun).where(eq(syncRun.ownerAuthUserId, ownerId)).orderBy(desc(syncRun.startedAt)).limit(8),
    new OwnerPreferencesService(db).getGmailMessageLinkRoot(ownerId),
  ]);
  return {
    connected: connection.length > 0,
    configured: configuration.length > 0,
    gmailMessageLinkRoot,
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
  if (userId !== config.ownerNeonAuthUserId) return { kind: "wrong-owner", userId };
  return {
    kind: "dashboard",
    state: await getDashboardState(userId),
    user: {
      name: typeof user.name === "string" ? user.name : "",
      email: typeof user.email === "string" ? user.email : "",
    },
  };
}

export default async function Home() {
  const view = await loadHomeView();
  if (view.kind === "dashboard") return <Dashboard initialState={view.state} user={view.user} />;

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
    <p className="eyebrow">PRIVATE OWNER CONSOLE</p>
    <h1>Email Triage</h1>
    <p>This workspace is available only to the configured owner. Sign in with the owner account to continue.</p>
    <Link className="button" href="/auth/sign-in">Sign in</Link>
    <small>No Gmail, configuration, or run information is visible while signed out.</small>
  </main>;
}
