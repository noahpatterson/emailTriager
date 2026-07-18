import Link from "next/link";
import { BrandLogo } from "@/app/brand-logo";
import { SignInForm } from "@/app/auth/sign-in/sign-in-form";

export const dynamic = "force-dynamic";

export default function SignInPage() {
  return (
    <main className="shell signed-out">
      <BrandLogo size="lg" />
      <p className="eyebrow">PRIVATE OWNER CONSOLE</p>
      <h1>Sign in</h1>
      <p>Use the configured owner account (email/password or Google) to open Email Triage.</p>
      <SignInForm />
      <Link className="back-link" href="/">← Back to Email Triage</Link>
    </main>
  );
}
