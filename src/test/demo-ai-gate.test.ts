import { describe, expect, test } from "bun:test";
import {
  demoAiDisabledResponse,
  isDemoAiDisabled,
  isDemoLiveModelDisabled,
} from "@/src/server/demo/ai-gate";

describe("demo live-model feature gate", () => {
  test("disables live model paths only for the demo profile", () => {
    expect(isDemoLiveModelDisabled("demo")).toBe(true);
    expect(isDemoLiveModelDisabled("ci")).toBe(false);
    expect(isDemoLiveModelDisabled("local-compose")).toBe(false);
    expect(isDemoAiDisabled("demo")).toBe(true);
    const previous = process.env.APP_PROFILE;
    delete process.env.APP_PROFILE;
    try {
      expect(isDemoLiveModelDisabled()).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.APP_PROFILE;
      else process.env.APP_PROFILE = previous;
    }
  });

  test("returns a stable refusal payload for gated routes", () => {
    const response = demoAiDisabledResponse();
    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      error: "demo_ai_disabled",
      message:
        "Starting a live audit and running model eval are disabled in the public demo. Review and demotion use seeded mock verdicts; live model runs stay in the single-owner deployment.",
    });
  });
});
