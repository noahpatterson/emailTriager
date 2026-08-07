"use client";

import { useState } from "react";
import {
  DEFAULT_TRIAGE_CONFIG,
  MAX_CATEGORY_INTENT_CHARS,
  parseTermList,
  type TriageConfigInput,
  type TriageConfigView,
} from "@/src/server/config/triage-validate";

type ConfigFormState = Readonly<{
  sourceLabelId: string;
  priorityLabelId: string;
  reviewLabelId: string;
  newLabelId: string;
  archiveLabelId: string;
  priorityTerms: string;
  reviewTerms: string;
  newTerms: string;
  senderWhitelist: string;
  senderBlocklist: string;
  priorityIntent: string;
  reviewIntent: string;
  newIntent: string;
  archiveIntent: string;
  autoApplyPromotions: boolean;
  maxPages: string;
  maxMessagesPerPage: string;
  maxTotalMessages: string;
}>;

function joinLines(values: readonly string[]): string {
  return values.join("\n");
}

function toFormState(config: TriageConfigInput): ConfigFormState {
  return {
    sourceLabelId: config.sourceLabelId,
    priorityLabelId: config.priorityLabelId,
    reviewLabelId: config.reviewLabelId,
    newLabelId: config.newLabelId,
    archiveLabelId: config.archiveLabelId,
    priorityTerms: joinLines(config.terms.priority),
    reviewTerms: joinLines(config.terms.review),
    newTerms: joinLines(config.terms.new),
    senderWhitelist: joinLines(config.senderWhitelist),
    senderBlocklist: joinLines(config.senderBlocklist),
    priorityIntent: config.categoryIntent.priority,
    reviewIntent: config.categoryIntent.review,
    newIntent: config.categoryIntent.new,
    archiveIntent: config.categoryIntent.archive,
    autoApplyPromotions: config.autoApplyPromotions,
    maxPages: String(config.bounds.maxPages),
    maxMessagesPerPage: String(config.bounds.maxMessagesPerPage),
    maxTotalMessages: String(config.bounds.maxTotalMessages),
  };
}

function fromFormState(form: ConfigFormState): TriageConfigInput {
  return {
    sourceLabelId: form.sourceLabelId,
    priorityLabelId: form.priorityLabelId,
    reviewLabelId: form.reviewLabelId,
    newLabelId: form.newLabelId,
    archiveLabelId: form.archiveLabelId,
    terms: {
      priority: parseTermList(form.priorityTerms),
      review: parseTermList(form.reviewTerms),
      new: parseTermList(form.newTerms),
    },
    senderWhitelist: parseTermList(form.senderWhitelist),
    senderBlocklist: parseTermList(form.senderBlocklist),
    categoryIntent: {
      priority: form.priorityIntent,
      review: form.reviewIntent,
      new: form.newIntent,
      archive: form.archiveIntent,
    },
    autoApplyPromotions: form.autoApplyPromotions,
    bounds: {
      maxPages: Number(form.maxPages),
      maxMessagesPerPage: Number(form.maxMessagesPerPage),
      maxTotalMessages: Number(form.maxTotalMessages),
    },
  };
}

