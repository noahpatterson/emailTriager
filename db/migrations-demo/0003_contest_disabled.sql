-- Contest scanning is unavailable in demo mode. No policies means default-deny
-- for the demo's NOBYPASSRLS role, even after its broad table grants.
ALTER TABLE contest_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE contest_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE contest_message ENABLE ROW LEVEL SECURITY;
ALTER TABLE contest_message FORCE ROW LEVEL SECURITY;
ALTER TABLE contest_scan_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE contest_scan_run FORCE ROW LEVEL SECURITY;
