import "server-only";
import {
  DEMO_SESSION_MINT_LIMIT,
  DEMO_SYNC_LIMIT,
  checkDurableRateLimit,
  consumeDurableRateLimit,
  recordDurableRateLimitHit,
} from "@/src/server/demo/durable-rate-limit";

const SESSION_MINT_BUCKET = "demo_session_mint";

/** True when this IP may start another demo session (does not record a hit). */
export async function checkDemoSessionMintLimit(ipKey: string) {
  return checkDurableRateLimit({
    bucket: SESSION_MINT_BUCKET,
    key: ipKey,
    ...DEMO_SESSION_MINT_LIMIT,
  });
}

/** Record a successful demo session mint against the hourly cap. */
export async function recordDemoSessionMintHit(ipKey: string) {
  return recordDurableRateLimitHit({
    bucket: SESSION_MINT_BUCKET,
    key: ipKey,
  });
}

export async function consumeDemoSyncLimit(ipKey: string) {
  return consumeDurableRateLimit({
    bucket: "demo_sync",
    key: ipKey,
    ...DEMO_SYNC_LIMIT,
  });
}
