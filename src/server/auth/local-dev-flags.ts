export const LOCAL_DEV_OWNER_ID_DEFAULT = "local-dev-owner";
export const LOCAL_DEV_SESSION_COOKIE = "et_local_dev_session";
export const ALLOW_INSECURE_LOCAL_DEV_SENTINEL = "I_UNDERSTAND";
export const LOCAL_DEV_PROFILE = "local-compose";

function isInsecureLocalDevFlagSet(): boolean {
  return process.env.INSECURE_LOCAL_DEV?.trim().toLowerCase() === "true";
}

function hasInsecureLocalDevSentinel(): boolean {
  return (
    process.env.ALLOW_INSECURE_LOCAL_DEV === ALLOW_INSECURE_LOCAL_DEV_SENTINEL
  );
}

function isExplicitLocalDevelopmentProfile(): boolean {
  return process.env.APP_PROFILE === LOCAL_DEV_PROFILE;
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1"
  );
}

function hostnameFromAuthority(value: string): string | null {
  try {
    return new URL(`http://${value.trim()}`).hostname;
  } catch {
    return null;
  }
}

export function assertInsecureLocalDevConfiguredOrigin(value: string): void {
  let hostname: string;
  try {
    hostname = new URL(value).hostname;
  } catch {
    throw new Error(
      "Insecure local mode requires a valid loopback GOOGLE_REDIRECT_URI",
    );
  }
  if (!isLoopbackHostname(hostname)) {
    throw new Error(
      "Insecure local mode requires a loopback GOOGLE_REDIRECT_URI",
    );
  }
}

export function assertInsecureLocalDevRequest(headers: Headers): void {
  const authorities = [headers.get("host"), headers.get("x-forwarded-host")]
    .flatMap((value) => value?.split(",") ?? [])
    .map((value) => value.trim())
    .filter(Boolean);
  if (
    authorities.length === 0 ||
    authorities.some((value) => {
      const hostname = hostnameFromAuthority(value);
      return hostname === null || !isLoopbackHostname(hostname);
    })
  ) {
    throw new Error(
      "Insecure local mode requires a loopback Host and X-Forwarded-Host",
    );
  }
  const origin = headers.get("origin");
  if (origin) {
    let hostname: string;
    try {
      hostname = new URL(origin).hostname;
    } catch {
      throw new Error("Insecure local mode requires a valid loopback Origin");
    }
    if (!isLoopbackHostname(hostname)) {
      throw new Error("Insecure local mode requires a loopback Origin");
    }
  }
}

export function isInsecureLocalDevRequested(): boolean {
  return (
    isInsecureLocalDevFlagSet() &&
    hasInsecureLocalDevSentinel() &&
    isExplicitLocalDevelopmentProfile()
  );
}

/** Fail fast when insecure local mode is requested with unsafe or incomplete config. */
export function assertInsecureLocalDevAllowed(driver: string): void {
  if (!isInsecureLocalDevFlagSet()) return;
  if (!hasInsecureLocalDevSentinel()) {
    throw new Error(
      `INSECURE_LOCAL_DEV requires ALLOW_INSECURE_LOCAL_DEV=${ALLOW_INSECURE_LOCAL_DEV_SENTINEL}`,
    );
  }
  if (!isExplicitLocalDevelopmentProfile()) {
    throw new Error(
      `INSECURE_LOCAL_DEV requires APP_PROFILE=${LOCAL_DEV_PROFILE}`,
    );
  }
  if (driver !== "pg") {
    throw new Error("INSECURE_LOCAL_DEV requires DATABASE_DRIVER=pg");
  }
}
