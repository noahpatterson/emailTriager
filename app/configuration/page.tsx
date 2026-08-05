import Link from "next/link";
import { redirect } from "next/navigation";
import { BrandLogo } from "@/app/brand-logo";
import { ConfigurationForm } from "@/app/configuration/configuration-form";
import { GmailLinkRootForm } from "@/app/configuration/gmail-link-root";
import { SignOutButton } from "@/app/auth/sign-out-button";
import { getServerConfig } from "@/src/config/server";
import { OwnerPreferencesService } from "@/src/server/config/owner-preferences";
import { TriageConfigService } from "@/src/server/config/triage";
import { getSession } from "@/src/server/auth/session";
import { database } from "@/src/server/db";
import { googleProviderForOwner } from "@/src/server/gmail/factory";

export const dynamic = "force-dynamic";

export default async function ConfigurationPage() {
  const config = getServerConfig();
  const { data, error } = await getSession();
  const userId = data?.user?.id;
  if (error || !userId) redirect("/auth/sign-in");
  if (userId !== config.ownerNeonAuthUserId) {
    return <main className="shell signed-out">
      <BrandLogo href={null} size="lg" />
      <p className="eyebrow">PRIVATE OWNER CONSOLE</p>
      <h1>Wrong account</h1>
      <p>Configuration is only available to the configured owner.</p>
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
  const [triageConfig, gmailMessageLinkRoot] = await Promise.all([
    new TriageConfigService().getLatestForForm(userId, provider),
    new OwnerPreferencesService(database()).getGmailMessageLinkRoot(userId),
  ]);

  return <main className="shell">
    <header className="hero">
      <div className="brand-heading">
        <BrandLogo size="md" />
        <div className="brand-heading-copy">
          <p className="eyebrow">OWNER CONSOLE</p>
          <h1>Configuration</h1>
          <p className="lede">Set Gmail labels by name, classification terms, category intent, sender protection, sync bounds, and message link root.</p>
        </div>
      </div>
      <Link className="back-link" href="/">← Back to Email Triage</Link>
    </header>
    <ConfigurationForm initialConfig={triageConfig} gmailConnected={Boolean(provider)} />
    <GmailLinkRootForm initialValue={gmailMessageLinkRoot} />
  </main>;
}
