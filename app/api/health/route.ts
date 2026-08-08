import { getPgPool, database } from "@/src/server/db";
import { isDemoProfile } from "@/src/server/demo/ai-gate";
import { healthResponse, pingDatabase } from "@/src/server/health";

export async function GET(): Promise<Response> {
  if (isDemoProfile()) {
    return healthResponse(async () => {
      const client = await getPgPool().connect();
      try {
        await client.query("SELECT 1");
      } finally {
        client.release();
      }
    });
  }
  return healthResponse(() => pingDatabase(database()));
}
