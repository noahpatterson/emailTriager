# Access the dashboard from your iPhone through Tailscale

Use normal Neon owner authentication with a loopback app server and private Tailscale Serve. Keep the Mac and iPhone connected to the same tailnet. Tailnet access rules must allow the iPhone to reach the Mac on HTTPS port 443.

Use [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve), which shares the app inside your tailnet. Do not use Funnel, which publishes a service to the internet. The app still requires its configured owner login. It does not authenticate Tailscale identity headers.

## Configure owner authentication

1. Complete the [Neon and Google OAuth setup](../../README.md#configure-neon-postgres--auth) in the README.
2. Remove `INSECURE_LOCAL_DEV` and `ALLOW_INSECURE_LOCAL_DEV` from the app environment.
3. Remove `APP_PROFILE=local-compose`, `APP_PROFILE=demo`, or `APP_PROFILE=ci` if present. The `demo` and `ci` profiles use fixture Gmail.
4. Set `NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET`, and `OWNER_NEON_AUTH_USER_ID` for your owner account.
5. Keep `DATABASE_URL`, `DATABASE_DRIVER`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `TOKEN_ENCRYPTION_KEY_V1` configured.

Do not use the default local Compose app for this setup. Compose forces the local authentication bypass, which accepts only loopback requests. The bypass also rejects a tailnet OAuth callback.

## Start the loopback server and private proxy

1. Open Tailscale on both devices and confirm that both devices belong to your tailnet.
2. Build the app with its normal owner environment.

   ```sh
   bun run build
   ```

3. Start the app in a foreground terminal. This command temporarily prevents idle system sleep while the app runs.

   ```sh
   caffeinate -i bun run start --hostname 127.0.0.1 --port 3000
   ```

   Keep the Mac powered and awake with its lid open. `caffeinate` does not guarantee operation during lid-close sleep, shutdown, or network loss.

4. In another terminal, start the private HTTPS proxy.

   ```sh
   tailscale serve --https=443 http://127.0.0.1:3000
   ```

   Follow the Tailscale consent flow if HTTPS certificates are not enabled. Keep this foreground command open. Copy the HTTPS URL shown under "Available within your tailnet".

5. Add that exact HTTPS origin to Neon Auth's trusted domains.
6. Add `<tailnet-https-origin>/api/oauth/google/callback` to your Google OAuth client's authorized redirect URIs.
7. Set `GOOGLE_REDIRECT_URI` to that exact callback URL in the app environment.
8. Restart the app with the loopback command above.

The callback origin also controls the app's Google OAuth return redirects. Use the tailnet URL for this session, including Gmail connection setup.

If `ALLOWED_CIDRS` is set, inspect its compatibility with your proxy before proceeding. That optional app gate was designed for a Vercel deployment. Do not assume it reads the iPhone's Tailscale address behind Serve.

See the [Serve CLI reference](https://tailscale.com/docs/reference/tailscale-cli/serve) for current syntax and status commands.

## Check readiness without reading mail

Run the checker from the repository with the same environment used to start the app.

```sh
bun run scripts/check-tailnet-readiness.ts
```

The checker prints booleans only. It runs bounded, read-only Tailscale status commands and requests the local `/api/health` database ping. It exits nonzero if a prerequisite is missing.

The checker expects HTTPS port 443 to proxy `/` to `http://127.0.0.1:3000`, with Funnel disabled. The callback must use that Serve hostname. Its auth checks describe the checker's environment, not the running process. A successful result does not verify trusted domains, Google OAuth registration, loopback binding, access rules, or iPhone connectivity.

If the CLI reports "Failed to load preferences", open the Tailscale app and resolve its login or CLI integration before retrying. The checker suppresses raw CLI errors and device information.

## Validate the iPhone session on cellular

1. Turn off Wi-Fi on the iPhone and keep Tailscale connected.
2. Open the tailnet HTTPS URL in Safari.
3. Sign in as the configured Neon owner.
4. Connect Gmail from this URL if necessary.
5. Open **Contest mail** after completing [contest setup](contest-scans.md). Select **Run trial** and compare its proposed categories and scores with Gmail. A contest trial classifies up to 50 new messages without changing Gmail labels.
6. When the trial results are acceptable, select **Run scan** and keep the page open until the bounded run completes. Continue additional batches using the displayed cursor.
7. Open a message's Gmail link and verify that it opens the intended account and message.

**Run scan** posts a scan action to `POST /api/contest`. The original deterministic dashboard still uses `POST /api/sync`. Both require owner authentication and a same-origin browser request. Neither workflow needs a background scheduler for manual access.

## Stop the session

Press Ctrl+C in the Serve terminal, then press Ctrl+C in the app terminal. The foreground sleep assertion ends with the app command. These commands do not change persistent macOS power settings.

If you later use a persistent Serve configuration, disable only this listener with `tailscale serve --https=443 off`. Avoid `tailscale serve reset` when the Mac serves other applications.

Keep background scheduling and cloud deployment as separate work after the cellular trial succeeds.
