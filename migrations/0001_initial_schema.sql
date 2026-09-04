-- 0001_initial_schema.sql
-- Cloudflare D1 (SQLite) Schema for blog_writer (with On-Demand Style Learning)

-- 1. generation_jobs Table
CREATE TABLE IF NOT EXISTS generation_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('waiting', 'processing', 'reupload_required', 'completed', 'failed')),
  waiting_reason TEXT CHECK (waiting_reason IN ('upload', 'user_review') OR waiting_reason IS NULL),
  progress_stage TEXT,
  failure_code TEXT,
  cleanup_pending INTEGER DEFAULT 0,
  review_artifact_id TEXT,
  identifier_checks_passed INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  CONSTRAINT uk_jobs_user_idemp UNIQUE (user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_jobs_user ON generation_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON generation_jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_expires ON generation_jobs(expires_at);

-- 2. upload_slots Table
CREATE TABLE IF NOT EXISTS upload_slots (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES generation_jobs(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  slot_id INTEGER NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  checksum TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'verified',
  expires_at TEXT NOT NULL,
  CONSTRAINT uk_slots_job_slot UNIQUE (job_id, slot_id)
);

CREATE INDEX IF NOT EXISTS idx_slots_job ON upload_slots(job_id);
CREATE INDEX IF NOT EXISTS idx_slots_expires ON upload_slots(expires_at);

-- 3. temp_artifacts Table (Encrypted intermediary outputs)
CREATE TABLE IF NOT EXISTS temp_artifacts (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES generation_jobs(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_artifacts_job ON temp_artifacts(job_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_expires ON temp_artifacts(expires_at);

-- 4. posts Table (Final completed blog draft)
CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL UNIQUE REFERENCES generation_jobs(id),
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  tags TEXT,
  approved_for_learning INTEGER DEFAULT 1,
  visibility TEXT NOT NULL DEFAULT 'published' CHECK (visibility IN ('pending', 'published')),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_posts_user ON posts(user_id);

-- 5. user_style_profiles Table (On-Demand Learned Writing Style)
CREATE TABLE IF NOT EXISTS user_style_profiles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  tone_style TEXT NOT NULL,
  sample_snippets TEXT,
  learned_post_count INTEGER DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_styles_user ON user_style_profiles(user_id);
