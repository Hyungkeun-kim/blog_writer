/**
 * Cloudflare Worker Environment Bindings
 */

export interface AiRunner {
  run(model: string, inputs: Record<string, unknown>): Promise<{ response?: string }>
}

export interface AssetsBinding {
  fetch(request: Request): Promise<Response>
}

export interface Env {
  AI: AiRunner
  DB: D1Database
  R2_BUCKET: R2Bucket
  BLOG_WRITER_WORKFLOW: Workflow
  ASSETS?: AssetsBinding
  ENVIRONMENT: string
  MAX_IMAGE_BYTES: number
  EXPIRATION_HOURS: number
  APP_ACCESS_TOKEN?: string
  CLOUDFLARE_API_TOKEN?: string
  INTERNAL_SERVICE_TOKEN?: string
  OWNER_EMAILS?: string
  OWNER_UIDS?: string
  ALLOWED_USER_EMAILS?: string
  ALLOWED_USER_UIDS?: string
  FIREBASE_PROJECT_ID?: string
}
