import Link from "next/link";
import { redirect } from "next/navigation";
import { BrandLogo } from "@/app/brand-logo";
import { ReviewQueueClient } from "@/app/review/review-queue-client";
import { OwnerNav } from "@/app/owner-nav";
import { ownerUserFromSession } from "@/app/owner-user";
import { UserMenu } from "@/app/user-menu";
import { SignOutButton } from "@/app/auth/sign-out-button";
import { getServerConfig } from "@/src/config/server";
import { getSession } from "@/src/server/auth/session";
import { ReviewService } from "@/src/server/gmail/review-service";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
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
        <p>Review is only available to the configured owner.</p>
        <SignOutButton />
        <Link className="back-link" href="/">← Back to Email Triage</Link>
      </main>
    );
  }

  const initialQueue = await new ReviewService().getQueue(userId);
  const user = ownerUserFromSession(data.user);

  return (
    <main className="shell">
      <header className="hero">
        <div className="brand-heading">
          <BrandLogo size="md" />
          <div className="brand-heading-copy">
            <p className="eyebrow">OWNER CONSOLE</p>
            <h1>Review Queue</h1>
            <p className="lede">
              Run a bounded audit, then label the queue. j/k move; 1–4 set the Owner Label
              and re-file that category in Gmail.
            </p>
            <OwnerNav active="review" />
          </div>
        </div>
        <div className="hero-aside">
          <UserMenu user={user} />
        </div>
      </header>
      <ReviewQueueClient initialQueue={initialQueue} />
    </main>
  );
}
