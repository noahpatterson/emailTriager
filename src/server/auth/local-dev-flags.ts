export const LOCAL_DEV_OWNER_ID_DEFAULT = "local-dev-owner";
export const LOCAL_DEV_SESSION_COOKIE = "et_local_dev_session";
export const ALLOW_INSECURE_LOCAL_DEV_SENTINEL = "I_UNDERSTAND";

function isInsecureLocalDevFlagSet(): boolean {
  return process.env.INSECURE_LOCAL_DEV?.trim().toLowerCase() === "true";
}

function hasInsecureLocalDevSentinel(): boolean {
  return process.env.ALLOW_INSECURE_LOCAL_DEV === ALLOW_INSECURE_LOCAL_DEV_SENTINEL;
}

export function isInsecureLocalDevRequested(): boolean {
  return isInsecureLocalDevFlagSet() && hasInsecureLocalDevSentinel();
}

/** Fail fast when insecure local mode is requested with unsafe or incomplete config. */
export function assertInsecureLocalDevAllowed(driver: string): void {
  if (!isInsecureLocalDevFlagSet()) return;
  if (!hasInsecureLocalDevSentinel()) {
    throw new Error(
      `INSECURE_LOCAL_DEV requires ALLOW_INSECURE_LOCAL_DEV=${ALLOW_INSECURE_LOCAL_DEV_SENTINEL}`,
    );
  }
  // Do not gate on process.env.NODE_ENV: Next standalone builds inline it to
  // "production" at compile time, which would block Docker insecure-local forever.
  // Production safety is: never set INSECURE_LOCAL_DEV / ALLOW_INSECURE_LOCAL_DEV.
  if (driver !== "pg") {
    throw new Error("INSECURE_LOCAL_DEV requires DATABASE_DRIVER=pg");
  }
}
