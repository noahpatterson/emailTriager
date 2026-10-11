import Link from "next/link";
import { redirect } from "next/navigation";
import { BrandLogo } from "@/app/brand-logo";
import { ownerUserFromSession } from "@/app/owner-user";
import { UserMenu } from "@/app/user-menu";
import { SignOutButton } from "@/app/auth/sign-out-button";
import { getServerConfig } from "@/src/config/server";
import { getSession } from "@/src/server/auth/session";
import { requireOwner } from "@/src/server/auth/owner";
import { ContestClient } from "./contest-client";
import "./contest.css";

export const dynamic = "force-dynamic";

export default async function ContestPage() {
  const config = getServerConfig();
  const { data, error } = await getSession();
  const userId = data?.user?.id;
  if (error || !userId) redirect("/auth/sign-in");
  if (!config.demoProfile && userId !== config.ownerNeonAuthUserId) {
    return <main className="shell signed-out">
      <BrandLogo href={null} size="lg" />
      <h1>Wrong account</h1>
      <p>Contest scans are only available to the configured owner.</p>
      <SignOutButton />
      <Link className="back-link" href="/">Back to Email Triage</Link>
    </main>;
  }
  if (!config.demoProfile) await requireOwner();
  return <main className="shell contest-page">
    <header className="hero">
      <div className="brand-heading">
        <BrandLogo size="md" />
        <div className="brand-heading-copy">
          <p className="eyebrow">{config.demoProfile ? "PUBLIC DEMO" : "OWNER CONSOLE"}</p>
          <h1>Contest mail</h1>
          <p className="lede">Find wins, entry confirmations, and new contests in your configured source label.</p>
          <nav className="owner-nav" aria-label="Owner console">
            <Link className="owner-nav-link" href="/">Sync</Link>
            <Link className="owner-nav-link is-active" href="/contests" aria-current="page">Contests</Link>
            <Link className="owner-nav-link" href="/configuration">Configuration</Link>
          </nav>
        </div>
      </div>
      <div className="hero-aside"><UserMenu user={ownerUserFromSession(data.user)} demoProfile={config.demoProfile} /></div>
    </header>
    {config.demoProfile
      ? <section className="card"><h2>Live contest scans are owner-only</h2><p>This demo uses fixture mail. Contest scanning and notifications are disabled here.</p><Link className="button secondary-ink" href="/">Return to the fixture dashboard</Link></section>
      : <ContestClient />}
  </main>;
}
