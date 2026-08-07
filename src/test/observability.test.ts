import { describe, expect, mock, test } from "bun:test";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";

mock.module("server-only", () => ({}));

const {
  getObservabilityConfig,
  createAuditTracer,
  AUDIT_RUN_SPAN,
  AUDIT_JUDGE_SPAN,
} = await import("../server/observability/tracer");

describe("getObservabilityConfig", () => {
  test("defaults to none when observability env is absent", () => {
    const config = getObservabilityConfig({});
    expect(config.exporter).toBe("none");
    expect(config.otlp).toBeUndefined();
  });

  test("selects otlp when Langfuse keys are present", () => {
    const config = getObservabilityConfig({
      LANGFUSE_PUBLIC_KEY: "pk-lf-test",
      LANGFUSE_SECRET_KEY: "sk-lf-test",
    });
    expect(config.exporter).toBe("otlp");
    expect(config.otlp?.url).toBe("https://cloud.langfuse.com/api/public/otel/v1/traces");
    expect(config.otlp?.headers.Authorization).toMatch(/^Basic /);
    expect(config.otlp?.headers["x-langfuse-ingestion-version"]).toBe("4");
  });

  test("honors LANGFUSE_BASE_URL for regional hosts", () => {
    const config = getObservabilityConfig({
      LANGFUSE_PUBLIC_KEY: "pk-lf-test",
      LANGFUSE_SECRET_KEY: "sk-lf-test",
      LANGFUSE_BASE_URL: "https://us.cloud.langfuse.com",
    });
    expect(config.otlp?.url).toBe("https://us.cloud.langfuse.com/api/public/otel/v1/traces");
  });

  test("selects otlp from generic OTEL endpoint (swappable exporter)", () => {
    const config = getObservabilityConfig({
      OTEL_EXPORTER_OTLP_ENDPOINT: "https://phoenix.example/v1/traces",
      OTEL_EXPORTER_OTLP_HEADERS: "Authorization=Bearer%20tok,x-custom=1",
    });
    expect(config.exporter).toBe("otlp");
    expect(config.otlp?.url).toBe("https://phoenix.example/v1/traces");
    expect(config.otlp?.headers).toEqual({
      Authorization: "Bearer tok",
      "x-custom": "1",
    });
  });

  test("explicit OTEL_EXPORTER=none disables even when keys present", () => {
    const config = getObservabilityConfig({
      OTEL_EXPORTER: "none",
      LANGFUSE_PUBLIC_KEY: "pk-lf-test",
      LANGFUSE_SECRET_KEY: "sk-lf-test",
    });
    expect(config.exporter).toBe("none");
  });
});

describe("createAuditTracer", () => {
  test("records manual audit.run and audit.judge spans without a live endpoint", async () => {
    const memory = new InMemorySpanExporter();
    const tracer = createAuditTracer({
      config: { exporter: "none", serviceName: "email-triager-test" },
      spanExporter: memory,
    });

    await tracer.withSpan(AUDIT_RUN_SPAN, { "audit.run_id": "run-1" }, async () => {
      await tracer.withSpan(AUDIT_JUDGE_SPAN, { "audit.message_id": "m1" }, async () => {
        return "ok";
      });
    });
    await tracer.forceFlush();

    const spans = memory.getFinishedSpans();
    expect(spans.map((span) => span.name).sort()).toEqual([AUDIT_JUDGE_SPAN, AUDIT_RUN_SPAN].sort());
    const run = spans.find((span) => span.name === AUDIT_RUN_SPAN)!;
    const judge = spans.find((span) => span.name === AUDIT_JUDGE_SPAN)!;
    expect(run.attributes["audit.run_id"]).toBe("run-1");
    expect(judge.attributes["audit.message_id"]).toBe("m1");
    expect(judge.parentSpanContext?.spanId).toBe(run.spanContext().spanId);

    await tracer.shutdown();
  });

  test("noop tracer still runs the callback when exporter is none", async () => {
    const tracer = createAuditTracer({
      config: { exporter: "none", serviceName: "email-triager-test" },
    });
    const value = await tracer.withSpan(AUDIT_RUN_SPAN, {}, async () => 42);
    expect(value).toBe(42);
    await tracer.shutdown();
  });

  test("marks span error status when the callback throws", async () => {
    const memory = new InMemorySpanExporter();
    const tracer = createAuditTracer({
      config: { exporter: "none", serviceName: "email-triager-test" },
      spanExporter: memory,
    });

    await expect(
      tracer.withSpan(AUDIT_RUN_SPAN, {}, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    await tracer.forceFlush();

    const [span] = memory.getFinishedSpans();
    expect(span?.status.code).toBe(2); // SpanStatusCode.ERROR
    expect(span?.attributes["error.code"]).toBe("Error");
    expect(JSON.stringify(span?.attributes)).not.toContain("boom");
    await tracer.shutdown();
  });
});

describe("audit span helpers", () => {
  test("withJudgeSpan emits audit.judge without requiring Langfuse", async () => {
    const {
      withJudgeSpan,
      withAuditRunSpan,
    } = await import("../server/observability/audit-spans");

    const names: string[] = [];
    const attrs: Array<Record<string, string | number | boolean>> = [];
    const tracer = {
      withSpan: async <T>(
        name: string,
        attributes: Record<string, string | number | boolean>,
        fn: (span: { setAttribute: (k: string, v: string | number | boolean) => void }) => Promise<T>,
      ) => {
        names.push(name);
        attrs.push(attributes);
        return fn({ setAttribute: () => undefined });
      },
      forceFlush: async () => undefined,
      shutdown: async () => undefined,
    };

    await withAuditRunSpan(tracer, { runId: "run-1", syncRunId: "sync-1" }, async (runSpan) => {
      runSpan.setAttribute("audit.status", "completed");
      await withJudgeSpan(tracer, { runId: "run-1", gmailMessageId: "msg-9" }, async () => ({
        agreesWithFiling: true,
        recommendedCategory: "archive" as const,
        rationale: "ok",
        malformed: false,
        model: "m",
        provider: "p",
        promptVersion: "pv",
      }));
    });

    expect(names).toEqual([AUDIT_RUN_SPAN, AUDIT_JUDGE_SPAN]);
    expect(attrs[0]).toEqual({
      "audit.run_id": "run-1",
      "audit.sync_run_id": "sync-1",
    });
    expect(attrs[1]).toEqual({
      "audit.run_id": "run-1",
      "audit.message_id": "msg-9",
    });
    expect(JSON.stringify(attrs)).not.toContain("secret body");
  });
});
