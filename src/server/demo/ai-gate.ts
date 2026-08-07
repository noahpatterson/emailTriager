import { appProfile } from "@/src/server/gmail/app-profile";

export function isDemoProfile(profile: string | undefined = appProfile()): boolean {
  return profile === "demo";
}

/** True when demo profile must refuse audit/review/demotion/eval model paths. */
export function isDemoAiDisabled(profile: string | undefined = appProfile()): boolean {
  return isDemoProfile(profile);
}

export type DemoAiDisabledBody = Readonly<{
  error: "demo_ai_disabled";
  message: string;
}>;

export const DEMO_AI_DISABLED_MESSAGE =
  "Audit, review, demotion confirmation, and model eval are disabled in the public demo. They run only in the single-owner deployment with a real model configuration.";

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
