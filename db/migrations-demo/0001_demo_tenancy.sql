-- App role that cannot bypass RLS (Compose superuser / Neon owner would otherwise ignore FORCE RLS).
-- Password is set by scripts/migrate-demo.ts from DEMO_APP_DB_PASSWORD (local default: emailtriager).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'emailtriager_app') THEN
    CREATE ROLE emailtriager_app LOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$$;
GRANT USAGE ON SCHEMA public TO emailtriager_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO emailtriager_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO emailtriager_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO emailtriager_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO emailtriager_app;
-- Relax singleton owner binding so many demo visitors can coexist.
ALTER TABLE owner_binding DROP CONSTRAINT IF EXISTS owner_binding_pkey;
ALTER TABLE owner_binding DROP CONSTRAINT IF EXISTS owner_binding_singleton_check;
ALTER TABLE owner_binding ADD PRIMARY KEY (auth_user_id);
ALTER TABLE owner_binding DROP COLUMN IF EXISTS singleton;

-- Demo session: opaque cookie hash → synthetic owner.
CREATE TABLE IF NOT EXISTS demo_session (
  token_hash text PRIMARY KEY,
  owner_auth_user_id text NOT NULL REFERENCES owner_binding(auth_user_id),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS demo_session_owner_idx ON demo_session (owner_auth_user_id);
CREATE INDEX IF NOT EXISTS demo_session_expires_idx ON demo_session (expires_at);

-- RLS: policies key on app.current_owner (SET LOCAL inside a transaction).
-- FORCE so the table owner role cannot bypass.

ALTER TABLE owner_binding ENABLE ROW LEVEL SECURITY;
ALTER TABLE owner_binding FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS owner_binding_demo_isolation ON owner_binding;
CREATE POLICY owner_binding_demo_isolation ON owner_binding
  USING (auth_user_id = current_setting('app.current_owner', true))
  WITH CHECK (auth_user_id = current_setting('app.current_owner', true));

ALTER TABLE gmail_connection ENABLE ROW LEVEL SECURITY;
ALTER TABLE gmail_connection FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS gmail_connection_demo_isolation ON gmail_connection;
CREATE POLICY gmail_connection_demo_isolation ON gmail_connection
  USING (owner_auth_user_id = current_setting('app.current_owner', true))
  WITH CHECK (owner_auth_user_id = current_setting('app.current_owner', true));

ALTER TABLE triage_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE triage_config FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS triage_config_demo_isolation ON triage_config;
CREATE POLICY triage_config_demo_isolation ON triage_config
  USING (owner_auth_user_id = current_setting('app.current_owner', true))
  WITH CHECK (owner_auth_user_id = current_setting('app.current_owner', true));

ALTER TABLE sync_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_run FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sync_run_demo_isolation ON sync_run;
CREATE POLICY sync_run_demo_isolation ON sync_run
  USING (owner_auth_user_id = current_setting('app.current_owner', true))
  WITH CHECK (owner_auth_user_id = current_setting('app.current_owner', true));

ALTER TABLE sync_lease ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_lease FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sync_lease_demo_isolation ON sync_lease;
CREATE POLICY sync_lease_demo_isolation ON sync_lease
  USING (owner_auth_user_id = current_setting('app.current_owner', true))
  WITH CHECK (owner_auth_user_id = current_setting('app.current_owner', true));

ALTER TABLE oauth_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_state FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS oauth_state_demo_isolation ON oauth_state;
CREATE POLICY oauth_state_demo_isolation ON oauth_state
  USING (owner_auth_user_id = current_setting('app.current_owner', true))
  WITH CHECK (owner_auth_user_id = current_setting('app.current_owner', true));

ALTER TABLE message_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_snapshot FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS message_snapshot_demo_isolation ON message_snapshot;
CREATE POLICY message_snapshot_demo_isolation ON message_snapshot
  USING (owner_auth_user_id = current_setting('app.current_owner', true))
  WITH CHECK (owner_auth_user_id = current_setting('app.current_owner', true));

ALTER TABLE golden_set_message ENABLE ROW LEVEL SECURITY;
ALTER TABLE golden_set_message FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS golden_set_message_demo_isolation ON golden_set_message;
CREATE POLICY golden_set_message_demo_isolation ON golden_set_message
  USING (owner_auth_user_id = current_setting('app.current_owner', true))
  WITH CHECK (owner_auth_user_id = current_setting('app.current_owner', true));

ALTER TABLE eval_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE eval_run FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS eval_run_demo_isolation ON eval_run;
CREATE POLICY eval_run_demo_isolation ON eval_run
  USING (owner_auth_user_id = current_setting('app.current_owner', true))
  WITH CHECK (owner_auth_user_id = current_setting('app.current_owner', true));

ALTER TABLE audit_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_run FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_run_demo_isolation ON audit_run;
CREATE POLICY audit_run_demo_isolation ON audit_run
  USING (owner_auth_user_id = current_setting('app.current_owner', true))
  WITH CHECK (owner_auth_user_id = current_setting('app.current_owner', true));

ALTER TABLE pending_demotion ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_demotion FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pending_demotion_demo_isolation ON pending_demotion;
CREATE POLICY pending_demotion_demo_isolation ON pending_demotion
  USING (owner_auth_user_id = current_setting('app.current_owner', true))
  WITH CHECK (owner_auth_user_id = current_setting('app.current_owner', true));

-- demo_session is looked up by opaque token hash before the owner is known,
-- so it intentionally has no RLS. Owner-scoped tables below enforce isolation.

-- Child rows keyed by run / subject: isolate via owner-owned parents.
ALTER TABLE message_processing ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_processing FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS message_processing_demo_isolation ON message_processing;
CREATE POLICY message_processing_demo_isolation ON message_processing
  USING (
    EXISTS (
      SELECT 1 FROM sync_run sr
      WHERE sr.id = message_processing.run_id
        AND sr.owner_auth_user_id = current_setting('app.current_owner', true)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM sync_run sr
      WHERE sr.id = message_processing.run_id
        AND sr.owner_auth_user_id = current_setting('app.current_owner', true)
    )
  );

ALTER TABLE verdict ENABLE ROW LEVEL SECURITY;
ALTER TABLE verdict FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS verdict_demo_isolation ON verdict;
CREATE POLICY verdict_demo_isolation ON verdict
  USING (
    EXISTS (
      SELECT 1 FROM audit_run ar
      WHERE ar.id = verdict.audit_run_id
        AND ar.owner_auth_user_id = current_setting('app.current_owner', true)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM audit_run ar
      WHERE ar.id = verdict.audit_run_id
        AND ar.owner_auth_user_id = current_setting('app.current_owner', true)
    )
  );

ALTER TABLE gmail_message_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE gmail_message_state FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS gmail_message_state_demo_isolation ON gmail_message_state;
CREATE POLICY gmail_message_state_demo_isolation ON gmail_message_state
  USING (
    EXISTS (
      SELECT 1 FROM gmail_connection gc
      WHERE gc.google_subject = gmail_message_state.google_subject
        AND gc.owner_auth_user_id = current_setting('app.current_owner', true)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM gmail_connection gc
      WHERE gc.google_subject = gmail_message_state.google_subject
        AND gc.owner_auth_user_id = current_setting('app.current_owner', true)
    )
  );

-- Re-grant after demo_session exists (ALL TABLES above ran before CREATE).
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO emailtriager_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO emailtriager_app;
