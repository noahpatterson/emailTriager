import { describe, expect, test } from "bun:test";
import {
  ALLOW_INSECURE_LOCAL_DEV_SENTINEL,
  assertInsecureLocalDevAllowed,
  assertInsecureLocalDevConfiguredOrigin,
  assertInsecureLocalDevRequest,
  LOCAL_DEV_PROFILE,
} from "../server/auth/local-dev-flags";

function withEnv(
  values: Readonly<{
    insecure?: string;
    allowInsecure?: string;
    nodeEnv?: string;
    appProfile?: string;
  }>,
  run: () => void,
): void {
  const previous = {
    insecure: process.env.INSECURE_LOCAL_DEV,
    allowInsecure: process.env.ALLOW_INSECURE_LOCAL_DEV,
    nodeEnv: process.env.NODE_ENV,
    appProfile: process.env.APP_PROFILE,
  };
  const env = process.env as Record<string, string | undefined>;
  const set = (name: string, value: string | undefined): void => {
    if (value === undefined) delete env[name];
    else env[name] = value;
  };
  set("INSECURE_LOCAL_DEV", values.insecure);
  set("ALLOW_INSECURE_LOCAL_DEV", values.allowInsecure);
  set("NODE_ENV", values.nodeEnv);
  set("APP_PROFILE", values.appProfile);
  try {
    run();
  } finally {
    set("INSECURE_LOCAL_DEV", previous.insecure);
    set("ALLOW_INSECURE_LOCAL_DEV", previous.allowInsecure);
    set("NODE_ENV", previous.nodeEnv);
    set("APP_PROFILE", previous.appProfile);
  }
}

const allowedEnvironment = {
  insecure: "true",
  allowInsecure: ALLOW_INSECURE_LOCAL_DEV_SENTINEL,
  nodeEnv: "development",
  appProfile: LOCAL_DEV_PROFILE,
} as const;

describe("insecure local mode guards", () => {
  test("allows the explicit local Compose profile with pg", () => {
    withEnv(allowedEnvironment, () => {
      expect(() => assertInsecureLocalDevAllowed("pg")).not.toThrow();
    });
  });

  test("refuses insecure local without the sentinel", () => {
    withEnv({ ...allowedEnvironment, allowInsecure: undefined }, () => {
      expect(() => assertInsecureLocalDevAllowed("pg")).toThrow(
        /requires ALLOW_INSECURE_LOCAL_DEV/,
      );
    });
  });

  test("refuses production profile even when insecure flags are set", () => {
    withEnv(
      {
        ...allowedEnvironment,
        nodeEnv: "production",
        appProfile: "production",
      },
      () => {
        expect(() => assertInsecureLocalDevAllowed("pg")).toThrow(
          /APP_PROFILE=local-compose/,
        );
      },
    );
  });

  test("refuses insecure local without the explicit profile", () => {
    withEnv({ ...allowedEnvironment, appProfile: undefined }, () => {
      expect(() => assertInsecureLocalDevAllowed("pg")).toThrow(
        /APP_PROFILE=local-compose/,
      );
    });
  });

  test("requires DATABASE_DRIVER=pg", () => {
    withEnv(allowedEnvironment, () => {
      expect(() => assertInsecureLocalDevAllowed("neon-http")).toThrow(
        /requires DATABASE_DRIVER=pg/,
      );
    });
  });

  test("is a no-op when insecure local is off", () => {
    withEnv({ insecure: undefined, nodeEnv: "production" }, () => {
      expect(() => assertInsecureLocalDevAllowed("neon-http")).not.toThrow();
    });
  });

  test("accepts only loopback configured origins", () => {
    expect(() =>
      assertInsecureLocalDevConfiguredOrigin(
        "http://localhost:3000/api/oauth/google/callback",
      ),
    ).not.toThrow();
    expect(() =>
      assertInsecureLocalDevConfiguredOrigin(
        "https://example.com/api/oauth/google/callback",
      ),
    ).toThrow(/loopback GOOGLE_REDIRECT_URI/);
  });

  test("accepts loopback host, forwarded host, and origin", () => {
    expect(() =>
      assertInsecureLocalDevRequest(
        new Headers({
          host: "localhost:3000",
          origin: "http://127.0.0.1:3000",
          "x-forwarded-host": "[::1]:3000",
        }),
      ),
    ).not.toThrow();
  });

  test("rejects non-loopback host and origin", () => {
    expect(() =>
      assertInsecureLocalDevRequest(new Headers({ host: "example.com" })),
    ).toThrow(/loopback Host/);
    expect(() =>
      assertInsecureLocalDevRequest(
        new Headers({
          host: "localhost:3000",
          origin: "https://example.com",
        }),
      ),
    ).toThrow(/loopback Origin/);
  });

  test("rejects a non-loopback forwarded host", () => {
    expect(() =>
      assertInsecureLocalDevRequest(
        new Headers({
          host: "localhost:3000",
          "x-forwarded-host": "attacker.example",
        }),
      ),
    ).toThrow(/X-Forwarded-Host/);
  });
});
