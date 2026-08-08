import Link from "next/link";
import { redirect } from "next/navigation";
import { BrandLogo } from "@/app/brand-logo";
import { ConfigurationForm } from "@/app/configuration/configuration-form";
import { GmailLinkRootForm } from "@/app/configuration/gmail-link-root";
import { OwnerNav } from "@/app/owner-nav";
import { ownerUserFromSession } from "@/app/owner-user";
import { UserMenu } from "@/app/user-menu";
import { SignOutButton } from "@/app/auth/sign-out-button";
import { getServerConfig } from "@/src/config/server";
import { OwnerPreferencesService } from "@/src/server/config/owner-preferences";
import { TriageConfigService } from "@/src/server/config/triage";
import { getSession } from "@/src/server/auth/session";
import { database, withDemoOwnerScope } from "@/src/server/db";
import { googleProviderForOwner } from "@/src/server/gmail/factory";

export const dynamic = "force-dynamic";

export default async function ConfigurationPage() {
  const config = getServerConfig();
  const { data, error } = await getSession();
  const userId = data?.user?.id;
  if (error || !userId) redirect("/auth/sign-in");
  if (!config.demoProfile && userId !== config.ownerNeonAuthUserId) {
    return <main className="shell signed-out">
      <BrandLogo href={null} size="lg" />
      <p className="eyebrow">PRIVATE OWNER CONSOLE</p>
      <h1>Wrong account</h1>
      <p>Configuration is only available to the configured owner.</p>
      <SignOutButton />
      <Link className="back-link" href="/">← Back to Email Triage</Link>
    </main>;
  }

  return withDemoOwnerScope(userId, async () => {
    let provider;
    try {
      provider = await googleProviderForOwner(userId);
    } catch {
      provider = undefined;
    }
    // Demo RLS uses one PoolClient — keep these sequential.
    const triageConfig = await new TriageConfigService().getLatestForForm(userId, provider);
    const gmailMessageLinkRoot = await new OwnerPreferencesService(database()).getGmailMessageLinkRoot(userId);
    const user = ownerUserFromSession(data.user);

    return <main className="shell">
      <header className="hero">
        <div className="brand-heading">
          <BrandLogo size="md" />
          <div className="brand-heading-copy">
            <p className="eyebrow">{config.demoProfile ? "PUBLIC DEMO" : "OWNER CONSOLE"}</p>
            <h1>Configuration</h1>
            <p className="lede">Set Gmail labels by name, classification terms, category intent, sender protection, sync bounds, and message link root.</p>
            <OwnerNav active="configuration" />
          </div>
        </div>
        <div className="hero-aside">
          <UserMenu user={user} />
        </div>
      </header>
      <ConfigurationForm
        initialConfig={triageConfig}
        gmailConnected={Boolean(provider)}
        demoProfile={config.demoProfile}
      />
      <GmailLinkRootForm initialValue={gmailMessageLinkRoot} />
    </main>;
  });
}
