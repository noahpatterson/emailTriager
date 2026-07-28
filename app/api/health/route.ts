import { database } from "@/src/server/db";
import { healthResponse, pingDatabase } from "@/src/server/health";

export async function GET(): Promise<Response> {
  return healthResponse(() => pingDatabase(database()));
}
