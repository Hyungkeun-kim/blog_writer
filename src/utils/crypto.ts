/**
 * Crypto & Hash Utility functions
 */

export async function sha256(data: ArrayBuffer | string): Promise<string> {
  const buffer = typeof data === "string" ? new TextEncoder().encode(data) : data
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("")
}

export function generateId(prefix: string): string {
  const randomStr = crypto.randomUUID().replace(/-/g, "").slice(0, 12)
  const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, "")
  return `${prefix}_${timestamp}_${randomStr}`
}
