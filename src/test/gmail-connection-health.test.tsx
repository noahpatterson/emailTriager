import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Dashboard } from "../../app/dashboard";
import {
  GmailReauthorizationRequiredError,
  inspectGmailConnection,
} from "../server/gmail/connection-health";

describe("stale Gmail connections", () => {
  test("marks an invalid stored authorization as needing reconnection", async () => {
    const state = await inspectGmailConnection(true, async () => {
      throw new GmailReauthorizationRequiredError();
    });

    expect(state.connected).toBe(false);
    expect(state.reconnectRequired).toBe(true);
  });

  test("keeps the stored connection during a transient provider failure", async () => {
    const state = await inspectGmailConnection(true, async () => {
      throw new Error("temporary network failure");
    });

    expect(state.connected).toBe(true);
    expect(state.reconnectRequired).toBe(false);
  });

  test("renders a reconnect prompt instead of a connected state", () => {
    const html = renderToStaticMarkup(
      <Dashboard
        initialState={{
          connected: false,
          configured: true,
          gmailMessageLinkRoot: "https://mail.google.com/mail/u/0/",
          gmailLabelJumps: [],
          reconnectRequired: true,
          runs: [],
        }}
        user={{ name: "Owner", email: "owner@example.com" }}
      />,
    );

    expect(html).toContain("Reconnect your Gmail account");
    expect(html).toContain("Reconnect Gmail");
    expect(html).not.toContain("Your Gmail account is ready");
  });
});
