import { describe, expect, mock, test } from "bun:test";
mock.module("server-only", () => ({}));
const { createContestNotifier, getContestNotificationConfig } = await import("../server/gmail/contest-notify");
import type { ContestNotificationResult, ContestNotificationStatus } from "../server/gmail/contest-notify";

const env = {
  NTFY_TOPIC: "private-alerts", NTFY_ACCESS_TOKEN: "secret-token",
  CONTEST_NOTIFICATIONS_ENABLED: "true", CONTEST_ACCURACY_VALIDATED: "true",
};
const result: ContestNotificationResult = {
  gmailMessageId: "message", sender: "Contest <sender@example.com>", subject: "You won",
  category: "winner", manualCategory: null, explicitWinProbability: 0.9,
  claimActionProbability: 0.8, claimDeadline: null, gmailUrl: "https://mail.google.com/mail/u/0/#all/message",
  labelStatus: "applied", notificationStatus: null,
};
function setup(response: () => Promise<Response> = async () => new Response("ok"), timeoutMs = 100) {
  let reserved = false;
  const finished: ContestNotificationStatus[] = [];
  const fetcher = mock(async (_url: string | URL | Request, _init?: RequestInit) => response());
  const reserve = mock(async () => {
    if (reserved) return false;
    reserved = true;
    return true;
  });
  const notifier = createContestNotifier({
    config: getContestNotificationConfig(env), fetch: fetcher,
    timeoutMs, store: { reserveNotification: reserve, finishNotification: async (_a, _b, _c, status) => { finished.push(status); } },
  });
  return { notifier, fetcher, reserve, finished };
}

