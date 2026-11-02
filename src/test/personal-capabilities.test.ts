import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { GoogleGmailProvider } from "../server/gmail/google";
mock.module("server-only", () => ({}));
const { createJevContestClassifier } = await import("../server/gmail/contest-jev");
const { createJudgeModel } = await import("../server/gmail/model-config");
const { GoogleConnectionService } = await import("../server/oauth/google");

const names = ["APP_PROFILE", "VERCEL_ENV", "VERCEL", "INSECURE_LOCAL_DEV", "ALLOW_INSECURE_LOCAL_DEV", "PERSONAL_GMAIL_WRITES_ENABLED", "PERSONAL_EXTERNAL_AI_ENABLED"] as const;
let saved: Record<string, string | undefined>;
beforeEach(() => {
  saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  for (const name of names) delete process.env[name];
  process.env.APP_PROFILE = "personal";
  process.env.VERCEL_ENV = "production";
});
afterEach(() => {
  for (const name of names) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
});

describe("personal outbound capabilities", () => {
  test("denies mailbox writes before fetch and allows explicit opt-in", async () => {
    const requests: RequestInit[] = [];
    const provider = new GoogleGmailProvider("token", async (_url, init) => {
      requests.push(init ?? {});
      return Response.json({ id: "label-123", name: "triage" });
    });
    await expect(provider.modifyLabels({ messageId: "message-123", addLabelIds: ["label-123"], removeLabelIds: [] })).rejects.toThrow("PERSONAL_GMAIL_WRITES_ENABLED");
    await expect(provider.createLabel("triage")).rejects.toThrow("PERSONAL_GMAIL_WRITES_ENABLED");
    await expect(provider.trashMessage("message-123")).rejects.toThrow("PERSONAL_GMAIL_WRITES_ENABLED");
    expect(requests).toEqual([]);
    process.env.PERSONAL_GMAIL_WRITES_ENABLED = "true";
    expect(await provider.createLabel("triage")).toEqual({ id: "label-123", name: "triage" });
    expect(requests[0]?.cache).toBe("no-store");
  });
  test("denies live Gmail reads and OAuth in preview before any network or DB work", async () => {
    process.env.VERCEL_ENV = "preview";
    const fetcher = mock(async () => Response.json({ messages: [{ id: "message-123", threadId: "thread-123" }] }));
    const provider = new GoogleGmailProvider("token", fetcher);
    await expect(provider.listLabels()).rejects.toThrow("VERCEL_ENV");
    await expect(provider.revoke()).rejects.toThrow("VERCEL_ENV");
    await expect(new GoogleConnectionService(undefined, fetcher).begin("owner")).rejects.toThrow("VERCEL_ENV");
    expect(fetcher).not.toHaveBeenCalled();
    process.env.VERCEL_ENV = "production";
    await provider.revoke();
    expect(fetcher.mock.calls.length).toBe(1);
    expect(await provider.listMessages({ sourceLabelId: "INBOX", maxResults: 1 })).toEqual({ messages: [{ id: "message-123", threadId: "thread-123" }] });
  });
  test("denies injected AI configuration and the Jev callback before fetch", async () => {
    const fetcher = mock(async () => Response.json({
      model: "personal-model",
      answers: {
        category: { type: "choice", choice: "irrelevant", confidence: 1, probabilities: { winner: 0, new_contest: 0, entry_confirmation: 0, notification_update: 0, irrelevant: 1 } },
        explicit_win: { type: "noul", noul: 0 }, claim_action: { type: "noul", noul: 0 },
      },
      usage: { input_tokens: 5, output_tokens: 3 },
    }));
    const classifier = createJevContestClassifier({ apiKey: "key", fetcher });
    await expect(classifier({ from: "sender", subject: "subject", bodyText: "body", replyTo: "", labelIds: [] })).rejects.toThrow("PERSONAL_EXTERNAL_AI_ENABLED");
    expect(() => createJudgeModel({ provider: "test", modelName: "model", baseUrl: "https://model.example.com", apiKey: "key" })).toThrow("PERSONAL_EXTERNAL_AI_ENABLED");
    expect(fetcher).not.toHaveBeenCalled();
    process.env.PERSONAL_EXTERNAL_AI_ENABLED = "true";
    expect((await classifier({ from: "sender", subject: "subject", bodyText: "body", replyTo: "", labelIds: [] })).category).toBe("irrelevant");
    expect(fetcher.mock.calls.length).toBe(1);
  });
});
