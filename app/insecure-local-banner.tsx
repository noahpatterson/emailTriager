import { isInsecureLocalDevRequested } from "@/src/server/auth/local-dev-flags";

export function InsecureLocalBanner() {
  if (!isInsecureLocalDevRequested()) return null;
  return (
    <details className="insecure-local-banner" open>
      <summary className="insecure-local-banner-summary">
        <span className="insecure-local-banner-title">Insecure local owner mode</span>
        <span className="insecure-local-banner-hint">Click to expand or collapse</span>
      </summary>
      <div className="insecure-local-banner-body" role="alert">
        <p>
          Neon Auth is bypassed. Anyone who can reach this app can become the configured
          owner with one click. Do not expose this process beyond localhost, and do not
          connect a mailbox you cannot afford to mess up.
        </p>
        <p>
          Requires <code>INSECURE_LOCAL_DEV=true</code> and{" "}
          <code>ALLOW_INSECURE_LOCAL_DEV=I_UNDERSTAND</code>. Never use this in a real
          deployment.
        </p>
      </div>
    </details>
  );
}
