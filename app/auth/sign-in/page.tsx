import Link from "next/link";
import { SignInForm } from "@/app/auth/sign-in/sign-in-form";

export const dynamic = "force-dynamic";

export default function SignInPage() {
  return <main className="shell signed-out">
    <div className="lock">✦</div>
    <p className="eyebrow">PRIVATE OWNER CONSOLE</p>
    <h1>Sign in</h1>
    <p>Use the configured owner account (email/password or Google) to open Email Triage.</p>
    <SignInForm />
    <Link className="back-link" href="/">← Back to Email Triage</Link>
  </main>;
}
