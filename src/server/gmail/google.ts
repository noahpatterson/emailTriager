import { assertLiveGmailAllowed, assertGmailWritesAllowed, getPersonalDeploymentPolicy } from "@/src/config/deployment-policy";
import type { GmailLabel, GmailPage, GmailProvider, LabelChange } from "./contracts";
import { fetchWithRetry } from "@/src/server/http/fetch-with-retry";

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class GoogleGmailProvider implements GmailProvider {
  constructor(private readonly accessToken: string, private readonly fetcher: Fetcher = fetch) {}
  private async request(path: string, init?: RequestInit): Promise<Response> {
    assertLiveGmailAllowed();
    const response = await fetchWithRetry(this.fetcher, `https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
      ...init,
      cache: "no-store",
      headers: { authorization: `Bearer ${this.accessToken}`, "content-type": "application/json", ...init?.headers },
    }, getPersonalDeploymentPolicy() ? { timeoutMs: 5000, maxAttempts: 2 } : undefined);
    if (!response.ok) {
      throw new Error(`Gmail request failed (${response.status})`);
    }
    return response;
  }
  async listMessages(input: { sourceLabelId: string; pageToken?: string; maxResults: number }): Promise<GmailPage> {
    const maxResults = Math.trunc(Number(input.maxResults));
    if (!Number.isFinite(maxResults) || maxResults < 1 || maxResults > 500) {
      throw new Error(`Invalid maxResults: expected integer 1..500, got ${String(input.maxResults)}`);
    }
    const params = new URLSearchParams({ labelIds: input.sourceLabelId, maxResults: String(maxResults) });
    if (input.pageToken) params.set("pageToken", input.pageToken);
    const body = await (await this.request(`messages?${params}`)).json() as { messages?: { id: string; threadId: string }[]; nextPageToken?: string; resultSizeEstimate?: unknown };
    const estimate = body.resultSizeEstimate;
    const resultSizeEstimate = typeof estimate === "number" && Number.isInteger(estimate) && estimate >= 0 && estimate <= 4_294_967_295 ? estimate : undefined;
    return { messages: body.messages ?? [], ...(body.nextPageToken ? { nextPageToken: body.nextPageToken } : {}), ...(resultSizeEstimate === undefined ? {} : { resultSizeEstimate }) };
  }
  async getMessage(id: string): Promise<unknown> {
    return (await this.request(`messages/${encodeURIComponent(id)}?format=full`)).json();
  }
  async listLabels(): Promise<readonly GmailLabel[]> {
    const body = await (await this.request("labels")).json() as { labels?: { id?: string; name?: string }[] };
    return (body.labels ?? [])
      .filter((label): label is { id: string; name: string } => typeof label.id === "string" && typeof label.name === "string")
      .map((label) => ({ id: label.id, name: label.name }));
  }
  async modifyLabels(change: LabelChange): Promise<void> {
    assertGmailWritesAllowed();
    await this.request(`messages/${encodeURIComponent(change.messageId)}/modify`, {
      method: "POST",
      body: JSON.stringify({ addLabelIds: change.addLabelIds, removeLabelIds: change.removeLabelIds }),
    });
  }
  async createLabel(name: string): Promise<GmailLabel> {
    assertGmailWritesAllowed();
    if (!name.trim()) throw new Error("Gmail label name must not be empty");
    let body: unknown;
    try {
      body = await (await this.request("labels", {
        method: "POST",
        body: JSON.stringify({ name, labelListVisibility: "labelShow", messageListVisibility: "show" }),
      })).json();
    } catch {
      throw new Error("Gmail label creation failed");
    }
    if (!body || typeof body !== "object" || !("id" in body) || !("name" in body)
      || typeof body.id !== "string" || !body.id.trim() || typeof body.name !== "string" || body.name !== name) {
      throw new Error("Gmail label creation returned an invalid label");
    }
    return { id: body.id, name: body.name };
  }
  async trashMessage(messageId: string): Promise<void> {
    assertGmailWritesAllowed();
    await this.request(`messages/${encodeURIComponent(messageId)}/trash`, { method: "POST" });
  }
  async revoke(): Promise<void> {
    assertLiveGmailAllowed();
    await fetchWithRetry(this.fetcher, `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(this.accessToken)}`, { method: "POST", cache: "no-store" });
  }
}
