/** Profiles that use fixture Gmail instead of live OAuth Google. */
export const FIXTURE_GMAIL_PROFILES = ["demo", "ci"] as const;
export type FixtureGmailProfile = (typeof FIXTURE_GMAIL_PROFILES)[number];

export function appProfile(): string | undefined {
  const value = process.env.APP_PROFILE?.trim();
  return value || undefined;
}

export function usesFixtureGmailProvider(profile: string | undefined = appProfile()): boolean {
  return (FIXTURE_GMAIL_PROFILES as readonly string[]).includes(profile ?? "");
}
