import "server-only";
import { context, SpanStatusCode, type Tracer } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  BasicTracerProvider,
  SimpleSpanProcessor,
  type SpanExporter,
} from "@opentelemetry/sdk-trace-base";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

let contextManagerReady = false;

function ensureContextManager(): void {
  if (contextManagerReady) return;
  context.setGlobalContextManager(new AsyncLocalStorageContextManager());
  contextManagerReady = true;
}

export const AUDIT_RUN_SPAN = "audit.run";
export const AUDIT_JUDGE_SPAN = "audit.judge";

export type ObservabilityExporterKind = "none" | "otlp";

export type OtlpExporterConfig = Readonly<{
  /** Full OTLP/HTTP traces URL (passed to the exporter as-is). */
  url: string;
  headers: Readonly<Record<string, string>>;
}>;

export type ObservabilityConfig = Readonly<{
  exporter: ObservabilityExporterKind;
  otlp?: OtlpExporterConfig;
  serviceName: string;
}>;

export type SpanAttributes = Readonly<Record<string, string | number | boolean>>;

export type SpanWriter = Readonly<{
  setAttribute: (key: string, value: string | number | boolean) => void;
}>;

export type AuditTracer = Readonly<{
  withSpan: <T>(
    name: string,
    attributes: SpanAttributes,
    fn: (span: SpanWriter) => Promise<T>,
  ) => Promise<T>;
  forceFlush: () => Promise<void>;
  shutdown: () => Promise<void>;
}>;

type EnvMap = Readonly<Record<string, string | undefined>>;

const DEFAULT_SERVICE_NAME = "email-triager";
const DEFAULT_LANGFUSE_HOST = "https://cloud.langfuse.com";

function trim(value: string | undefined): string | undefined {
  const next = value?.trim();
  return next || undefined;
}

function parseOtlpHeaders(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  const headers: Record<string, string> = {};
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = decodeURIComponent(trimmed.slice(eq + 1).trim());
    if (key) headers[key] = value;
  }
  return headers;
}

function langfuseBasicAuth(publicKey: string, secretKey: string): string {
  return `Basic ${Buffer.from(`${publicKey}:${secretKey}`, "utf8").toString("base64")}`;
}

function normalizeLangfuseOtlpUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  if (trimmed.endsWith("/api/public/otel/v1/traces")) return trimmed;
  if (trimmed.endsWith("/api/public/otel")) return `${trimmed}/v1/traces`;
  return `${trimmed}/api/public/otel/v1/traces`;
}

/**
 * Resolve exporter configuration. Absent env → none (ADR-0005: app works without vendor).
 * Langfuse keys or generic OTLP endpoint enable export; OTEL_EXPORTER=none forces off.
 * Phoenix/Braintrust later = same otlp path with a different endpoint (D-3).
 */
export function getObservabilityConfig(env: EnvMap = process.env): ObservabilityConfig {
  const serviceName = trim(env.OTEL_SERVICE_NAME) ?? DEFAULT_SERVICE_NAME;
  const exporterFlag = trim(env.OTEL_EXPORTER)?.toLowerCase();

  if (exporterFlag === "none") {
    return { exporter: "none", serviceName };
  }

  const langfusePublic = trim(env.LANGFUSE_PUBLIC_KEY);
  const langfuseSecret = trim(env.LANGFUSE_SECRET_KEY);
  if (langfusePublic && langfuseSecret) {
    const host = trim(env.LANGFUSE_BASE_URL) ?? DEFAULT_LANGFUSE_HOST;
    return {
      exporter: "otlp",
      serviceName,
      otlp: {
        url: normalizeLangfuseOtlpUrl(host),
        headers: {
          Authorization: langfuseBasicAuth(langfusePublic, langfuseSecret),
          "x-langfuse-ingestion-version": "4",
        },
      },
    };
  }

  const otlpEndpoint = trim(env.OTEL_EXPORTER_OTLP_ENDPOINT);
  if (otlpEndpoint) {
    return {
      exporter: "otlp",
      serviceName,
      otlp: {
        url: otlpEndpoint,
        headers: parseOtlpHeaders(trim(env.OTEL_EXPORTER_OTLP_HEADERS)),
      },
    };
  }

  return { exporter: "none", serviceName };
}

function createNoopTracer(): AuditTracer {
  const noopWriter: SpanWriter = { setAttribute: () => undefined };
  return {
    withSpan: async (_name, _attributes, fn) => fn(noopWriter),
    forceFlush: async () => undefined,
    shutdown: async () => undefined,
  };
}

function wrapProviderTracer(provider: BasicTracerProvider, tracer: Tracer): AuditTracer {
  return {
    withSpan: async (name, attributes, fn) =>
      tracer.startActiveSpan(name, async (span) => {
        for (const [key, value] of Object.entries(attributes)) {
          span.setAttribute(key, value);
        }
        const writer: SpanWriter = {
          setAttribute: (key, value) => {
            span.setAttribute(key, value);
          },
        };
        try {
          const result = await fn(writer);
          span.setStatus({ code: SpanStatusCode.OK });
          return result;
        } catch (caught) {
          span.setStatus({ code: SpanStatusCode.ERROR });
          // IDs/counters and error codes only — never free-form exception text (product-spec §13).
          const code =
            caught instanceof Error && "code" in caught && typeof caught.code === "string"
              ? caught.code
              : caught instanceof Error
                ? caught.name || "Error"
                : "unknown";
          span.setAttribute("error.code", code);
          throw caught;
        } finally {
          span.end();
        }
      }),
    forceFlush: async () => {
      await provider.forceFlush();
    },
    shutdown: async () => {
      await provider.shutdown();
    },
  };
}

export type CreateAuditTracerOptions = Readonly<{
  config?: ObservabilityConfig;
  /** Injected exporter for tests — never talks to a live endpoint. */
  spanExporter?: SpanExporter;
}>;

/**
 * Manual-span tracer only (ADR-0005 / R-4). No auto-instrumentation packages.
 * When exporter is none and no test exporter is injected, callbacks run without spans.
 */
export function createAuditTracer(options: CreateAuditTracerOptions = {}): AuditTracer {
  const config = options.config ?? getObservabilityConfig();
  const exporter = options.spanExporter
    ?? (config.exporter === "otlp" && config.otlp
      ? new OTLPTraceExporter({
          url: config.otlp.url,
          headers: { ...config.otlp.headers },
        })
      : null);

  if (!exporter) return createNoopTracer();

  ensureContextManager();
  const provider = new BasicTracerProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: config.serviceName,
    }),
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  return wrapProviderTracer(provider, provider.getTracer("email-triager.audit"));
}
