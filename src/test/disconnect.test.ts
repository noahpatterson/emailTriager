import { describe, expect, mock, test } from "bun:test";
import { gmailConnection, syncLease } from "../../db/schema";
import type { Database } from "../server/db";

mock.module("server-only", () => ({}));
const { DisconnectService } = await import("../server/gmail/disconnect");

describe("Gmail disconnect fencing", () => {
  test("invalidates the active mutation lease before touching connection state", async () => {
    const calls: string[] = [];
    const db = {
      delete(table: unknown) {
        calls.push(table === syncLease ? "fence" : table === gmailConnection ? "delete-connection" : "delete");
        return { where: async () => undefined };
      },
      update(table: unknown) {
        expect(table).toBe(gmailConnection);
        calls.push("disconnect");
        return {
          set: () => ({
            where: () => ({
              returning: async () => [],
            }),
          }),
        };
      },
    } as unknown as Database;

    await new DisconnectService(db, async () => new Response()).disconnect("owner");

    expect(calls).toEqual(["fence", "disconnect"]);
  });
});
