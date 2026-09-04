export type JobStatus =
  | "waiting"
  | "processing"
  | "reupload_required"
  | "completed"
  | "failed"

export type WaitingReason = "upload" | "user_review" | null

export interface GenerationJob {
  id: string
  user_id: string
  idempotency_key: string
  status: JobStatus
  waiting_reason: WaitingReason
  progress_stage: string | null
  failure_code: string | null
  cleanup_pending: number
  review_artifact_id: string | null
  identifier_checks_passed: number
  ai_neurons_used?: number
  pii_warning_details?: string | null
  created_at: string
  updated_at: string
  expires_at: string
}

export interface UploadSlot {
  id: string
  job_id: string
  user_id: string
  slot_id: number
  object_key: string
  content_type: string
  size_bytes: number
  checksum: string
  status: string
  expires_at: string
}

export interface TempArtifact {
  id: string
  job_id: string
  user_id: string
  kind: "vision_raw" | "merged_observation" | "draft" | "quality_review"
  content: string
  content_hash: string
  created_at: string
  expires_at: string
}

export interface Post {
  id: string
  job_id: string
  user_id: string
  title: string
  content?: string
  r2_markdown_key?: string | null
  summary?: string | null
  tags: string | null
  approved_for_learning?: number
  visibility: "pending" | "published"
  created_at: string
}

export interface UserStyleProfile {
  id: string
  user_id: string
  tone_style: string
  sample_snippets: string | null
  learned_post_count: number
  updated_at: string
}

export interface UserSettings {
  user_id: string
  settings_json: string
  updated_at: string
}

export interface PiiDetectionResult {
  detected: boolean
  categories: string[]
  reasonCode: string | null
}
