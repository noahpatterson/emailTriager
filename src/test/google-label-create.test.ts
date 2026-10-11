import { describe, expect, test } from "bun:test";
import { GoogleGmailProvider } from "../server/gmail/google";
import { DeterministicGmailFake } from "../server/gmail/fake";

describe("Gmail label creation", () => {
  test("posts the label name and visibility settings and returns the created label", async () => {
    let requested: string | URL | Request | undefined;
    let options: RequestInit | undefined;
    const provider = new GoogleGmailProvider("fixture-token", async (input, init) => {
      requested = input;
      options = init;
      return Response.json({ id: "Label_42", name: "contest-archive", type: "user" });
    });
    expect(await provider.createLabel("contest-archive")).toEqual({ id: "Label_42", name: "contest-archive" });
    expect(String(requested)).toBe("https://gmail.googleapis.com/gmail/v1/users/me/labels");
    expect(options?.method).toBe("POST");
    expect(new Headers(options?.headers).get("authorization")).toBe("Bearer fixture-token");
    expect(JSON.parse(String(options?.body))).toEqual({ name: "contest-archive", labelListVisibility: "labelShow", messageListVisibility: "show" });
  });

  test.each([null, {}, { id: "Label_42" }, { id: 42, name: "not-contest" }, { id: "", name: "not-contest" }, { id: " ", name: "not-contest" }, { id: "Label_42", name: "other" }])("rejects invalid created labels %j", async (body) => {
    const provider = new GoogleGmailProvider("fixture-token", async () => Response.json(body));
    await expect(provider.createLabel("not-contest")).rejects.toThrow("Gmail label creation returned an invalid label");
  });

  test("reports HTTP failures without exposing response contents", async () => {
    const provider = new GoogleGmailProvider("fixture-token", async () => new Response("private mailbox error", { status: 400 }));
    await expect(provider.createLabel("not-contest")).rejects.toThrow("Gmail label creation failed");
  });

  test("reports malformed JSON without exposing the response", async () => {
    const provider = new GoogleGmailProvider("fixture-token", async () => new Response("private mailbox contents"));
    await expect(provider.createLabel("not-contest")).rejects.toThrow("Gmail label creation failed");
  });

  test("reports network errors without exposing tokens or request details", async () => {
    const provider = new GoogleGmailProvider("fixture-token", async () => { throw new Error("fixture-token private request details"); });
    await expect(provider.createLabel("not-contest")).rejects.toThrow("Gmail label creation failed");
  });

  test("rejects empty names before sending a request", async () => {
    let called = false;
    const provider = new GoogleGmailProvider("fixture-token", async () => { called = true; return Response.json({}); });
    await expect(provider.createLabel(" ")).rejects.toThrow("Gmail label name must not be empty");
    expect(called).toBe(false);
  });

  test("the fake reuses labels and avoids existing label IDs", async () => {
    const provider = new DeterministicGmailFake({}, {}, [{ id: "Label_fake_1", name: "contest-archive" }]);
    expect(await provider.createLabel("contest-archive")).toEqual({ id: "Label_fake_1", name: "contest-archive" });
    expect(await provider.createLabel("not-contest")).toEqual({ id: "Label_fake_2", name: "not-contest" });
    expect(await provider.createLabel("not-contest")).toEqual({ id: "Label_fake_2", name: "not-contest" });
    expect(await provider.listLabels()).toHaveLength(2);
  });
});
