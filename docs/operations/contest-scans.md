# Run a contest scan

Contest scans are separate from the existing deterministic filing workflow. They use its source label, sender whitelist, and sender blocklist. Every eligible unprocessed message reaches Jev, even with no keyword match or empty keyword lists. Starred and invalid-sender mail stay protected; whitelist mail routes to not-contest and blocklisted mail routes to Irrelevant without Jev. The existing deterministic sync retains its keyword-based workflow.

## Configure the owner app

1. Apply production migrations with `bun run db:migrate` using your intended local development database or an isolated Neon branch. Migration `0018_contest_workflow` adds settings, run history, and contest results. This implementation run did not migrate your database.
2. If maintaining a separate public demo database, run `bun run db:migrate:demo` after production migrations there. The demo-only migration denies contest table access through RLS. Never apply demo-only migrations to the normal owner database.
3. Set `JEV_API_KEY` on the server. `JEV_MODEL` defaults to `jev-latest`. This is the native [TypeSafe Jev API](https://docs.typesafe.ai/api), separate from the existing OpenAI-compatible audit judge.
4. Configure Gmail and the source label and terms through the existing Configuration page.
5. Create three distinct user labels in Gmail, then open **Contest mail** from the dashboard. Save their names or IDs for Winner, New Contest, and Irrelevant. Entry Confirmation and Notification/Update always route to Irrelevant.
6. Start **Run trial** before a live scan. Inspect the results against the original emails, especially invitations and entry receipts.
7. Use **Run scan** to save classifications and apply contest labels. Use **Continue scan batch** until the scan reports completion.

Each request lists at most 50 new source-label messages and makes at most 50 new Jev requests. Live scans can also retry up to five saved results. Sender and subject sent to Jev are bounded to 500 characters each, and body text to 4,000 characters. Attachments are not sent.

A trial saves run metrics and its continuation cursor. It does not save message classifications, change Gmail labels, or deliver alerts. Its preview disappears after refreshing.

## Review and recover

Saved results sort by explicit-win probability. Claim-action probability and classification confidence are separate values. Scores are model estimates; fixture tests do not validate accuracy on your mailbox.

Corrections save an owner-selected category and apply its configured Gmail label. Later scans preserve that correction. Contest labeling adds the selected label and removes only other labels in that message's saved contest-label configuration. Mail filed as Irrelevant, including Entry Confirmation and Notification/Update, is archived and marked read by removing Gmail’s INBOX and UNREAD labels. Winner and New Contest mail are also archived, while preserving their read/unread status and remaining available under their configured Jev labels. Live filing also adds the fixed contest-archive label. Whitelisted senders move to not-contest and are marked read. Blocklisted messages move to the configured Irrelevant destination and are marked read without an AI request. Starred and invalid-sender mail remain protected. Saved classifications keep their category when reused, even though the run counts them as skipped. Failed model requests remain retryable and are never filed as Irrelevant. The contest-archive and not-contest labels are created if missing during a live scan; trials never create labels. Unrelated labels and custom source labels are preserved. Corrections apply the same filing policy. Correcting an archived message to Winner or New Contest does not restore Inbox or reset its read/unread status. The existing deterministic sync may separately move mail out of its source label, so decide which scan you want to run on each batch.

A classification saves before labeling. If labeling fails or the process stops, later scans retry from saved scores and saved label IDs without another Jev request. Interrupted and partially failed batches keep their input cursor so unrecorded messages are not skipped. A shared account lease prevents concurrent sync and contest mutations; after an interrupted process, allow up to five minutes for the lease to expire.

If Gmail authorization expires, reconnect from the dashboard. Failed model requests make no Gmail label change for that message. Error codes exclude raw provider replies, API keys, and email content.

Claim deadline extraction supports explicit claim/reply instructions with supported dates or durations. It preserves literal text, without inventing a date or timezone. Unsupported or conflicting deadlines remain unknown. Verify the original Gmail message before acting on any alert.

## Enable conservative alerts after validation

Alerts use the [ntfy publishing API](https://docs.ntfy.sh/publish/). Configure an authenticated topic whose access permissions you control. A bearer token authenticates publishing; it does not itself prove that the topic's read permissions are private. Confirm that only intended subscribers can read the topic.

Set the following server variables after testing your real contest mail:

```dotenv
NTFY_SERVER=https://your-ntfy-server.example
NTFY_TOPIC=your-private-topic
NTFY_ACCESS_TOKEN=your-publishing-token
CONTEST_WINNER_THRESHOLD=0.9
CONTEST_ACCURACY_VALIDATED=true
CONTEST_NOTIFICATIONS_ENABLED=true
```

Both opt-in flags and credentials are required. This version allows thresholds from 0.9 to 1.0. The effective category must be Winner, the explicit-win probability must meet the threshold, and Gmail labeling must have succeeded. Trials, protected mail, and owner corrections to other categories cannot alert.

Alerts contain sender, subject, win and claim-action probabilities, a supported claim deadline or an unknown-deadline warning, and the Gmail link. Account/message identity reserves delivery before publishing. Successful delivery becomes `sent`. Definite provider rejection becomes `failed` and can retry on a later scan. Network failure, timeout, or server ambiguity becomes `uncertain` and does not resend automatically. A crash after reservation likewise blocks another send. This avoids duplicate alerts but can miss one after an ambiguous failure. Check Gmail and the saved result's notification status.

## Inspect metrics and private access

The latest scan reports scanned, candidate, classified, skipped, and failed counts, token usage, timing, continuation, and sanitized error codes. Configure both `JEV_INPUT_USD_PER_MILLION_TOKENS` and `JEV_OUTPUT_USD_PER_MILLION_TOKENS` for a token-based dollar estimate using current vendor rates. Missing or invalid rates leave cost unknown. Estimates cover successful responses; failed requests may incur charges the application cannot measure. No raw body is persisted or logged; results retain sender, subject, scores, and bounded deadline metadata for owner review.

Use [the Tailscale guide](tailscale.md) to reach the app privately from an iPhone. The normal app's owner sign-in remains in place. Once connected over cellular, open **Contest mail**, run a trial, then validate a live scan and the configured labels. Enable notifications only after that accuracy check.

Background scheduling and cloud hosting remain deferred until manual remote scans work reliably.

## Follow scan progress

Migration `0019_contest_scan_progress` adds a nullable progress column. Apply it before deploying the progress UI and scan checkpoints. The running app can keep its previous behavior until that migration is approved and applied.

During a scan, the page polls saved progress every two seconds. It shows emails checked in this scan session against Gmail’s approximate source-mailbox total when progress tracking began, batches finished, and exact progress within the current batch. Checked emails include skipped and failed attempts; classifications and errors remain separate counts. A successful continuation carries the completed prior batches. Retrying a partial batch does not add its prior attempt to that baseline.

Live saved results update while the bounded request runs. Each batch replaces the entire visible result list. Live polling and refresh show only classified messages reviewed in the latest batch, including reused classifications. An empty batch clears the list. Earlier classifications remain saved for deduplication and recovery. Trial results arrive after each completed batch and replace the preview. Older runs without saved batch membership show no historical rows. Trials remain unsaved; refreshing clears their preview.

A running scan that has not reported progress for five minutes is shown as interrupted rather than permanently active. Its unfinished batch retains its safe retry cursor. Continuations must match the latest owner/account scan, mode, source label, and configuration. Existing pre-progress cursors can continue, with counts tracked from that continued batch onward.

Gmail describes resultSizeEstimate as an estimated total, not an exact count. Mail arrival and archive operations may change the mailbox. Completed scans are labeled finished even when the original estimate differs from the number checked.
