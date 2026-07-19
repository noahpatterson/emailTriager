"use client";

import { useState } from "react";

export function GmailLinkRootForm({
  initialValue,
}: {
  initialValue: string;
}) {
  const [value, setValue] = useState(initialValue);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function save(): Promise<void> {
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        redirect: "manual",
        body: JSON.stringify({ gmailMessageLinkRoot: value }),
      });
      const body = await response.json() as {
        gmailMessageLinkRoot?: string;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(body.error || "Gmail message link root could not be saved.");
      }
      if (body.gmailMessageLinkRoot) setValue(body.gmailMessageLinkRoot);
      setNotice("Gmail message link root saved.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Gmail message link root could not be saved.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="history config-panel" aria-label="Gmail message links">
      <div className="section-heading">
        <div>
          <p className="step">GMAIL LINKS</p>
          <h2>Message link root</h2>
        </div>
        <p>Which signed-in Google account index run results open in the browser.</p>
      </div>
      <div className="announcements" aria-live="polite" aria-atomic="true">
        {error && <div className="alert error" role="alert"><strong>Action needed</strong><span>{error}</span></div>}
        {notice && <div className="alert success" role="status"><strong>Update</strong><span>{notice}</span></div>}
      </div>
      <form
        className="config-form"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <fieldset>
          <legend>Browser account</legend>
          <p className="field-help">
            Use <code>/u/0/</code>, <code>/u/1/</code>, <code>/u/2/</code>, and so on for the account
            order in your browser. Example: <code>https://mail.google.com/mail/u/2/</code>
          </p>
          <label className="full-width" htmlFor="gmailMessageLinkRoot">
            Gmail message link root
            <input
              id="gmailMessageLinkRoot"
              name="gmailMessageLinkRoot"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              autoComplete="off"
              required
              disabled={pending}
              placeholder="https://mail.google.com/mail/u/0/"
            />
          </label>
          <div className="config-actions">
            <button className="button" type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save link root"}
            </button>
          </div>
        </fieldset>
      </form>
    </section>
  );
}
