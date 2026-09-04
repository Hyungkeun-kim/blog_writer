-- Migration 0003: Daily AI Usage Events per TECH-DESIGN.md v3.0 Section 11

CREATE TABLE IF NOT EXISTS ai_usage_events (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  utc_date TEXT NOT NULL, -- YYYY-MM-DD
  model_id TEXT NOT NULL,
  stage TEXT NOT NULL, -- 'vision' | 'writer' | 'quality'
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  neurons INTEGER NOT NULL DEFAULT 0,
  measurement TEXT NOT NULL DEFAULT 'actual', -- 'actual' | 'estimated'
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_owner_date ON ai_usage_events (owner_id, utc_date);
CREATE INDEX IF NOT EXISTS idx_ai_usage_job ON ai_usage_events (job_id);
