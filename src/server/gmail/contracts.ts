export type GmailMessageRef = Readonly<{ id: string; threadId: string }>;
export type GmailPage = Readonly<{ messages: readonly GmailMessageRef[]; nextPageToken?: string }>;
export type LabelChange = Readonly<{ messageId: string; addLabelIds: readonly string[]; removeLabelIds: readonly string[] }>;
export type GmailLabel = Readonly<{ id: string; name: string }>;
export interface GmailProvider {
  listMessages(input: { sourceLabelId: string; pageToken?: string; maxResults: number }): Promise<GmailPage>;
  getMessage(id: string): Promise<unknown>;
  listLabels(): Promise<readonly GmailLabel[]>;
  modifyLabels(change: LabelChange): Promise<void>;
  trashMessage(messageId: string): Promise<void>;
  revoke(): Promise<void>;
}
