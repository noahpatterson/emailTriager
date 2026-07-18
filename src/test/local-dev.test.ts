import { describe, expect, test } from "bun:test";
import {
  ALLOW_INSECURE_LOCAL_DEV_SENTINEL,
  assertInsecureLocalDevAllowed,
} from "../server/auth/local-dev-flags";

function withEnv(
  values: Readonly<{
    insecure?: string;
    allowInsecure?: string;
    nodeEnv?: string;
  }>,
  run: () => void,
): void {
  const previous = {
    insecure: process.env.INSECURE_LOCAL_DEV,
    allowInsecure: process.env.ALLOW_INSECURE_LOCAL_DEV,
    nodeEnv: process.env.NODE_ENV,
  };
  const env = process.env as Record<string, string | undefined>;
  if (values.insecure === undefined) delete env.INSECURE_LOCAL_DEV;
  else env.INSECURE_LOCAL_DEV = values.insecure;
  if (values.allowInsecure === undefined) delete env.ALLOW_INSECURE_LOCAL_DEV;
  else env.ALLOW_INSECURE_LOCAL_DEV = values.allowInsecure;
  if (values.nodeEnv !== undefined) env.NODE_ENV = values.nodeEnv;
  try {
    run();
  } finally {
    if (previous.insecure === undefined) delete env.INSECURE_LOCAL_DEV;
    else env.INSECURE_LOCAL_DEV = previous.insecure;
    if (previous.allowInsecure === undefined) delete env.ALLOW_INSECURE_LOCAL_DEV;
    else env.ALLOW_INSECURE_LOCAL_DEV = previous.allowInsecure;
    env.NODE_ENV = previous.nodeEnv;
  }
}

describe("insecure local mode guards", () => {
  test("allows insecure local with pg outside production when sentinel is set", () => {
    withEnv(
      {
        insecure: "true",
        allowInsecure: ALLOW_INSECURE_LOCAL_DEV_SENTINEL,
        nodeEnv: "development",
      },
      () => {
        expect(() => assertInsecureLocalDevAllowed("pg")).not.toThrow();
      },
    );
  });

  test("refuses insecure local without ALLOW_INSECURE_LOCAL_DEV sentinel", () => {
    withEnv({ insecure: "true", nodeEnv: "development" }, () => {
      expect(() => assertInsecureLocalDevAllowed("pg")).toThrow(
        /requires ALLOW_INSECURE_LOCAL_DEV=I_UNDERSTAND/,
      );
    });
  });

  test("refuses insecure local when sentinel is wrong", () => {
    withEnv(
      { insecure: "true", allowInsecure: "yes", nodeEnv: "development" },
      () => {
        expect(() => assertInsecureLocalDevAllowed("pg")).toThrow(
          /requires ALLOW_INSECURE_LOCAL_DEV=I_UNDERSTAND/,
        );
      },
    );
  });

  test("allows insecure local even when NODE_ENV is production if sentinel is set", () => {
    withEnv(
      {
        insecure: "true",
        allowInsecure: ALLOW_INSECURE_LOCAL_DEV_SENTINEL,
        nodeEnv: "production",
      },
      () => {
        // Next standalone inlines NODE_ENV=production; sentinel + pg are the real gates.
        expect(() => assertInsecureLocalDevAllowed("pg")).not.toThrow();
      },
    );
  });

  test("requires DATABASE_DRIVER=pg when insecure local is on", () => {
    withEnv(
      {
        insecure: "true",
        allowInsecure: ALLOW_INSECURE_LOCAL_DEV_SENTINEL,
        nodeEnv: "development",
      },
      () => {
        expect(() => assertInsecureLocalDevAllowed("neon-http")).toThrow(
          /requires DATABASE_DRIVER=pg/,
        );
      },
    );
  });

  test("is a no-op when insecure local is off", () => {
    withEnv({ insecure: undefined, nodeEnv: "development" }, () => {
      expect(() => assertInsecureLocalDevAllowed("neon-http")).not.toThrow();
    });
  });
});
