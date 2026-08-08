import "server-only";
import {
  DEMO_SESSION_MINT_LIMIT,
  DEMO_SYNC_LIMIT,
  consumeDurableRateLimit,
} from "@/src/server/demo/durable-rate-limit";

export async function consumeDemoSessionMintLimit(ipKey: string) {
  return consumeDurableRateLimit({
    bucket: "demo_session_mint",
    key: ipKey,
    ...DEMO_SESSION_MINT_LIMIT,
  });
}

export async function consumeDemoSyncLimit(ipKey: string) {
  return consumeDurableRateLimit({
    bucket: "demo_sync",
    key: ipKey,
    ...DEMO_SYNC_LIMIT,
  });
}
