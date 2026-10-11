import type { GmailLabel, GmailPage, GmailProvider, LabelChange } from "./contracts";

export class DeterministicGmailFake implements GmailProvider {
  readonly mutations: LabelChange[] = [];
  readonly trashed: string[] = [];
  readonly listMaxResults: number[] = [];
  private readonly createdLabels: GmailLabel[] = [];
  constructor(
    private readonly pages: Readonly<Record<string, GmailPage>>,
    private readonly messages: Readonly<Record<string, unknown>> = {},
    private readonly labels: readonly GmailLabel[] = [],
  ) {}
  async listMessages(input: { sourceLabelId: string; pageToken?: string; maxResults: number }): Promise<GmailPage> {
    this.listMaxResults.push(input.maxResults);
    return this.pages[input.pageToken ?? "first"] ?? { messages: [] };
  }
  async getMessage(id: string): Promise<unknown> {
    if (!(id in this.messages)) throw new Error("Fixture message not found");
    return this.messages[id];
  }
  async listLabels(): Promise<readonly GmailLabel[]> {
    return [...this.labels, ...this.createdLabels];
  }
  async createLabel(name: string): Promise<GmailLabel> {
    if (!name.trim()) throw new Error("Gmail label name must not be empty");
    const existing = [...this.labels, ...this.createdLabels].find((label) => label.name === name);
    if (existing) return existing;
    const ids = new Set([...this.labels, ...this.createdLabels].map((label) => label.id));
    let sequence = this.createdLabels.length + 1;
    while (ids.has(`Label_fake_${sequence}`)) sequence += 1;
    const label = { id: `Label_fake_${sequence}`, name };
    this.createdLabels.push(label);
    return label;
  }
  async modifyLabels(change: LabelChange): Promise<void> {
    this.mutations.push(change);
  }
  async trashMessage(messageId: string): Promise<void> {
    this.trashed.push(messageId);
  }
  async revoke(): Promise<void> {}
}
