import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { handleContestGet, handleContestPost } from "../../app/api/contest/route";
import { handleContestPatch } from "../../app/api/contest/[messageId]/route";
import { ContestClientError } from "../server/gmail/contest-scan";
import type { ContestResultRow, ContestOverview, ContestScanResponse, ContestLabels } from "../server/gmail/contest-contracts";
let previousProfile: string | undefined;
beforeEach(() => { previousProfile = process.env.APP_PROFILE; process.env.APP_PROFILE = "production"; });
afterEach(() => { if (previousProfile === undefined) delete process.env.APP_PROFILE; else process.env.APP_PROFILE = previousProfile; });
const ownerScope = async (run: (owner: { userId: string }) => Promise<Response>) => run({ userId: "owner" });
const overview: ContestOverview = { settings: null, results: [], latestRun: null, modelConfigured: true, notificationsConfigured: false, disabled: false };
function request(body: unknown, origin = "http://localhost:3000", method = "POST") {
  return new Request("http://localhost:3000/api/contest", { method, headers: { origin, host: "localhost:3000", "content-type": "application/json" }, body: JSON.stringify(body) });
}
const service = {
  overview: async () => overview,
  configure: async () => ({ settings: { labels: { winner: "a", new_contest: "b", entry_confirmation: "c", notification_update: "d", irrelevant: "e" } } }),
  scan: async (): Promise<ContestScanResponse> => { throw new ContestClientError("model_not_configured"); },
};
describe("contest API boundaries", () => {
  test("fixture routes disable reads and mutations before touching contest storage", async () => {
    process.env.APP_PROFILE = "demo";
    const response = await handleContestGet(service, ownerScope);
    expect(await response.json()).toEqual({ settings: null, results: [], latestRun: null, modelConfigured: false, notificationsConfigured: false, disabled: true });
    expect((await handleContestPost(request({ action: "scan", trial: true }), service, ownerScope)).status).toBe(403);
    expect((await handleContestPatch(request({ category: "winner" }, undefined, "PATCH"), { params: Promise.resolve({ messageId: "m1" }) }, { correct: async (): Promise<{ result: ContestResultRow }> => { throw new Error("must not run"); } }, ownerScope)).status).toBe(403);
  });
  test("GET returns safe overview under owner scope", async () => {
    expect(await (await handleContestGet(service, ownerScope)).json()).toEqual(overview);
  });
  test("rejects missing owner authorization and sanitizes private errors", async () => {
    const response = await handleContestGet(service, async () => { throw new Error("SECRET_OWNER_DATA"); });
    expect(response.status).toBe(400); expect(await response.json()).toEqual({ error: "Request could not be completed" });
  });
  test("requires same-origin and valid discriminated action before service", async () => {
    expect((await handleContestPost(request({ action: "scan", trial: true }, "https://evil.example"), service, ownerScope)).status).toBe(400);
    expect((await handleContestPost(request({ action: "scan", trial: "true" }), service, ownerScope)).status).toBe(400);
    expect((await handleContestPost(request({ action: "scan", trial: true, apiKey: "secret" }), service, ownerScope)).status).toBe(400);
  });
  test("maps safe model configuration error", async () => {
    const response = await handleContestPost(request({ action: "scan", trial: true }), service, ownerScope);
    expect(await response.json()).toEqual({ error: "model_not_configured" });
  });
  test("configure dispatches owner and exact labels", async () => {
    let called = false;
    const active = { ...service, configure: async (ownerId: string, labels: ContestLabels) => { expect(ownerId).toBe("owner"); called = true; return { settings: { labels } }; } };
    // Explicit shape is accepted; provider-side catalog checks are covered by service tests.
    const labels = { winner: "a", new_contest: "b", entry_confirmation: "c", notification_update: "d", irrelevant: "e" };
    const response = await handleContestPost(request({ action: "configure", labels }), active, ownerScope);
    expect(response.status).toBe(200); expect(called).toBe(true);
  });
  test("PATCH rejects invalid category and maps missing account-scoped result", async () => {
    const active = { correct: async (): Promise<{ result: ContestResultRow }> => { throw new ContestClientError("message_not_found", 404); } };
    const context = { params: Promise.resolve({ messageId: "m1" }) };
    expect((await handleContestPatch(request({ category: "unknown" }, undefined, "PATCH"), context, active, ownerScope)).status).toBe(400);
    const response = await handleContestPatch(request({ category: "winner" }, undefined, "PATCH"), context, active, ownerScope);
    expect(response.status).toBe(404); expect(await response.json()).toEqual({ error: "message_not_found" });
  });
});
