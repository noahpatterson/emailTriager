-- Durable per-IP rate-limit hits for serverless demo (shared Neon / multi-instance).
-- No RLS: keyed by IP bucket, not tenant owner.

CREATE TABLE IF NOT EXISTS demo_rate_limit_hit (
  id bigserial PRIMARY KEY,
  bucket text NOT NULL,
  ip_key text NOT NULL,
  hit_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS demo_rate_limit_hit_bucket_ip_time_idx
  ON demo_rate_limit_hit (bucket, ip_key, hit_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON demo_rate_limit_hit TO emailtriager_app;
GRANT USAGE, SELECT ON SEQUENCE demo_rate_limit_hit_id_seq TO emailtriager_app;
