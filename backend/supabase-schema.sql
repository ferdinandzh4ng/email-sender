-- Run this in Supabase Dashboard: SQL Editor → New query → paste and Run
-- Creates tables for email-sender (users, oauth_states, scheduled_jobs, sent_log, templates)

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  encrypted_refresh_token TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
-- If you created users before this column existed, run: ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  success_redirect TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS scheduled_jobs (
  id UUID PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  send_at TIMESTAMPTZ NOT NULL,
  timezone TEXT NOT NULL,
  subject_template TEXT NOT NULL,
  body_template TEXT NOT NULL,
  csv_rows JSONB NOT NULL,
  attachment_storage_key TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sent_log (
  id SERIAL PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES scheduled_jobs(id),
  recipient_email TEXT NOT NULL,
  gmail_message_id TEXT,
  sent_at TIMESTAMPTZ,
  error TEXT
);

CREATE TABLE IF NOT EXISTS templates (
  id INT PRIMARY KEY DEFAULT 1,
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT single_template CHECK (id = 1)
);

CREATE INDEX IF NOT EXISTS idx_jobs_send_at ON scheduled_jobs(send_at);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON scheduled_jobs(status);
CREATE INDEX IF NOT EXISTS idx_sent_log_job ON sent_log(job_id);

-- Insert default template row so we can upsert
INSERT INTO templates (id, subject, body) VALUES (1, '', '')
ON CONFLICT (id) DO NOTHING;

-- Optional: migrate to multiple named templates (run after initial schema if you want template picker)
ALTER TABLE templates ADD COLUMN IF NOT EXISTS name TEXT DEFAULT 'Default';
UPDATE templates SET name = 'Default' WHERE name IS NULL;
ALTER TABLE templates DROP CONSTRAINT IF EXISTS single_template;
CREATE SEQUENCE IF NOT EXISTS templates_id_seq;
SELECT setval('templates_id_seq', (SELECT COALESCE(MAX(id), 1) FROM templates));
ALTER TABLE templates ALTER COLUMN id SET DEFAULT nextval('templates_id_seq');
-- Per-user templates (run for existing DBs): ALTER TABLE templates ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES users(id);
