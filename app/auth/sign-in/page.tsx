import Link from "next/link";
import { BrandLogo } from "@/app/brand-logo";
import { SignInForm } from "@/app/auth/sign-in/sign-in-form";
import { getServerConfig } from "@/src/config/server";

export const dynamic = "force-dynamic";

export default function SignInPage() {
  const insecureLocalDev = getServerConfig().insecureLocalDev;
  return (
    <main className="shell signed-out">
      <BrandLogo size="lg" />
      <p className="eyebrow">{insecureLocalDev ? "INSECURE LOCAL DEV" : "PRIVATE OWNER CONSOLE"}</p>
      <h1>Sign in</h1>
      <p>
        {insecureLocalDev
          ? "Continue with the synthetic local owner session. Google OAuth for Gmail still uses your real OAuth client."
          : "Use the configured owner account (email/password or Google) to open Email Triage."}
      </p>
      <SignInForm insecureLocalDev={insecureLocalDev} />
      <Link className="back-link" href="/">← Back to Email Triage</Link>
    </main>
  );
}
