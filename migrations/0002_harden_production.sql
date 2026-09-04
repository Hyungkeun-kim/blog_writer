-- 0002_harden_production.sql
-- Production Hardening Migration: user_settings, R2 markdown key, and AI neuron usage

-- 1. user_settings Table (Actual Persistent Settings Storage)
CREATE TABLE IF NOT EXISTS user_settings (
  user_id TEXT PRIMARY KEY,
  settings_json TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- 2. Add r2_markdown_key and summary to posts table (Separate Markdown storage in R2)
ALTER TABLE posts ADD COLUMN r2_markdown_key TEXT;
ALTER TABLE posts ADD COLUMN summary TEXT;

-- 3. Add ai_neurons_used to generation_jobs table (Track Workers AI consumption)
ALTER TABLE generation_jobs ADD COLUMN ai_neurons_used INTEGER DEFAULT 0;

-- 4. Add pii_warning_details to generation_jobs table (Support PII warning review workflow)
ALTER TABLE generation_jobs ADD COLUMN pii_warning_details TEXT;
