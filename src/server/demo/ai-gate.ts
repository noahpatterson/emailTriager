import { appProfile } from "@/src/server/gmail/app-profile";

export function isDemoProfile(profile: string | undefined = appProfile()): boolean {
  return profile === "demo";
}

/**
 * True when demo must refuse live model paths (audit start + eval).
 * Review / demotion queues stay available against seeded mock verdicts.
 */
export function isDemoLiveModelDisabled(profile: string | undefined = appProfile()): boolean {
  return isDemoProfile(profile);
}

/** @deprecated Use {@link isDemoLiveModelDisabled}. */
export const isDemoAiDisabled = isDemoLiveModelDisabled;

export type DemoAiDisabledBody = Readonly<{
  error: "demo_ai_disabled";
  message: string;
}>;

export const DEMO_AI_DISABLED_MESSAGE =
  "Starting a live audit and running model eval are disabled in the public demo. Review and demotion use seeded mock verdicts; live model runs stay in the single-owner deployment.";

export function demoAiDisabledBody(): DemoAiDisabledBody {
  return {
    error: "demo_ai_disabled",
    message: DEMO_AI_DISABLED_MESSAGE,
  };
}

export function demoAiDisabledResponse(): { status: 403; body: DemoAiDisabledBody } {
  return { status: 403, body: demoAiDisabledBody() };
}

export function demoAiDisabledHttpResponse(): Response {
  const { status, body } = demoAiDisabledResponse();
  return Response.json(body, { status });
}
