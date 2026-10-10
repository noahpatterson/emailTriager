export class GmailReauthorizationRequiredError extends Error {
  constructor() {
    super("Gmail authorization is no longer valid");
    this.name = "GmailReauthorizationRequiredError";
  }
}

export type GmailConnectionHealth<Provider> = Readonly<{
  connected: boolean;
  reconnectRequired: boolean;
  provider: Provider | null;
}>;

/** Checks a stored connection without mistaking a temporary provider outage for revoked access. */
export async function inspectGmailConnection<Provider>(
  hasStoredConnection: boolean,
  loadProvider: () => Promise<Provider>,
): Promise<GmailConnectionHealth<Provider>> {
  if (!hasStoredConnection) {
    return { connected: false, reconnectRequired: false, provider: null };
  }
  try {
    return {
      connected: true,
      reconnectRequired: false,
      provider: await loadProvider(),
    };
  } catch (error) {
    if (error instanceof GmailReauthorizationRequiredError) {
      return { connected: false, reconnectRequired: true, provider: null };
    }
    return { connected: true, reconnectRequired: false, provider: null };
  }
}