describe("contest notifications", () => {
  test("configuration defaults to disabled and rejects unsafe endpoints and thresholds", () => {
    expect(getContestNotificationConfig({}).enabled).toBe(false);
    expect(getContestNotificationConfig({ ...env, CONTEST_ACCURACY_VALIDATED: "false" }).enabled).toBe(false);
    expect(getContestNotificationConfig({ ...env, CONTEST_NOTIFICATIONS_ENABLED: "false" }).enabled).toBe(false);
    for (const server of ["http://ntfy.sh", "https://user:pass@ntfy.sh", "https://ntfy.sh/?token=secret", "https://ntfy.sh/#secret", "https://ntfy.sh/topic"]) {
      expect(getContestNotificationConfig({ ...env, NTFY_SERVER: server }).configured).toBe(false);
    }
    for (const threshold of ["", "   ", "NaN", "-1", "0.89", "1.01", "Infinity"]) {
      expect(getContestNotificationConfig({ ...env, CONTEST_WINNER_THRESHOLD: threshold }).configured).toBe(false);
    }
    expect(getContestNotificationConfig(env).winnerThreshold).toBe(0.9);
  });

  test("configured hook requires credentials and both opt-in flags", async () => {
    const reserve = mock(async () => true);
    const fetcher = mock(async () => new Response("ok"));
    for (const flags of [{}, { CONTEST_NOTIFICATIONS_ENABLED: "true" }, { CONTEST_ACCURACY_VALIDATED: "true" }]) {
      const config = getContestNotificationConfig({ NTFY_TOPIC: env.NTFY_TOPIC, NTFY_ACCESS_TOKEN: env.NTFY_ACCESS_TOKEN, ...flags });
      expect(config.configured).toBe(true);
      const notifier = createContestNotifier({ config, fetch: fetcher,
        store: { reserveNotification: reserve, finishNotification: async () => {} } });
      expect(notifier.configured()).toBe(false);
      expect(await notifier.notify("owner", "google", result)).toBe("disabled");
    }
    expect(reserve).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
    expect(setup().notifier.configured()).toBe(true);
  });

  test("a stricter threshold blocks lower scores before reservation", async () => {
    const reserve = mock(async () => true);
    const fetcher = mock(async () => new Response("ok"));
    const notifier = createContestNotifier({ config: getContestNotificationConfig({ ...env, CONTEST_WINNER_THRESHOLD: "0.95" }),
      fetch: fetcher, store: { reserveNotification: reserve, finishNotification: async () => {} } });
    expect(await notifier.notify("owner", "google", result)).toBe("ineligible");
    expect(reserve).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
    expect(await notifier.notify("owner", "google", { ...result, explicitWinProbability: 0.95 })).toBe("sent");
  });

  test("disabled delivery never reserves or fetches", async () => {
    const reserve = mock(async () => true);
    const fetcher = mock(async () => new Response("ok"));
    const notifier = createContestNotifier({ config: getContestNotificationConfig({}), fetch: fetcher,
      store: { reserveNotification: reserve, finishNotification: async () => {} } });
    expect(await notifier.notify("owner", "google", result)).toBe("disabled");
    expect(reserve).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  test("explicit win threshold, manual suppression and applied labels gate delivery", async () => {
    const { notifier, fetcher, reserve } = setup();
    for (const patch of [
      { explicitWinProbability: 0.899 }, { explicitWinProbability: NaN }, { explicitWinProbability: 1.1 },
      { claimActionProbability: NaN }, { manualCategory: "irrelevant" as const },
      { category: "new_contest" as const }, { labelStatus: "pending" as const }, { labelStatus: "protected" as const },
      { gmailUrl: "https://evil.example/" },
    ]) expect(await notifier.notify("owner", "google", { ...result, ...patch })).toBe("ineligible");
    expect(reserve).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
    expect(await notifier.notify("owner", "google", result)).toBe("sent");
  });

  test("manual winner still needs sufficient explicit win probability", async () => {
    const { notifier } = setup();
    expect(await notifier.notify("owner", "google", { ...result, category: "irrelevant", manualCategory: "winner", explicitWinProbability: 0.7 })).toBe("ineligible");
  });

  test("JSON delivery includes scores, unknown deadline and Gmail link, with redirects blocked", async () => {
    const { notifier, fetcher, finished } = setup();
    await notifier.notify("owner", "google", result);
    const [url, request] = fetcher.mock.calls[0]!;
    expect(url).toBe("https://ntfy.sh/");
    expect(request?.redirect).toBe("error");
    expect(request?.headers).toEqual({ "Content-Type": "application/json", Authorization: "Bearer secret-token" });
    const body = JSON.parse(request?.body as string);
    expect(body.topic).toBe("private-alerts");
    expect(body.click).toBe(result.gmailUrl);
    for (const text of [result.sender, result.subject, "90%", "80%", "deadline: unknown", result.gmailUrl]) expect(body.message).toContain(text);
    expect(finished).toEqual(["sent"]);
  });

  test("concurrent attempts use the durable reservation to send once", async () => {
    const { notifier, fetcher } = setup();
    expect((await Promise.all([notifier.notify("owner", "google", result), notifier.notify("owner", "google", result)])).sort()).toEqual(["duplicate", "sent"]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    for (const notificationStatus of ["reserved", "sent", "uncertain"] as const) {
      expect(await notifier.notify("owner", "google", { ...result, notificationStatus })).toBe("duplicate");
    }
  });

  test("4xx rejection can be retried by a later scan, but 5xx stays uncertain", async () => {
    for (const [code, expected] of [[400, "failed"], [401, "failed"], [429, "failed"], [500, "uncertain"], [302, "uncertain"]] as const) {
      const { notifier, fetcher, finished } = setup(async () => new Response("secret-token sender@example.com", { status: code }));
      expect(await notifier.notify("owner", "google", { ...result, notificationStatus: "failed" })).toBe(expected);
      expect(finished).toEqual([expected]);
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });

  test("network exceptions and unresponsive fetch produce sanitized uncertainty without retries", async () => {
    const broken = setup(async () => { throw new Error("secret-token sender@example.com"); });
    expect(await broken.notifier.notify("owner", "google", result)).toBe("uncertain");
    expect(broken.finished).toEqual(["uncertain"]);
    expect(broken.fetcher).toHaveBeenCalledTimes(1);
    const hanging = setup(() => new Promise(() => {}), 5);
    expect(await hanging.notifier.notify("owner", "google", result)).toBe("uncertain");
    expect(hanging.finished).toEqual(["uncertain"]);
    expect(hanging.fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  test("failed status persistence leaves the reservation blocking another send", async () => {
    const fetcher = mock(async () => new Response("ok"));
    let reserved = false;
    const notifier = createContestNotifier({ config: getContestNotificationConfig(env), fetch: fetcher,
      store: { reserveNotification: async () => { if (reserved) return false; reserved = true; return true; },
        finishNotification: async () => { throw new Error("database unavailable"); } } });
    await expect(notifier.notify("owner", "google", result)).rejects.toThrow("database unavailable");
    expect(await notifier.notify("owner", "google", result)).toBe("duplicate");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