export function ConfigurationForm({
  initialConfig,
  gmailConnected,
}: {
  initialConfig: TriageConfigView | null;
  gmailConnected: boolean;
}) {
  const [form, setForm] = useState<ConfigFormState>(() => toFormState(initialConfig ?? DEFAULT_TRIAGE_CONFIG));
  const [version, setVersion] = useState(initialConfig?.version ?? null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function updateForm<K extends keyof ConfigFormState>(key: K, value: ConfigFormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function saveConfig(): Promise<void> {
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      if (!gmailConnected) {
        throw new Error("Connect Gmail on the dashboard before saving labels.");
      }
      const response = await fetch("/api/config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        redirect: "manual",
        body: JSON.stringify(fromFormState(form)),
      });
      const body = await response.json() as { config?: TriageConfigView; error?: string };
      if (!response.ok || !body.config) {
        throw new Error(body.error || "Configuration could not be saved. Use exact Gmail label names and check terms/whitelist/bounds.");
      }
      setForm(toFormState(body.config));
      setVersion(body.config.version);
      setNotice(`Configuration v${body.config.version} saved. Label names were matched to your Gmail account.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Configuration could not be saved.");
    } finally {
      setPending(false);
    }
  }

  return <>
    <div className="announcements" aria-live="polite" aria-atomic="true">
      {error && <div className="alert error" role="alert"><strong>Action needed</strong><span>{error}</span></div>}
      {notice && <div className="alert success" role="status"><strong>Update</strong><span>{notice}</span></div>}
      {!gmailConnected && <div className="alert error" role="status"><strong>Gmail required</strong><span>Connect Gmail on the dashboard so label names can be matched to your mailbox.</span></div>}
    </div>

    <section className="history config-panel">
      <div className="section-heading">
        <div>
          <p className="step">CONFIGURATION</p>
          <h2>Labels, terms, and bounds</h2>
        </div>
        <p>{version !== null ? `Active snapshot v${version}. Saving creates a new version.` : "No configuration saved yet. Sync stays disabled until you save."}</p>
      </div>

      <form className="config-form" onSubmit={(event) => { event.preventDefault(); void saveConfig(); }}>
        <fieldset>
          <legend>Gmail labels</legend>
          <p className="field-help">
            Create these labels in your Gmail account first, then enter the names here exactly as they appear (for example <code>Triage/Inbox</code>). Nested labels use a slash. Names are resolved to IDs when you save.{" "}
            <a href="https://support.google.com/mail/answer/118708" target="_blank" rel="noopener noreferrer">How to create labels in Gmail</a>
          </p>
          <div className="config-grid">
            <label htmlFor="sourceLabelId">Source label
              <input id="sourceLabelId" name="sourceLabelId" value={form.sourceLabelId} onChange={(e) => updateForm("sourceLabelId", e.target.value)} autoComplete="off" required disabled={pending} placeholder="Triage/Source" />
            </label>
            <label htmlFor="priorityLabelId">Priority destination
              <input id="priorityLabelId" name="priorityLabelId" value={form.priorityLabelId} onChange={(e) => updateForm("priorityLabelId", e.target.value)} autoComplete="off" required disabled={pending} placeholder="Triage/Priority" />
            </label>
            <label htmlFor="reviewLabelId">Review destination
              <input id="reviewLabelId" name="reviewLabelId" value={form.reviewLabelId} onChange={(e) => updateForm("reviewLabelId", e.target.value)} autoComplete="off" required disabled={pending} placeholder="Triage/Review" />
            </label>
            <label htmlFor="newLabelId">New destination
              <input id="newLabelId" name="newLabelId" value={form.newLabelId} onChange={(e) => updateForm("newLabelId", e.target.value)} autoComplete="off" required disabled={pending} placeholder="Triage/New" />
            </label>
            <label htmlFor="archiveLabelId">Archive destination
              <input id="archiveLabelId" name="archiveLabelId" value={form.archiveLabelId} onChange={(e) => updateForm("archiveLabelId", e.target.value)} autoComplete="off" required disabled={pending} placeholder="Triage/Archive" />
            </label>
          </div>
        </fieldset>

        <fieldset>
          <legend>Classification terms</legend>
          <p className="field-help">One term per line (commas also work). Matching is local, case-insensitive, and never sent to Gmail search.</p>
          <div className="config-grid terms-grid">
            <label htmlFor="priorityTerms">Priority terms
              <textarea id="priorityTerms" name="priorityTerms" rows={5} value={form.priorityTerms} onChange={(e) => updateForm("priorityTerms", e.target.value)} disabled={pending} placeholder={"urgent\ninvoice overdue"} />
            </label>
            <label htmlFor="reviewTerms">Review terms
              <textarea id="reviewTerms" name="reviewTerms" rows={5} value={form.reviewTerms} onChange={(e) => updateForm("reviewTerms", e.target.value)} disabled={pending} placeholder={"please review\nneeds decision"} />
            </label>
            <label htmlFor="newTerms">New terms
              <textarea id="newTerms" name="newTerms" rows={5} value={form.newTerms} onChange={(e) => updateForm("newTerms", e.target.value)} disabled={pending} placeholder={"new inquiry\nfirst contact"} />
            </label>
          </div>
        </fieldset>

        <fieldset>
          <legend>Category intent</legend>
          <p className="field-help">
            Prose describing what each category means. This is the standard of correctness for AI adjudication — not the term lists.
            Empty is allowed when saving; all four must be filled before an audit run. Max {MAX_CATEGORY_INTENT_CHARS} characters each.
          </p>
          <div className="config-grid intent-grid">
            <label htmlFor="priorityIntent">Priority intent
              <textarea id="priorityIntent" name="priorityIntent" rows={5} maxLength={MAX_CATEGORY_INTENT_CHARS} value={form.priorityIntent} onChange={(e) => updateForm("priorityIntent", e.target.value)} disabled={pending} placeholder="Mail that needs my attention today — unpaid invoices, client escalations, time-sensitive decisions." />
            </label>
            <label htmlFor="reviewIntent">Review intent
              <textarea id="reviewIntent" name="reviewIntent" rows={5} maxLength={MAX_CATEGORY_INTENT_CHARS} value={form.reviewIntent} onChange={(e) => updateForm("reviewIntent", e.target.value)} disabled={pending} placeholder="Mail that needs a decision but not urgently — proposals to weigh, drafts to approve." />
            </label>
            <label htmlFor="newIntent">New intent
              <textarea id="newIntent" name="newIntent" rows={5} maxLength={MAX_CATEGORY_INTENT_CHARS} value={form.newIntent} onChange={(e) => updateForm("newIntent", e.target.value)} disabled={pending} placeholder="First-contact or unfamiliar senders worth a look before filing elsewhere." />
            </label>
            <label htmlFor="archiveIntent">Archive intent
              <textarea id="archiveIntent" name="archiveIntent" rows={5} maxLength={MAX_CATEGORY_INTENT_CHARS} value={form.archiveIntent} onChange={(e) => updateForm("archiveIntent", e.target.value)} disabled={pending} placeholder="Newsletters, receipts, FYI noise, and anything I do not need to act on." />
            </label>
          </div>
        </fieldset>

        <fieldset>
          <legend>Sender whitelist</legend>
          <p className="field-help">Exact mailbox addresses that must never be moved automatically. One address per line. Whitelist wins over blocklist.</p>
          <label className="full-width" htmlFor="senderWhitelist">Protected senders
            <textarea id="senderWhitelist" name="senderWhitelist" rows={4} value={form.senderWhitelist} onChange={(e) => updateForm("senderWhitelist", e.target.value)} disabled={pending} placeholder={"owner@example.com\nfinance@example.com"} />
          </label>
        </fieldset>

        <fieldset>
          <legend>Sender blocklist</legend>
          <p className="field-help">Exact mailbox addresses moved to archive without term matching. One address per line.</p>
          <label className="full-width" htmlFor="senderBlocklist">Blocked senders
            <textarea id="senderBlocklist" name="senderBlocklist" rows={4} value={form.senderBlocklist} onChange={(e) => updateForm("senderBlocklist", e.target.value)} disabled={pending} placeholder={"spam@example.com\nnoreply@promo.example"} />
          </label>
        </fieldset>

        <fieldset>
          <legend>Audit auto-apply</legend>
          <p className="field-help">
            When enabled, the judge may promote misfiled mail in Gmail without confirmation.
            Demotions into archive always require your explicit confirmation. Leave off to keep audits in shadow.
          </p>
          <label className="full-width checkbox-row" htmlFor="autoApplyPromotions">
            <input
              id="autoApplyPromotions"
              name="autoApplyPromotions"
              type="checkbox"
              checked={form.autoApplyPromotions}
              onChange={(e) => updateForm("autoApplyPromotions", e.target.checked)}
              disabled={pending}
            />
            Auto-apply promotions
          </label>
        </fieldset>

        <fieldset>
          <legend>Sync bounds</legend>
          <p className="field-help">Hard caps per run. A run that hits a bound is successful but incomplete. Trial mode always uses 10 messages regardless of these values.</p>
          <div className="config-grid bounds-grid">
            <label htmlFor="maxPages">Max pages
              <input id="maxPages" name="maxPages" type="number" min={1} max={50} step={1} value={form.maxPages} onChange={(e) => updateForm("maxPages", e.target.value)} required disabled={pending} />
            </label>
            <label htmlFor="maxMessagesPerPage">Max messages per page
              <input id="maxMessagesPerPage" name="maxMessagesPerPage" type="number" min={1} max={500} step={1} value={form.maxMessagesPerPage} onChange={(e) => updateForm("maxMessagesPerPage", e.target.value)} required disabled={pending} />
            </label>
            <label htmlFor="maxTotalMessages">Max total messages
              <input id="maxTotalMessages" name="maxTotalMessages" type="number" min={1} max={5000} step={1} value={form.maxTotalMessages} onChange={(e) => updateForm("maxTotalMessages", e.target.value)} required disabled={pending} />
            </label>
          </div>
        </fieldset>

        <div className="config-actions">
          <button className="button" type="submit" disabled={pending}>
            {pending ? "Saving…" : version !== null ? "Save new config version" : "Save configuration"}
          </button>
        </div>
      </form>
    </section>
  </>;
}
