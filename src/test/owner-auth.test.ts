import { describe, expect, test } from "bun:test";
import { authorizeOwner } from "../server/auth/authorize-owner";

describe("owner authorization", () => {
  test("accepts only the configured Neon Auth user", async () => {
    await expect(authorizeOwner("owner-1", async () => ({ data: { user: { id: "owner-1" } } }))).resolves.toEqual({ userId: "owner-1" });
  });

  test("rejects signed-out and non-owner sessions", async () => {
    await expect(authorizeOwner("owner-1", async () => ({ data: null }))).rejects.toThrow("Not found");
    await expect(authorizeOwner("owner-1", async () => ({ data: { user: { id: "other" } } }))).rejects.toThrow("Not found");
  });

  test("fails closed on authentication errors", async () => {
    await expect(authorizeOwner("owner-1", async () => ({ data: { user: { id: "owner-1" } }, error: new Error("unavailable") }))).rejects.toThrow("Not found");
  });
});
