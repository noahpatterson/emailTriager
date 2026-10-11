# Contest implementation checklist

This tracks the 31 requested tasks. Checked entries describe implemented behavior or an explicit deferral decision. Live Gmail accuracy, private device setup, and cellular end-to-end behavior remain unverified.

## AI email classification

1. [x] Review scanning and keywords in `sync.ts` and `classify.ts`.
2. [x] Updated requirement. Classify every eligible unprocessed message with Jev, without a keyword gate; retain sender and starred routing.
3. [x] Integrate native TypeSafe Jev in the opt-in contest scan.
4. [x] Define Winner, New Contest, Entry Confirmation, Notification/Update, and Irrelevant.
5. [x] Parse and store independent explicit-win probability.
6. [x] Parse and store independent prize-claim action probability.
7. [x] Persist results and display highest win probability first.
8. [ ] Evaluate real emails, particularly invitations and entry receipts. Fixture outputs prove workflow behavior, not model accuracy.

## Gmail labels and organization

9. [x] Configure Winner, New Contest, and Irrelevant labels through Contest mail. Entry confirmations and updates route to Irrelevant.
10. [x] Apply additive contest labels after saving scores. Preserve source, unrelated labels, and read state.
11. [x] Deduplicate by Google account subject and Gmail message ID, including retries.
12. [x] Save manual category corrections and preserve them on rescans.

## Remote access with Tailscale

13. [ ] Connect Mac and iPhone to the same tailnet. The installed Mac CLI reports failed readiness; native app inspection timed out.
14. [x] Confirm the existing Next.js HTTP interface.
15. [x] Add protected contest scan and correction endpoints. Existing owner and same-origin guards remain in place.
16. [ ] Configure private Tailscale Serve. The guide and read-only checker are implemented; no proxy was configured.
17. [x] Add responsive Run scan, trial, status, continuation, and contest result controls.
18. [ ] Verify an iPhone cellular scan with the owner's actual setup.
19. [ ] Verify Mac awake/app-running behavior. The guide uses temporary foreground `caffeinate`; no persistent sleep setting was changed.

## Winner notifications

20. [x] Default to 90% explicit-win probability, requiring effective Winner category. This version supports tightening to 100%.
21. [x] Implement authenticated ntfy delivery, configurable on the server.
22. [x] Alert on eligible applied results after explicit opt-in and accuracy validation.
23. [x] Include sender, subject, win probability, and Gmail link.
24. [x] Include claim-action probability and supported literal deadlines. Unsupported or conflicting deadlines remain unknown.
25. [x] Reserve account/message identity before delivery. Sent, reserved, and uncertain deliveries do not resend automatically.
26. [x] Default notifications off until real-email accuracy is validated.

## Testing and future improvements

27. [ ] Validate the real remote scan, Gmail retrieval, Jev classification, labels, and notification flow. Fixture-backed flow tests pass; this is not a live end-to-end result.
28. [x] Cover revoked Gmail authorization, Jev errors, interrupted cursor retry, lease loss, pending labels, and notification ambiguity.
29. [x] Persist bounded scan metrics, token usage, optional configured cost estimates, outcomes, and sanitized errors. Raw bodies and provider replies are not logged or stored.
30. [x] Defer scheduled macOS scans until manual remote scanning is verified.
31. [x] Defer cloud hosting until an always-on requirement is established.

## Configure and validate

Follow [the contest scan guide](operations/contest-scans.md), then [the private Tailscale guide](operations/tailscale.md). The database migration and credentials have not been applied to your live setup. Keep alerts off while reviewing actual emails.
