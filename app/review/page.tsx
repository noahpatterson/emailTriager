import Link from "next/link";
import { redirect } from "next/navigation";
import { BrandLogo } from "@/app/brand-logo";
import { DemoAiExplainer } from "@/app/demo-ai-explainer";
import { OwnerNav } from "@/app/owner-nav";
import { ownerUserFromSession } from "@/app/owner-user";
import { UserMenu } from "@/app/user-menu";
import { SignOutButton } from "@/app/auth/sign-out-button";
import { getServerConfig } from "@/src/config/server";
import { getSession } from "@/src/server/auth/session";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  const config = getServerConfig();
  const { data, error } = await getSession();
  const userId = data?.user?.id;
  if (error || !userId) redirect("/auth/sign-in");

  if (config.demoProfile) {
    return (
      <main className="shell">
        <header className="hero">
          <div className="brand-heading">
            <BrandLogo size="md" />
            <div className="brand-heading-copy">
              <p className="eyebrow">PUBLIC DEMO</p>
              <h1>Review Queue</h1>
              <p className="lede">
                In the single-owner app, this page records Owner Labels against judge verdicts
                without changing Gmail.
              </p>
              <OwnerNav active="review" />
            </div>
          </div>
          <div className="hero-aside">
            <Link className="back-link" href="/">← Back to Email Triage</Link>
          </div>
        </header>
        <DemoAiExplainer title="Human review is disabled in the demo">
          <p>
            Review is measurement-only: every disagreement and a sample of agreements are queued so
            the owner can score the judge. Labels copy frozen snapshot text into the Golden Set.
            That loop needs a real model run, so the public demo explains it here instead of faking it.
          </p>
        </DemoAiExplainer>
      </main>
    );
  }

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

  const { ReviewQueueClient } = await import("@/app/review/review-queue-client");
  const { ReviewService } = await import("@/src/server/gmail/review-service");
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
