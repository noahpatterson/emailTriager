import Link from "next/link";
import { redirect } from "next/navigation";
import { BrandLogo } from "@/app/brand-logo";
import { DemotionQueueClient } from "@/app/demotion/demotion-queue-client";
import { OwnerNav } from "@/app/owner-nav";
import { ownerUserFromSession } from "@/app/owner-user";
import { UserMenu } from "@/app/user-menu";
import { SignOutButton } from "@/app/auth/sign-out-button";
import { getServerConfig } from "@/src/config/server";
import { getSession } from "@/src/server/auth/session";
import { DemotionService } from "@/src/server/gmail/demotion-service";

export const dynamic = "force-dynamic";

export default async function DemotionPage() {
  const config = getServerConfig();
  const { data, error } = await getSession();
  const userId = data?.user?.id;
  if (error || !userId) redirect("/auth/sign-in");
  if (userId !== config.ownerNeonAuthUserId) {
    return (
      <main className="shell signed-out">
        <BrandLogo href={null} size="lg" />
        <p className="eyebrow">PRIVATE OWNER CONSOLE</p>
        <h1>Wrong account</h1>
        <p>Demotion confirmation is only available to the configured owner.</p>
        <SignOutButton />
        <Link className="back-link" href="/">← Back to Email Triage</Link>
      </main>
    );
  }

  const initialQueue = await new DemotionService().getQueue(userId);
  const user = ownerUserFromSession(data.user);

  return (
    <main className="shell">
      <header className="hero">
        <div className="brand-heading">
          <BrandLogo size="md" />
          <div className="brand-heading-copy">
            <p className="eyebrow">OWNER CONSOLE</p>
            <h1>Pending Demotions</h1>
            <p className="lede">
              Confirm archive filings recommended by the judge. Nothing moves to archive until you confirm.
            </p>
            <OwnerNav active="demotion" />
          </div>
        </div>
        <div className="hero-aside">
          <UserMenu user={user} />
        </div>
      </header>
      <DemotionQueueClient initialQueue={initialQueue} />
    </main>
  );
}
