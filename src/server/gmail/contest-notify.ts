import "server-only";
import type { ContestCategory } from "./contest-classify";

export type ContestNotificationStatus = "sent" | "failed" | "uncertain";
export type ContestNotificationOutcome = ContestNotificationStatus | "disabled" | "ineligible" | "duplicate";
export type ContestNotificationResult = Readonly<{
  gmailMessageId: string;
  sender: string;
  subject: string;
  category: ContestCategory;
  manualCategory: ContestCategory | null;
  explicitWinProbability: number;
  claimActionProbability: number;
  claimDeadline: string | null;
  gmailUrl: string;
  labelStatus: "pending" | "applied" | "protected";
  notificationStatus: "reserved" | ContestNotificationStatus | null;
}>;
export type ContestNotificationStore = Readonly<{
  reserveNotification(ownerId: string, googleSubject: string, messageId: string): Promise<boolean>;
  finishNotification(ownerId: string, googleSubject: string, messageId: string, status: ContestNotificationStatus): Promise<void>;
}>;
export type ContestNotificationConfig = Readonly<{
  enabled: boolean;
  configured: boolean;
  server: string;
  topic: string;
  accessToken: string;
  winnerThreshold: number;
}>;

/** Delivery is opt-in and requires an explicit accuracy-validation gate. */
export function getContestNotificationConfig(env: Readonly<Record<string, string | undefined>> = process.env): ContestNotificationConfig {
  const serverValue = env.NTFY_SERVER?.trim() || "https://ntfy.sh";
  const topic = env.NTFY_TOPIC?.trim() || "";
  const accessToken = env.NTFY_ACCESS_TOKEN?.trim() || "";
  const rawThreshold = env.CONTEST_WINNER_THRESHOLD;
  const winnerThreshold = rawThreshold === undefined ? 0.9 : Number(rawThreshold);
  let server = "";
  try {
    const url = new URL(serverValue);
    if (url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash && url.pathname === "/") server = url.href;
  } catch { /* Invalid configuration leaves delivery disabled. */ }
  const configured = Boolean(server && /^[A-Za-z0-9_-]{1,64}$/.test(topic) && accessToken && !/[\r\n]/.test(accessToken)
    && (rawThreshold === undefined || rawThreshold.trim() !== "") && Number.isFinite(winnerThreshold) && winnerThreshold >= 0.9 && winnerThreshold <= 1);
  return {
    configured,
    enabled: configured && env.CONTEST_NOTIFICATIONS_ENABLED === "true" && env.CONTEST_ACCURACY_VALIDATED === "true",
    server, topic, accessToken, winnerThreshold,
  };
}

function validProbability(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function gmailLink(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "mail.google.com" && !url.username && !url.password;
  } catch { return false; }
}

/** Reserve once before publishing. Ambiguous delivery stays blocked to avoid duplicate alerts. */
export function createContestNotifier(options: Readonly<{
  store: ContestNotificationStore;
  config?: ContestNotificationConfig;
  fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  timeoutMs?: number;
}>) {
  const config = options.config ?? getContestNotificationConfig();
  const publish = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60_000) throw new RangeError("Notification timeout must be between 0 and 60000 milliseconds");
  return {
    configured: (): boolean => config.enabled,
    async notify(ownerId: string, googleSubject: string, result: ContestNotificationResult): Promise<ContestNotificationOutcome> {
      if (!config.enabled) return "disabled";
      if ((result.manualCategory ?? result.category) !== "winner" || result.labelStatus !== "applied"
        || !validProbability(result.explicitWinProbability) || !validProbability(result.claimActionProbability)
        || result.explicitWinProbability < config.winnerThreshold || !gmailLink(result.gmailUrl)) return "ineligible";
      if (result.notificationStatus && result.notificationStatus !== "failed") return "duplicate";
      if (!await options.store.reserveNotification(ownerId, googleSubject, result.gmailMessageId)) return "duplicate";
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let status: ContestNotificationStatus = "uncertain";
      try {
        const response = await Promise.race([
          publish(config.server, {
            method: "POST", redirect: "error", signal: controller.signal,
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.accessToken}` },
            body: JSON.stringify({
              topic: config.topic,
              title: `Contest win (${Math.round(result.explicitWinProbability * 100)}%)`,
              message: [
                `From: ${result.sender}`, `Subject: ${result.subject}`,
                `Explicit win probability: ${Math.round(result.explicitWinProbability * 100)}%`,
                `Claim action probability: ${Math.round(result.claimActionProbability * 100)}%. Check Gmail for the required action.`,
                result.claimDeadline ? `Claim deadline: ${result.claimDeadline}. Verify in Gmail.` : "Claim deadline: unknown. Check Gmail promptly.",
                result.gmailUrl,
              ].join("\n"),
              click: result.gmailUrl,
            }),
          }),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => { controller.abort(); reject(new Error("Notification timed out")); }, timeoutMs);
          }),
        ]);
        status = response.ok ? "sent" : response.status >= 400 && response.status < 500 ? "failed" : "uncertain";
      } catch { /* Provider errors may contain secrets or mailbox content. */ }
      finally { if (timer !== undefined) clearTimeout(timer); }
      await options.store.finishNotification(ownerId, googleSubject, result.gmailMessageId, status);
      return status;
    },
  };
}
