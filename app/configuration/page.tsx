import Link from "next/link";
import { redirect } from "next/navigation";
import { BrandLogo } from "@/app/brand-logo";
import { ConfigurationForm } from "@/app/configuration/configuration-form";
import { SignOutButton } from "@/app/auth/sign-out-button";
import { getServerConfig } from "@/src/config/server";
import { TriageConfigService } from "@/src/server/config/triage";
import { getSession } from "@/src/server/auth/session";
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
  const triageConfig = await new TriageConfigService().getLatestForForm(userId, provider);

  return <main className="shell">
    <header className="hero">
      <div className="brand-heading">
        <BrandLogo size="md" />
        <div className="brand-heading-copy">
          <p className="eyebrow">OWNER CONSOLE</p>
          <h1>Configuration</h1>
          <p className="lede">Set Gmail labels by name, classification terms, sender protection, and sync bounds.</p>
        </div>
      </div>
      <Link className="back-link" href="/">← Back to Email Triage</Link>
    </header>
    <ConfigurationForm initialConfig={triageConfig} gmailConnected={Boolean(provider)} />
  </main>;
}
