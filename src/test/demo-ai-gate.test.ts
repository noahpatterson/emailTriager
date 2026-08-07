import { describe, expect, test } from "bun:test";
import { demoAiDisabledResponse, isDemoAiDisabled } from "@/src/server/demo/ai-gate";

describe("demo AI feature gate", () => {
  test("disables AI only for the demo profile", () => {
    expect(isDemoAiDisabled("demo")).toBe(true);
    expect(isDemoAiDisabled("ci")).toBe(false);
    expect(isDemoAiDisabled("local-compose")).toBe(false);
    expect(isDemoAiDisabled(undefined)).toBe(false);
  });

  test("returns a stable refusal payload for gated routes", () => {
    const response = demoAiDisabledResponse();
    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      error: "demo_ai_disabled",
      message:
        "Audit, review, demotion confirmation, and model eval are disabled in the public demo. They run only in the single-owner deployment with a real model configuration.",
    });
  });
});
