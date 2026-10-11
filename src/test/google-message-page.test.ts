import { describe, expect, test } from "bun:test";
import { GoogleGmailProvider } from "../server/gmail/google";

describe("Gmail message page estimates", () => {
  test("forwards a valid initial estimate and preserves the listing query", async () => {
    let requested: string | URL | Request | undefined;
    const provider = new GoogleGmailProvider("fixture-token", async (input) => {
      requested = input;
      return Response.json({ messages: [{ id: "m1", threadId: "t1" }], nextPageToken: "next", resultSizeEstimate: 123 });
    });
    expect(await provider.listMessages({ sourceLabelId: "INBOX", pageToken: "page", maxResults: 50 })).toEqual({ messages: [{ id: "m1", threadId: "t1" }], nextPageToken: "next", resultSizeEstimate: 123 });
    const url = new URL(String(requested));
    expect(url.searchParams.get("labelIds")).toBe("INBOX");
    expect(url.searchParams.get("pageToken")).toBe("page");
    expect(url.searchParams.get("maxResults")).toBe("50");
  });
  test.each([undefined, null, -1, 1.5, "10", 4_294_967_296, Number.MAX_SAFE_INTEGER])("ignores invalid optional estimate %s without fabricating a count", async (estimate) => {
    const provider = new GoogleGmailProvider("fixture-token", async () => Response.json({ resultSizeEstimate: estimate }));
    expect(await provider.listMessages({ sourceLabelId: "INBOX", maxResults: 50 })).toEqual({ messages: [] });
  });
  test.each([0, 4_294_967_295])("accepts uint32 boundary estimate %s", async (estimate) => {
    const provider = new GoogleGmailProvider("fixture-token", async () => Response.json({ resultSizeEstimate: estimate }));
    expect((await provider.listMessages({ sourceLabelId: "INBOX", maxResults: 50 })).resultSizeEstimate).toBe(estimate);
  });
});
