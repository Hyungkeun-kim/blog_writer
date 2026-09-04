/**
 * blog_writer API Client Module
 * Communicates with Cloudflare Workers Backend with Bearer Authentication
 */

export class BlogWriterApi {
  constructor(baseUrl = '') {
    this.baseUrl = baseUrl;
    this.tokenKey = 'blog_writer_auth_token';
  }

  getToken() {
    const saved = localStorage.getItem(this.tokenKey);
    // Purge legacy prohibited tokens
    if (saved === 'teacher1234' || (saved && saved.startsWith('teacher_sec_'))) {
      localStorage.removeItem(this.tokenKey);
    } else if (saved) {
      return saved;
    }

    // Default dev token fallback for all testing environments
    return 'test_token_teacher';
  }

  setToken(token) {
    if (token) {
      localStorage.setItem(this.tokenKey, token);
    } else {
      localStorage.removeItem(this.tokenKey);
    }
  }

  async _request(path, options = {}) {
    const token = this.getToken();
    const headers = {
      'Accept': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    };

    const res = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers,
    });

    if (res.status === 401) {
      window.dispatchEvent(new CustomEvent('auth:required'));
      throw new Error('개인 접속 인증이 필요합니다. 비밀번호 또는 인증키를 확인해주세요.');
    }

    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text || `HTTP ${res.status}` };
    }

    if (!res.ok) {
      throw new Error(data.message || data.error || `오류 발생 (상태 코드: ${res.status})`);
    }

    return data;
  }

  // Personal Authentication
  async login(pin) {
    const res = await fetch(`${this.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message || data.error || '인증에 실패했습니다.');
    }
    if (data.token) {
      this.setToken(data.token);
    }
    return data;
  }

  // Health check
  async getHealth() {
    return this._request('/api/health');
  }

  // 1. Create Job & Slots
  async createJob(slotCount = 6, idempotencyKey = '') {
    return this._request('/api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slotCount,
        idempotencyKey: idempotencyKey || `job_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      }),
    });
  }

  // 2. Upload Photo Binary to Slot
  async uploadPhotoSlot(jobId, slotId, arrayBuffer, contentType = 'image/webp') {
    const token = this.getToken();
    const headers = {
      'Content-Type': contentType,
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    };

    const res = await fetch(`${this.baseUrl}/api/jobs/${jobId}/photos/${slotId}`, {
      method: 'PUT',
      headers,
      body: arrayBuffer,
    });

    if (res.status === 401) {
      window.dispatchEvent(new CustomEvent('auth:required'));
      throw new Error('개인 접속 인증이 필요합니다.');
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `사진 업로드 실패 (HTTP ${res.status})`);
    }

    return data;
  }

  // 3. Start Pipeline Execution
  async startJob(jobId) {
    return this._request(`/api/jobs/${jobId}/start`, {
      method: 'POST',
    });
  }

  // 4. Poll Job Status
  async getJob(jobId) {
    return this._request(`/api/jobs/${jobId}`);
  }

  // 5. Get Generated Draft Result
  async getJobResult(jobId) {
    return this._request(`/api/jobs/${jobId}/result`);
  }

  // 5-1. PII Review Action
  async piiAction(jobId, action) {
    return this._request(`/api/jobs/${jobId}/pii-action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
  }

  // 5-2. AI Title & Tag Suggestions
  async suggestTitles(jobId, content = '') {
    return this._request(`/api/jobs/${jobId}/suggest-titles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
  }

  // 6. Finish & Purge
  async finishJob(jobId) {
    return this._request(`/api/jobs/${jobId}/finish`, {
      method: 'POST',
    });
  }

  // 7. Cancel & Purge
  async cancelJob(jobId) {
    return this._request(`/api/jobs/${jobId}/cancel`, {
      method: 'POST',
    });
  }

  // 8. Learn User Writing Style from Published Posts
  async learnStyle(limit = 5) {
    return this._request('/api/styles/learn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit }),
    });
  }

  // 8-1. Learn User Writing Style from Blog Post URL
  async learnStyleFromUrl(url) {
    return this._request('/api/styles/learn-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
  }

  // 9. Get User Style Profile
  async getStyleProfile() {
    return this._request('/api/styles/profile');
  }

  // 9-1. Delete User Style Profile
  async deleteStyleProfile() {
    return this._request('/api/styles/profile', {
      method: 'DELETE',
    });
  }

  // 10. List Completed Published Posts
  async getPosts() {
    return this._request('/api/posts');
  }

  // 10-1. Get Post Content (from R2 Markdown)
  async getPostContent(postId) {
    return this._request(`/api/posts/${postId}/content`);
  }

  // 10-2. Delete Published Post
  async deletePost(postId) {
    return this._request(`/api/posts/${postId}`, {
      method: 'DELETE',
    });
  }

  // 11. Environment Settings
  async getSettings() {
    return this._request('/api/settings');
  }

  async updateSettings(settings) {
    return this._request('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    });
  }
}

export const api = new BlogWriterApi();
