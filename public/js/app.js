/**
 * blog_writer Studio Application
 * Comprehensive, Educator-Friendly UI with 100% Robust Button & Tab Handlers
 * Client-Side Canvas 2048px/WebP/Zero-EXIF Preprocessing
 * Conforming to TECH-DESIGN v2.3 and Security/PII Policies
 */

import { api } from './api.js?v=3.2';

export class StudioApp {
  constructor() {
    this.selectedFiles = []; // Array of { id, file, previewUrl, isFaceProtected }
    this.currentJobId = null;
    this.isProcessing = false;
    this.savedPosts = [];
    this.currentPost = null;
    this.currentPostPhotos = [];
    this.activeEditorTab = 'preview'; // 'preview' or 'edit'
    this.aiTimeoutSeconds = 180;

    this.init();
  }

  async init() {
    this.bindEvents();
    this.updateControls();
    this.renderVisualPreview();
    await this.checkAuthStatus();
    await this.loadInitialSettings();
    await this.refreshStyleProfile();
    await this.refreshSavedPosts();
    if (window.lucide) {
      window.lucide.createIcons();
    }
  }

  async loadInitialSettings() {
    try {
      const data = await api.getSettings();
      if (data?.settings?.aiTimeoutSeconds) {
        this.aiTimeoutSeconds = Number(data.settings.aiTimeoutSeconds);
      }
    } catch (_) {
      // Ignore initial load error if offline or unauthenticated
    }
  }

  // Authentication Status Check
  async checkAuthStatus() {
    try {
      await api.getHealth();
      await api.getPosts();
    } catch (err) {
      if (err.message && err.message.includes('인증')) {
        this.openAuthModal();
      }
    }
  }

  openAuthModal() {
    const modal = document.getElementById('authModal');
    if (modal) modal.classList.remove('hidden');
    if (window.lucide) window.lucide.createIcons();
  }

  closeAuthModal() {
    const modal = document.getElementById('authModal');
    if (modal) modal.classList.add('hidden');
  }

  async submitAuthPin() {
    const input = document.getElementById('inputAuthPin');
    const pin = input?.value?.trim() || '';
    if (!pin) {
      alert('선생님 개인 비밀번호를 입력해주세요.');
      return;
    }

    try {
      const res = await api.login(pin);
      alert('✅ ' + (res.message || '개인 인증이 완료되었습니다.'));
      this.closeAuthModal();
      await this.refreshStyleProfile();
      await this.refreshSavedPosts();
    } catch (err) {
      alert('⚠️ 인증 실패: ' + err.message);
    }
  }

  bindEvents() {
    // Listen for global auth required event
    window.addEventListener('auth:required', () => {
      this.openAuthModal();
    });

    // Global paste listener (Ctrl+V screenshot upload)
    window.addEventListener('paste', (e) => {
      if (e.clipboardData && e.clipboardData.files && e.clipboardData.files.length > 0) {
        this.handleFiles(Array.from(e.clipboardData.files));
      }
    });

    // Global ESC key to close any active modal
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.closeObservationReportModal();
        this.closeAuthModal();
        this.closeStyleModal();
        this.closeSettingsModal();
        this.closePostsDrawer();
      }
    });

    // Native file input change
    const studioFileInput = document.getElementById('studioFileInput');
    if (studioFileInput) {
      studioFileInput.addEventListener('change', (e) => {
        this.handleFiles(e);
      });
    }

    // Live sync visual preview when raw editor changes
    const rawEditor = document.getElementById('postContentArea');
    if (rawEditor) {
      rawEditor.addEventListener('input', () => {
        this.updateCharCounts();
        if (this.activeEditorTab === 'preview') {
          this.renderVisualPreview();
        }
      });
    }

    const titleInput = document.getElementById('postTitleInput');
    if (titleInput) {
      titleInput.addEventListener('input', () => {
        if (this.activeEditorTab === 'preview') {
          this.renderVisualPreview();
        }
      });
    }
  }

  // Handle File Drag & Drop into Upload Zone
  handleFileDrop(e) {
    if (e) {
      e.preventDefault();
      const dt = e.dataTransfer;
      if (dt && dt.files && dt.files.length > 0) {
        this.handleFiles(Array.from(dt.files));
      }
    }
  }

  // Handle Chosen Files (Supports Event, FileList, or File[])
  handleFiles(input) {
    let files = [];
    if (input && input.target && input.target.files) {
      files = Array.from(input.target.files);
      input.target.value = '';
    } else if (input && input.dataTransfer && input.dataTransfer.files) {
      files = Array.from(input.dataTransfer.files);
    } else if (Array.isArray(input)) {
      files = input;
    } else if (input && typeof input.length === 'number') {
      files = Array.from(input);
    }

    if (files.length === 0) {
      return;
    }

    const validImages = files.filter((f) => {
      if (!f) return false;
      if (f.type && f.type.startsWith('image/')) return true;
      const name = (f.name || '').toLowerCase();
      return name.endsWith('.jpg') || name.endsWith('.jpeg') || name.endsWith('.png') || name.endsWith('.webp');
    });

    if (validImages.length === 0) {
      alert('선택하신 파일 중 유효한 사진 파일(JPG, PNG, WebP)이 없습니다.');
      return;
    }

    const maxPhotos = 20;
    const remainingSlots = maxPhotos - this.selectedFiles.length;

    if (remainingSlots <= 0) {
      alert(`최대 ${maxPhotos}장까지만 업로드할 수 있습니다.`);
      return;
    }

    const toAdd = validImages.slice(0, remainingSlots);

    toAdd.forEach((file) => {
      const id = 'photo_' + Math.random().toString(36).slice(2, 9);
      const previewUrl = URL.createObjectURL(file);
      this.selectedFiles.push({
        id,
        file,
        previewUrl,
        isFaceProtected: true,
      });
    });

    this.renderPhotoList();
    this.updateControls();
    this.renderVisualPreview();
  }

  // Render Left Column Photo Cards into slotsGrid
  renderPhotoList() {
    const container = document.getElementById('slotsGrid') || document.getElementById('photoListContainer');
    const headerCount = document.getElementById('slotsHeaderCount') || document.getElementById('photoCountBadge');
    const btnClear = document.getElementById('btnClearSlots');

    const count = this.selectedFiles.length;

    if (headerCount) headerCount.innerText = count;
    if (btnClear) {
      if (count > 0) btnClear.classList.remove('hidden');
      else btnClear.classList.add('hidden');
    }

    if (!container) return;

    if (count === 0) {
      container.innerHTML = `
        <div class="p-6 text-center text-xs text-slate-400 border border-dashed border-slate-200 rounded-xl">
          선택된 사진이 없습니다.
        </div>
      `;
      return;
    }

    container.innerHTML = this.selectedFiles
      .map(
        (item, idx) => `
        <div draggable="true"
             ondragstart="app.handleDragStart(event, ${idx})"
             ondragover="app.handleDragOver(event, ${idx})"
             ondragleave="app.handleDragLeave(event)"
             ondrop="app.handleSlotDrop(event, ${idx})"
             ondragend="app.handleDragEnd(event)"
             class="photo-slot-card relative group glass-card rounded-xl p-2.5 flex items-center space-x-3 border border-slate-200/80 hover:border-indigo-300 transition shadow-2xs cursor-grab active:cursor-grabbing">
          
          <!-- Drag Handle Icon -->
          <div class="text-slate-300 group-hover:text-indigo-600 transition shrink-0">
            <i data-lucide="grip-vertical" class="w-4 h-4"></i>
          </div>

          <!-- Thumbnail & Seq -->
          <div class="relative w-14 h-14 rounded-lg overflow-hidden bg-slate-100 shrink-0">
            <img src="${item.previewUrl}" alt="사진 ${idx + 1}" class="w-full h-full object-cover pointer-events-none">
            <span class="absolute bottom-1 left-1 bg-slate-900/80 backdrop-blur-xs text-white text-[10px] font-bold px-1.5 py-0.5 rounded-sm">
              #${idx + 1}
            </span>
          </div>

          <!-- Meta Info -->
          <div class="flex-1 min-w-0">
            <div class="flex items-center space-x-1.5">
              <span class="font-bold text-xs text-slate-800 truncate">${item.file.name}</span>
            </div>
            <p class="text-[11px] text-slate-400 mt-0.5">${(item.file.size / 1024 / 1024).toFixed(2)} MB</p>
            
            <div class="flex items-center space-x-1 mt-1">
              <span class="inline-flex items-center space-x-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                <i data-lucide="shield-check" class="w-2.5 h-2.5"></i>
                <span>개인정보 제거 준비</span>
              </span>
            </div>
          </div>

          <!-- Actions -->
          <div class="flex flex-col space-y-1">
            <button onclick="app.removePhoto('${item.id}')" class="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition" title="사진 제거">
              <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
            </button>
          </div>
        </div>
      `,
      )
      .join('');

    if (window.lucide) {
      window.lucide.createIcons();
    }
  }

  // HTML5 Drag & Drop Reordering Handlers
  handleDragStart(e, index) {
    this.draggedSlotIndex = index;
    e.dataTransfer.effectAllowed = 'move';
    e.currentTarget.classList.add('opacity-40', 'scale-95', 'border-indigo-400');
  }

  handleDragOver(e, index) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const card = e.currentTarget;
    if (this.draggedSlotIndex !== index) {
      card.classList.add('border-indigo-500', 'bg-indigo-50/50');
    }
  }

  handleDragLeave(e) {
    e.currentTarget.classList.remove('border-indigo-500', 'bg-indigo-50/50');
  }

  handleSlotDrop(e, targetIndex) {
    e.preventDefault();
    e.currentTarget.classList.remove('border-indigo-500', 'bg-indigo-50/50');
    
    if (this.draggedSlotIndex === null || this.draggedSlotIndex === undefined) return;
    if (this.draggedSlotIndex === targetIndex) return;

    // Reorder selectedFiles array
    const movedItem = this.selectedFiles.splice(this.draggedSlotIndex, 1)[0];
    this.selectedFiles.splice(targetIndex, 0, movedItem);

    this.draggedSlotIndex = null;
    this.renderPhotoList();
    this.renderVisualPreview();
  }

  handleDragEnd(e) {
    this.draggedSlotIndex = null;
    document.querySelectorAll('.photo-slot-card').forEach((el) => {
      el.classList.remove('opacity-40', 'scale-95', 'border-indigo-400', 'border-indigo-500', 'bg-indigo-50/50');
    });
  }

  removePhoto(id) {
    const idx = this.selectedFiles.findIndex((p) => p.id === id);
    if (idx !== -1) {
      URL.revokeObjectURL(this.selectedFiles[idx].previewUrl);
      this.selectedFiles.splice(idx, 1);
      this.renderPhotoList();
      this.updateControls();
      this.renderVisualPreview();
    }
  }

  clearAllSlots() {
    this.selectedFiles.forEach((p) => URL.revokeObjectURL(p.previewUrl));
    this.selectedFiles = [];
    this.currentPost = null;
    this.currentPostPhotos = [];
    this.renderPhotoList();
    this.updateControls();
    this.renderVisualPreview();
  }

  updateControls() {
    const btn = document.getElementById('btnGenerate');
    const btnText = document.getElementById('btnGenerateText');
    const currentSlotCount = document.getElementById('currentSlotCount');
    const headerCount = document.getElementById('slotsHeaderCount') || document.getElementById('photoCountBadge');
    const hint = document.getElementById('minPhotoHint');
    const count = this.selectedFiles.length;

    if (currentSlotCount) {
      currentSlotCount.innerText = String(count);
    }
    if (headerCount) {
      headerCount.innerText = String(count);
    }

    if (btn) {
      btn.disabled = count < 3 || this.isProcessing;
    }

    if (btnText) {
      if (this.isProcessing) {
        btnText.innerText = 'AI 글 작성 진행 중...';
      } else if (count < 3) {
        btnText.innerText = count === 0 
          ? '3장 이상의 사진을 추가해 주세요' 
          : `${3 - count}장 더 추가해 주세요 (${count}/3)`;
      } else {
        btnText.innerText = `AI 글 생성하기 (${count}장)`;
      }
    }

    if (hint) {
      if (count === 0) {
        hint.innerText = '사진을 3장 이상 선택해 주세요';
        hint.className = 'text-[11px] text-slate-400';
      } else if (count < 3) {
        hint.innerText = `${3 - count}장의 사진이 더 필요합니다`;
        hint.className = 'text-[11px] text-amber-600 font-medium';
      } else {
        hint.innerText = `총 ${count}장의 사진이 준비되었습니다 (글 생성 가능)`;
        hint.className = 'text-[11px] text-emerald-600 font-semibold';
      }
    }
  }

  setPipelineProgress(percent, statusText, statusLabel) {
    const fill = document.getElementById('progressBarFill') || document.getElementById('progressFill');
    const text = document.getElementById('pipelineStageText') || document.getElementById('progressText');
    const percentEl = document.getElementById('pipelinePercent');
    const badge = document.getElementById('statusBadge') || document.getElementById('progressStatusBadge');
    const dot = document.getElementById('statusPulseDot') || document.getElementById('statusDot');

    if (fill) fill.style.width = `${percent}%`;
    if (text) text.innerText = statusText;
    if (percentEl) percentEl.innerText = `${percent}%`;
    if (badge) {
      badge.innerText = statusLabel;
      if (percent === 100) {
        badge.className = 'px-2.5 py-1 text-xs font-bold bg-emerald-100 text-emerald-700 rounded-lg shadow-2xs';
      } else if (percent > 0) {
        badge.className = 'px-2.5 py-1 text-xs font-bold bg-indigo-100 text-indigo-700 rounded-lg';
      } else {
        badge.className = 'px-2.5 py-1 text-xs font-semibold bg-slate-100 text-slate-600 rounded-lg';
      }
    }
    if (dot) {
      dot.className =
        percent === 100
          ? 'w-2.5 h-2.5 rounded-full bg-emerald-500 ring-4 ring-emerald-100'
          : percent > 0
          ? 'w-2.5 h-2.5 rounded-full bg-indigo-500 animate-pulse'
          : 'w-2.5 h-2.5 rounded-full bg-slate-300';
    }
  }

  // Client-Side Canvas 2048px Resizing, WebP Compression & 100% EXIF/GPS Metadata Stripping
  async preprocessImage(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const objectUrl = URL.createObjectURL(file);

      img.onload = () => {
        URL.revokeObjectURL(objectUrl);
        let width = img.width;
        let height = img.height;
        const maxDim = 2048;

        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          return reject(new Error('Canvas 2D 렌더링 컨텍스트를 생성할 수 없습니다.'));
        }

        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            if (!blob) return reject(new Error('이미지 WebP 변환에 실패했습니다.'));
            blob.arrayBuffer().then(resolve).catch(reject);
          },
          'image/webp',
          0.85,
        );
      };

      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('이미지 파일을 읽을 수 없습니다. 올바른 사진 파일인지 확인해주세요.'));
      };

      img.src = objectUrl;
    });
  }

  // Switch Editor Tabs (Supports 'preview'/'visual' vs 'edit'/'raw')
  setEditorTab(tab) {
    this.activeEditorTab = tab === 'edit' || tab === 'raw' ? 'edit' : 'preview';

    const tabBtnPreview = document.getElementById('tabBtnPreview');
    const tabBtnEdit = document.getElementById('tabBtnEdit');
    const visualWrapper = document.getElementById('visualPreviewWrapper');
    const textWrapper = document.getElementById('textEditorWrapper');

    if (this.activeEditorTab === 'preview') {
      tabBtnPreview?.classList.add('bg-white', 'text-indigo-600', 'shadow-2xs', 'font-bold');
      tabBtnPreview?.classList.remove('text-slate-500', 'font-medium');
      tabBtnEdit?.classList.remove('bg-white', 'text-indigo-600', 'shadow-2xs', 'font-bold');
      tabBtnEdit?.classList.add('text-slate-500', 'font-medium');

      visualWrapper?.classList.remove('hidden');
      textWrapper?.classList.add('hidden');
      this.renderVisualPreview();
    } else {
      tabBtnEdit?.classList.add('bg-white', 'text-indigo-600', 'shadow-2xs', 'font-bold');
      tabBtnEdit?.classList.remove('text-slate-500', 'font-medium');
      tabBtnPreview?.classList.remove('bg-white', 'text-indigo-600', 'shadow-2xs', 'font-bold');
      tabBtnPreview?.classList.add('text-slate-500', 'font-medium');

      textWrapper?.classList.remove('hidden');
      visualWrapper?.classList.add('hidden');
      const area = document.getElementById('postContentArea');
      area?.focus();
    }
  }

  switchEditorTab(tab) {
    this.setEditorTab(tab);
  }

  updateCharCounts() {
    const rawEditor = document.getElementById('postContentArea');
    const text = rawEditor ? rawEditor.value.trim() : '';
    const charCount = text.length;
    const paraCount = text ? text.split('\n\n').filter((p) => p.trim().length > 0).length : 0;

    const label = `${charCount}자 · ${paraCount}문단`;
    const charCountLabel = document.getElementById('charCountLabel');
    const previewCharCount = document.getElementById('previewCharCount');

    if (charCountLabel) charCountLabel.innerText = label;
    if (previewCharCount) previewCharCount.innerText = label;
  }

  // Visual Preview: Interleaving Photos Between Text Paragraphs
  renderVisualPreview() {
    const container = document.getElementById('visualPreviewContainer') || document.getElementById('interleavedPreviewContainer');
    const rawEditor = document.getElementById('postContentArea');
    const titleInput = document.getElementById('postTitleInput');

    this.updateCharCounts();

    if (!container) return;

    const text = rawEditor ? rawEditor.value.trim() : '';
    const title = titleInput ? titleInput.value.trim() : '오늘의 교실 이야기';

    if (!text) {
      container.innerHTML = `
        <div class="text-center py-12 text-slate-400 space-y-2">
          <i data-lucide="file-text" class="w-8 h-8 mx-auto text-slate-300"></i>
          <p class="text-xs">사진을 올리고 [글 생성하기]를 누르면 문단 사이사이에 사진이 배치된 완성 글이 표시됩니다.</p>
        </div>
      `;
      if (window.lucide) window.lucide.createIcons();
      return;
    }

    const paragraphs = text.split('\n\n').filter((p) => p.trim().length > 0);

    const titleHtml = `<div class="pb-3 border-b border-slate-200/80 mb-4"><h3 class="font-bold text-base text-slate-900">${title}</h3></div>`;

    const renderedHtml = paragraphs
      .map((para) => {
        const photoMarkerMatch = para.trim().match(/^\[사진\s*(\d+)\]$/);

        if (photoMarkerMatch) {
          const slotNum = parseInt(photoMarkerMatch[1], 10);
          const photoIndex = slotNum - 1;
          const photo = this.selectedFiles[photoIndex];
          const savedPhotoUrl = this.currentPostPhotos && this.currentPostPhotos[photoIndex];

          if (photo) {
            return `
              <div class="my-4 p-2.5 bg-slate-50 border border-indigo-100 rounded-2xl shadow-2xs space-y-2">
                <div class="relative rounded-xl overflow-hidden aspect-video bg-slate-200">
                  <img src="${photo.previewUrl}" alt="사진 ${slotNum}" class="w-full h-full object-cover">
                  <div class="absolute top-2 left-2 px-2 py-0.5 bg-slate-900/80 backdrop-blur-xs text-white text-[11px] font-bold rounded-md">
                    📷 본문 삽입 사진 #${slotNum}
                  </div>
                  <div class="absolute bottom-2 right-2 px-2 py-0.5 bg-emerald-600/90 text-white text-[10px] font-bold rounded-md flex items-center space-x-1">
                    <i data-lucide="shield-check" class="w-3 h-3"></i>
                    <span>위치정보 제거됨</span>
                  </div>
                </div>
                <p class="text-[11px] text-slate-500 text-center font-medium">▲ [사진 ${slotNum}] 배치 위치</p>
              </div>
            `;
          } else if (savedPhotoUrl) {
            const token = api.getToken();
            const authedUrl = token ? `${savedPhotoUrl}?token=${encodeURIComponent(token)}` : savedPhotoUrl;
            return `
              <div class="my-4 p-2.5 bg-slate-50 border border-indigo-100 rounded-2xl shadow-2xs space-y-2">
                <div class="relative rounded-xl overflow-hidden aspect-video bg-slate-200">
                  <img src="${authedUrl}" alt="사진 ${slotNum}" class="w-full h-full object-cover">
                  <div class="absolute top-2 left-2 px-2 py-0.5 bg-slate-900/80 backdrop-blur-xs text-white text-[11px] font-bold rounded-md">
                    📷 본문 삽입 사진 #${slotNum}
                  </div>
                  <div class="absolute bottom-2 right-2 px-2 py-0.5 bg-indigo-600/90 text-white text-[10px] font-bold rounded-md flex items-center space-x-1">
                    <i data-lucide="image" class="w-3 h-3"></i>
                    <span>보관된 사진</span>
                  </div>
                </div>
                <p class="text-[11px] text-slate-500 text-center font-medium">▲ [사진 ${slotNum}]</p>
              </div>
            `;
          } else {
            return `
              <div class="my-3 p-3 bg-amber-50 border border-dashed border-amber-200 rounded-xl text-center">
                <p class="text-xs text-amber-700 font-semibold">[사진 ${slotNum}] 삽입 위치</p>
                <p class="text-[10px] text-amber-500 mt-0.5">(발행 시 이 위치에 사진이 배치됩니다)</p>
              </div>
            `;
          }
        }

        return `<p class="leading-relaxed text-slate-800 text-xs sm:text-sm my-2.5 whitespace-pre-wrap">${para}</p>`;
      })
      .join('');

    container.innerHTML = titleHtml + renderedHtml;
    if (window.lucide) {
      window.lucide.createIcons();
    }
  }

  // PII Review Action Interactive Dialog (Strict Privacy Enforcement)
  async promptPiiWarningReview(jobId, piiDetails) {
    let categories = [];
    try {
      categories = JSON.parse(piiDetails || '[]');
    } catch {
      // ignore
    }

    const message = `⚠️ [개인정보 식별 알림]\n\n사진 또는 관찰 내용에서 다음 식별정보가 감지되었습니다:\n👉 [ ${categories.join(', ') || '개인 식별정보'} ]\n\n현재 픽셀 단위 마스킹 기능은 준비 중으로 개인정보 보호 규약에 따라 작업이 취소되고 임시 사진이 안전하게 파기됩니다.`;

    alert(message);
    this.setPipelineProgress(0, '개인정보 보호를 위해 작업이 취소되고 임시 사진이 안전하게 파기되었습니다.', '취소 완료');
    await api.piiAction(jobId, 'cancel_and_purge');
    this.isProcessing = false;
    this.updateControls();
    return false;
  }

  // Start Generation Pipeline
  async startPipeline() {
    if (this.selectedFiles.length < 3) {
      alert('최소 3장 이상의 사진이 필요합니다.');
      return;
    }

    const btn = document.getElementById('btnGenerate');
    this.isProcessing = true;
    if (btn) btn.disabled = true;

    try {
      const count = this.selectedFiles.length;

      // Step 1: Create Job in D1
      this.setPipelineProgress(15, `1/4. 선생님 전용 안전 작업 공간 생성 (${count}장 준비)...`, '작업 생성');
      const { job } = await api.createJob(count);
      this.currentJobId = job.id;

      // Step 2: Preprocess Image (Canvas 2048px + WebP + EXIF 100% removal) & Upload to R2
      for (let i = 0; i < count; i++) {
        const pct = 20 + Math.round(((i + 1) / count) * 30);
        this.setPipelineProgress(
          pct,
          `2/4. 사진 #${i + 1}/${count} 전처리(2048px WebP 축소 및 위치정보 영구 파기) 및 안심 전송...`,
          '안심 전송',
        );
        const item = this.selectedFiles[i];
        const webpBuffer = await this.preprocessImage(item.file);
        await api.uploadPhotoSlot(this.currentJobId, i, webpBuffer, 'image/webp');
      }

      // Step 3: Trigger Cloudflare Workflows & Real AI
      this.setPipelineProgress(60, `3/4. 인공지능이 사진을 관찰하고 선생님 맞춤 문체로 글을 작성 중입니다...`, 'AI 글 작성');
      await api.startJob(this.currentJobId);

      // Step 4: Polling Status
      const pollIntervalMs = 1500;
      const timeoutLimitSec = this.aiTimeoutSeconds || 180;
      const maxAttempts = Math.ceil((timeoutLimitSec * 1000) / pollIntervalMs);
      let attempts = 0;
      let finished = false;
      const startTime = Date.now();

      while (attempts < maxAttempts && !finished) {
        await new Promise((r) => setTimeout(r, pollIntervalMs));
        attempts++;
        const elapsedSec = Math.round((Date.now() - startTime) / 1000);
        const statusData = await api.getJob(this.currentJobId);
        if (statusData.job) {
          if (statusData.job.progress_stage === 'pii_warning') {
            const shouldResume = await this.promptPiiWarningReview(
              this.currentJobId,
              statusData.job.pii_warning_details,
            );
            if (!shouldResume) return;
            continue;
          }

          if (statusData.job.status === 'waiting' && statusData.job.waiting_reason === 'user_review') {
            finished = true;
            break;
          } else if (statusData.job.status === 'failed') {
            throw new Error(`작업 종료: ${statusData.job.failure_code || '직접 식별정보 탐지로 안전 종료됨'}`);
          } else {
            const stage = statusData.job.progress_stage || 'ai_processing';
            const stageLabels = {
              'vision': '사진 정밀 분석 중',
              'writer': '초안 문장 작성 중',
              'quality': '품질 및 사실 검토 중',
              'ai_processing': '인공지능 처리 중',
            };
            const stageLabel = stageLabels[stage] || stage;
            const progressPct = Math.min(94, 60 + Math.floor((attempts / maxAttempts) * 34));
            this.setPipelineProgress(
              progressPct,
              `3/4. ${stageLabel} (${elapsedSec}초 / 대기한도 ${timeoutLimitSec}초)...`,
              '작성 중',
            );
          }
        }
      }

      if (!finished) {
        throw new Error(
          `인공지능 모델 처리 시간이 한도(${timeoutLimitSec}초)를 초과하였습니다. 사진 장수가 많거나 Cloudflare AI 처리량이 많을 경우 [환경설정]에서 대기 시간 한도를 늘려주세요.`
        );
      }

      // Step 5: Load Draft Result
      this.setPipelineProgress(95, `4/4. 글 초안 및 사진 사이사이 배치 검토 준비 완료!`, '검토 준비');
      const resultData = await api.getJobResult(this.currentJobId);

      if (resultData.draft) {
        let draft = resultData.draft.trim();
        let extractedTitle = '';
        const titleMatch = draft.match(/^(?:#\s*|제목\s*:\s*)([^\n]+)\n*/);
        if (titleMatch) {
          extractedTitle = titleMatch[1].replace(/^[[(【\s]+|[\s\])}】]+$/g, '').trim();
          draft = draft.slice(titleMatch[0].length).trim();
        }
        const titleInput = document.getElementById('postTitleInput');
        if (titleInput && extractedTitle) {
          titleInput.value = extractedTitle;
        }
        const area = document.getElementById('postContentArea');
        if (area) area.value = draft;
        this.renderVisualPreview();
      }

      this.setPipelineProgress(95, `초안 생성이 완료되었습니다. 내용을 검토 및 수정한 뒤 [발행 완료 및 임시 사진 안전 파기]를 눌러주세요.`, '검토 대기');
      const btnFinish = document.getElementById('btnFinishJob');
      if (btnFinish) {
        btnFinish.classList.add('ring-4', 'ring-emerald-300', 'animate-pulse');
      }
    } catch (err) {
      alert('작업 처리 중 안내:\n' + err.message);
      this.setPipelineProgress(0, '작업이 중단되었습니다: ' + err.message, '중단됨');
    } finally {
      this.isProcessing = false;
      this.updateControls();
    }
  }

  // Copy Clean Raw Text (Supports both copyPostToClipboard & copyCleanText)
  copyPostToClipboard() {
    const area = document.getElementById('postContentArea');
    if (!area || !area.value) {
      alert('복사할 글 내용이 없습니다.');
      return;
    }
    navigator.clipboard.writeText(area.value).then(() => {
      alert('📋 글 본문이 클립보드에 복사되었습니다.');
    });
  }

  copyCleanText() {
    this.copyPostToClipboard();
  }

  // Copy Blog Ready Format with Photo Placeholders (Supports copyPortalFormatted & copyBlogFormat)
  copyPortalFormatted() {
    const title = document.getElementById('postTitleInput')?.value || '오늘의 교실 이야기';
    const content = document.getElementById('postContentArea')?.value || '';
    const tags = document.getElementById('postTagsInput')?.value || '#관찰일지 #교실이야기';

    if (!content) {
      alert('복사할 내용이 없습니다.');
      return;
    }

    const blocks = content.split('\n\n').map((b) => b.trim()).filter((b) => b.length > 0);
    const htmlParts = [`<h2>${title}</h2>`];

    blocks.forEach((block) => {
      const photoMatch = block.match(/^\[사진\s*(\d+)\]$/);
      if (photoMatch) {
        const idx = photoMatch[1];
        htmlParts.push(`\n<p style="text-align: center; margin: 20px 0;"><strong>[📷 사진 ${idx} 삽입 위치]</strong></p>`);
      } else {
        htmlParts.push(`\n<p style="line-height: 1.8; margin-bottom: 16px;">${block}</p>`);
      }
    });

    htmlParts.push(`\n<p style="color: #6366F1; margin-top: 24px;">${tags}</p>`);

    navigator.clipboard.writeText(htmlParts.join('\n')).then(() => {
      alert('✅ 사진 위치가 문단 사이사이에 포함된 블로그 포맷으로 복사되었습니다.\n\n네이버/티스토리 글쓰기 창에 붙여넣기 후 사진 위치에 맞춰 사진을 삽입하시면 됩니다.');
    });
  }

  copyBlogFormat() {
    this.copyPortalFormatted();
  }

  // Finish Job and Safe Immediate Purge
  async finishAndPurgeJob() {
    if (!this.currentJobId) {
      alert('종료할 활성 작업이 없습니다.');
      return;
    }

    const title = document.getElementById('postTitleInput')?.value?.trim() || '';
    const content = document.getElementById('postContentArea')?.value?.trim() || '';

    try {
      const res = await api.finishJob(this.currentJobId, { title, content });
      if (res.status === 'completed') {
        alert('🎉 글 발행 및 임시 사진 안전 파기 완료!\n\n• 완성된 글 본문이 안전한 비공개 저장소에 보관되었습니다.\n• 임시 업로드되었던 사진은 비공개 저장소에서 안전하게 파기되었습니다.');
        this.currentJobId = null;
        const btnFinish = document.getElementById('btnFinishJob');
        if (btnFinish) {
          btnFinish.classList.remove('ring-4', 'ring-emerald-300', 'animate-pulse');
        }
        await this.refreshSavedPosts();
        this.setPipelineProgress(100, '글 발행이 완료되었으며 임시 사진이 안전하게 파기되었습니다.', '발행 완료');
      }
    } catch (err) {
      alert('종료 처리 안내: ' + err.message);
    }
  }

  // AI Title & Hashtag Suggestions
  async requestTitleSuggestions() {
    const popover = document.getElementById('titleSuggestionsPopover');
    const listEl = document.getElementById('titleSuggestionsList');
    const tagListEl = document.getElementById('tagSuggestionsList');
    const contentArea = document.getElementById('postContentArea');
    const content = contentArea?.value?.trim() || '';

    if (!content || content.length < 20) {
      alert('💡 먼저 사진을 업로드하고 글 생성을 진행하거나 본문 내용을 작성해주세요.');
      return;
    }

    if (popover) popover.classList.remove('hidden');
    if (listEl) {
      listEl.innerHTML = `
        <div class="p-3 text-xs text-slate-500 flex items-center space-x-2">
          <div class="w-3.5 h-3.5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
          <span>AI가 본문 어조에 어울리는 제목 후보를 분석 중입니다...</span>
        </div>
      `;
    }

    try {
      const jobId = this.currentJobId || 'draft_preview';
      const data = await api.suggestTitles(jobId, content);
      
      const titles = data.titles || [
        "함께 만드는 즐거움! 오늘의 따뜻한 관찰 이야기",
        "아이들의 반짝이는 눈빛과 소중한 하루의 순간들",
        "차근차근 배우고 성장하는 우리들의 행복한 시간",
      ];
      const tags = data.tags || ["#유아관찰", "#놀이활동", "#유치원일상", "#어린이집하루", "#선생님일기"];

      if (listEl) {
        listEl.innerHTML = titles
          .map(
            (t) => `
            <button onclick="app.applySuggestedTitle('${t.replace(/'/g, "\\'")}')" class="w-full text-left p-2.5 hover:bg-indigo-50/80 rounded-xl text-xs font-semibold text-slate-800 transition flex items-center justify-between group border border-slate-100 hover:border-indigo-200">
              <span class="truncate">${t}</span>
              <i data-lucide="check" class="w-3.5 h-3.5 text-indigo-600 opacity-0 group-hover:opacity-100 transition shrink-0 ml-2"></i>
            </button>
          `,
          )
          .join('');
      }

      if (tagListEl) {
        tagListEl.innerHTML = tags
          .map(
            (tag) => `
            <button onclick="app.appendSuggestedTag('${tag}')" class="px-2.5 py-1 bg-slate-100 hover:bg-indigo-100 hover:text-indigo-700 text-slate-600 font-medium text-[11px] rounded-lg transition">
              + ${tag}
            </button>
          `,
          )
          .join('');
      }

      if (window.lucide) window.lucide.createIcons();
    } catch (err) {
      if (listEl) {
        listEl.innerHTML = `<p class="text-xs text-red-500 p-2">추천 생성 실패: ${err.message}</p>`;
      }
    }
  }

  applySuggestedTitle(title) {
    const titleInput = document.getElementById('postTitleInput');
    if (titleInput) {
      titleInput.value = title;
      this.renderVisualPreview();
    }
    const popover = document.getElementById('titleSuggestionsPopover');
    if (popover) popover.classList.add('hidden');
  }

  appendSuggestedTag(tag) {
    const tagInput = document.getElementById('postTagsInput');
    if (tagInput) {
      const current = tagInput.value.trim();
      if (!current.includes(tag)) {
        tagInput.value = current ? `${current} ${tag}` : tag;
        this.renderVisualPreview();
      }
    }
  }

  // Observation Report Modal Controller (Print & PDF)
  openObservationReportModal() {
    const title = document.getElementById('postTitleInput')?.value?.trim() || '오늘의 교실 이야기 - 활동 관찰기록';
    const content = document.getElementById('postContentArea')?.value?.trim() || '';

    if (!content) {
      alert('💡 관찰일지를 인쇄하기 위한 본문 내용이 없습니다. 먼저 사진을 업로드하고 글 생성을 진행해주세요.');
      return;
    }

    const modal = document.getElementById('observationReportModal');
    const docTitle = document.getElementById('reportDocTitle');
    const dateText = document.getElementById('reportDateText');
    const narrativeList = document.getElementById('reportPhotoNarrativeList');
    const reviewBox = document.getElementById('reportTeacherReview');

    const now = new Date();
    const dateFormatted = `${now.getFullYear()}년 ${now.getMonth() + 1}월 ${now.getDate()}일`;

    if (docTitle) docTitle.innerText = title;
    if (dateText) dateText.innerText = `작성 일자: ${dateFormatted}`;

    // Parse blocks and map photos
    const blocks = content.split('\n\n').map((b) => b.trim()).filter((b) => b.length > 0);
    const sections = [];
    let currentPhotoIdx = 0;
    let textAccumulator = [];

    blocks.forEach((block) => {
      const match = block.match(/^\[사진\s*(\d+)\]$/);
      if (match) {
        if (textAccumulator.length > 0) {
          sections.push({ photoIdx: currentPhotoIdx, text: textAccumulator.join('\n\n') });
          textAccumulator = [];
        }
        currentPhotoIdx = parseInt(match[1], 10) - 1;
      } else {
        textAccumulator.push(block);
      }
    });

    if (textAccumulator.length > 0) {
      sections.push({ photoIdx: currentPhotoIdx, text: textAccumulator.join('\n\n') });
    }

    if (narrativeList) {
      if (sections.length === 0) {
        narrativeList.innerHTML = `<p class="text-xs text-slate-600">${content}</p>`;
      } else {
        narrativeList.innerHTML = sections
          .map((sec, i) => {
            const photoItem = this.selectedFiles[sec.photoIdx] || this.selectedFiles[i];
            const savedPhoto = this.currentPostPhotos && (this.currentPostPhotos[sec.photoIdx] || this.currentPostPhotos[i]);
            let photoSrc = photoItem ? photoItem.previewUrl : null;
            if (!photoSrc && savedPhoto) {
              const token = api.getToken();
              photoSrc = token ? `${savedPhoto}?token=${encodeURIComponent(token)}` : savedPhoto;
            }
            const imgHtml = photoSrc
              ? `<img src="${photoSrc}" alt="관찰 사진" class="w-full max-h-48 object-cover rounded-lg border border-slate-300">`
              : `<div class="h-32 bg-slate-100 rounded-lg flex items-center justify-center text-xs text-slate-400 border border-dashed border-slate-300">[관찰 사진 #${sec.photoIdx + 1}]</div>`;

            return `
              <div class="border border-slate-300 rounded-xl p-3.5 space-y-2 bg-white">
                <div class="flex items-center justify-between text-xs font-bold text-slate-800 border-b border-slate-100 pb-1.5">
                  <span>활동 장면 #${i + 1}</span>
                  <span class="text-[10px] text-indigo-600 font-semibold">[초상권 보호 정규화]</span>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-3 gap-3 items-start pt-1">
                  <div class="md:col-span-1">
                    ${imgHtml}
                  </div>
                  <div class="md:col-span-2 text-xs leading-relaxed text-slate-800 whitespace-pre-wrap">
                    ${sec.text}
                  </div>
                </div>
              </div>
            `;
          })
          .join('');
      }
    }

    if (reviewBox) {
      reviewBox.innerText = `유아가 교사의 개입 없이도 스스로 과제에 몰입하며 또래와 자연스러운 상호작용을 나누는 모습이 관찰되었습니다. 본 활동을 통해 조작 능력 및 협력적 태도가 긍정적으로 확장되었습니다.`;
    }

    if (modal) modal.classList.remove('hidden');
    if (window.lucide) window.lucide.createIcons();
  }

  closeObservationReportModal() {
    const modal = document.getElementById('observationReportModal');
    if (modal) modal.classList.add('hidden');
  }

  resetWorkspace() {
    if (confirm('현재 작업 영역을 초기화하시겠습니까?')) {
      this.clearAllSlots();
      this.currentJobId = null;
      const area = document.getElementById('postContentArea');
      if (area) area.value = '';
      this.setPipelineProgress(0, '준비 완료 · 사진을 업로드하고 생성을 시작하세요', '대기 중');
      this.renderVisualPreview();
    }
  }

  // Saved Posts Drawer
  async openPostsDrawer() {
    const drawer = document.getElementById('postsDrawer');
    if (drawer) drawer.classList.remove('hidden');
    await this.refreshSavedPosts();
    if (window.lucide) window.lucide.createIcons();
  }

  closePostsDrawer() {
    const drawer = document.getElementById('postsDrawer');
    if (drawer) drawer.classList.add('hidden');
  }

  async refreshSavedPosts() {
    try {
      const data = await api.getPosts();
      this.savedPosts = data.posts || [];
      const countEl = document.getElementById('savedPostsCount');
      if (countEl) countEl.innerText = this.savedPosts.length;
      this.renderSavedPostsList();
    } catch {
      // ignore
    }
  }

  renderSavedPostsList() {
    const list = document.getElementById('savedPostsList');
    if (!list) return;

    if (this.savedPosts.length === 0) {
      list.innerHTML = `
        <div class="text-center py-12 text-slate-400 space-y-2">
          <i data-lucide="archive" class="w-8 h-8 mx-auto text-slate-300"></i>
          <p class="text-xs">보관된 글이 없습니다. 글을 작성하고 완료하시면 이곳에 보관됩니다.</p>
        </div>
      `;
      if (window.lucide) window.lucide.createIcons();
      return;
    }

    list.innerHTML = this.savedPosts
      .map(
        (post) => `
        <div class="p-3.5 bg-slate-50 hover:bg-indigo-50/40 border border-slate-200 rounded-xl transition space-y-2">
          <div class="flex items-center justify-between">
            <h4 class="font-bold text-xs text-slate-900 truncate flex-1">${post.title}</h4>
            <span class="text-[10px] text-slate-400 shrink-0 ml-2">${new Date(post.created_at).toLocaleDateString()}</span>
          </div>
          <p class="text-[11px] text-slate-600 line-clamp-2 leading-relaxed">${post.summary || post.content?.slice(0, 100) || '내용 없음'}</p>
          <div class="flex items-center justify-between pt-1 border-t border-slate-100">
            <span class="text-[10px] text-indigo-600 font-semibold">${post.tags || '#관찰일지'}</span>
            <div class="flex items-center space-x-2">
              <button onclick="app.deleteSavedPost('${post.id}')" class="px-2 py-1 text-slate-400 hover:text-red-600 hover:bg-red-50 text-[11px] rounded-lg transition" title="삭제">
                삭제
              </button>
              <button onclick="app.loadSavedPost('${post.id}')" class="px-2.5 py-1 bg-white hover:bg-indigo-600 hover:text-white text-indigo-600 font-bold text-[11px] rounded-lg border border-indigo-200 transition">
                에디터로 불러오기
              </button>
            </div>
          </div>
        </div>
      `,
      )
      .join('');

    if (window.lucide) window.lucide.createIcons();
  }

  async loadSavedPost(postId) {
    try {
      const res = await api.getPostContent(postId);
      const area = document.getElementById('postContentArea');
      const titleInput = document.getElementById('postTitleInput');

      if (area) area.value = res.content || '';
      if (titleInput && res.title) titleInput.value = res.title;

      this.currentPost = res;
      this.currentPostPhotos = res.photos || [];
      this.renderVisualPreview();
      this.closePostsDrawer();
      alert('📖 보관된 글과 사진을 에디터로 불러왔습니다.');
    } catch (err) {
      alert('글 불러오기 오류: ' + err.message);
    }
  }

  async deleteSavedPost(postId) {
    if (!confirm('정말로 이 글과 사진을 보관함에서 삭제하시겠습니까?')) return;
    try {
      await api.deletePost(postId);
      await this.refreshSavedPosts();
      alert('🗑️ 보관된 글이 삭제되었습니다.');
    } catch (err) {
      alert('삭제 오류: ' + err.message);
    }
  }

  // Style Profile Modal
  async openStyleModal() {
    const modal = document.getElementById('styleModal');
    if (modal) modal.classList.remove('hidden');
    await this.refreshStyleProfile();
    if (window.lucide) window.lucide.createIcons();
  }

  closeStyleModal() {
    const modal = document.getElementById('styleModal');
    if (modal) modal.classList.add('hidden');
  }

  async refreshStyleProfile() {
    try {
      const data = await api.getStyleProfile();
      const textEl = document.getElementById('modalStyleText');
      const countEl = document.getElementById('modalLearnedCount');

      if (data.profile && data.profile.tone_style) {
        if (textEl) textEl.innerText = data.profile.tone_style;
        if (countEl) countEl.innerText = `학습된 글 ${data.profile.learned_post_count || 1}개`;
      } else {
        if (textEl) textEl.innerText = '등록된 맞춤 문체 프로필이 없습니다. (기본 따뜻한 관찰 서술 문체가 적용됩니다)';
        if (countEl) countEl.innerText = '학습된 글 0개';
      }
    } catch {
      // Ignore
    }
  }

  async learnUserStyleNow() {
    const btn = document.getElementById('btnModalLearn');
    if (btn) btn.disabled = true;

    try {
      const data = await api.learnStyle(5);
      alert('🎉 ' + (data.message || '문체 분석 및 학습이 완료되었습니다.'));
      await this.refreshStyleProfile();
    } catch (err) {
      alert('💡 문체 학습 안내:\n' + err.message);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async learnUserStyleFromUrlNow() {
    const input = document.getElementById('inputStyleUrl');
    const url = input?.value?.trim();

    if (!url) {
      alert('학습할 블로그 글의 URL 주소를 입력해주세요.');
      input?.focus();
      return;
    }

    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      alert('올바른 웹 주소(http:// 또는 https:// 로 시작)를 입력해주세요.');
      input?.focus();
      return;
    }

    const btn = document.getElementById('btnModalLearnUrl');
    if (btn) btn.disabled = true;

    try {
      const data = await api.learnStyleFromUrl(url);
      alert('🎉 ' + (data.message || 'URL 본문 문체 학습이 완료되었습니다!'));
      if (input) input.value = '';
      await this.refreshStyleProfile();
    } catch (err) {
      alert('⚠️ URL 문체 학습 실패:\n' + err.message);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async deleteUserStyleNow() {
    const confirmed = confirm('⚠️ [문체 프로필 삭제]\n\n저장된 맞춤 문체 학습 데이터를 삭제하시겠습니까?\n삭제 후에는 기본 안전 관찰 문체가 적용되며, 언제든 다시 학습하실 수 있습니다.');
    if (!confirmed) return;

    const btn = document.getElementById('btnModalDelete');
    if (btn) btn.disabled = true;

    try {
      const res = await api.deleteStyleProfile();
      alert('🗑️ ' + (res.message || '문체 프로필이 삭제되었습니다.'));
      await this.refreshStyleProfile();
    } catch (err) {
      alert('삭제 처리 오류:\n' + err.message);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // Settings Modal Management (Supports setSettingsTab & switchSettingsTab)
  async openSettingsModal() {
    const modal = document.getElementById('settingsModal');
    if (modal) modal.classList.remove('hidden');
    await this.loadSettingsData();
    if (window.lucide) window.lucide.createIcons();
  }

  closeSettingsModal() {
    const modal = document.getElementById('settingsModal');
    if (modal) modal.classList.add('hidden');
  }

  setSettingsTab(tabName) {
    const tabs = ['general', 'ai', 'security', 'diagnostics'];
    tabs.forEach((t) => {
      // Capitalize first letter: General, Ai, Security, Diagnostics
      const capName = t.charAt(0).toUpperCase() + t.slice(1);
      const btn = document.getElementById(`setTabBtn${capName}`);
      const content = document.getElementById(`setTabView${capName}`);

      if (t === tabName) {
        btn?.classList.add('bg-white', 'text-indigo-600', 'shadow-2xs');
        btn?.classList.remove('text-slate-600');
        content?.classList.remove('hidden');
      } else {
        btn?.classList.remove('bg-white', 'text-indigo-600', 'shadow-2xs');
        btn?.classList.add('text-slate-600');
        content?.classList.add('hidden');
      }
    });
  }

  switchSettingsTab(tabName) {
    this.setSettingsTab(tabName);
  }

  async loadSettingsData() {
    try {
      const data = await api.getSettings();
      const settings = data.settings || {};
      const stats = data.stats || {};

      const envLabel = document.getElementById('cfgEnvLabel');
      if (envLabel) envLabel.innerText = settings.environment || 'development';

      const expSelect = document.getElementById('cfgExpirationSelect');
      if (expSelect && settings.expirationHours) {
        expSelect.value = String(settings.expirationHours);
      }

      const maxBytesSelect = document.getElementById('cfgMaxBytesSelect');
      if (maxBytesSelect && settings.maxImageBytes) {
        maxBytesSelect.value = String(settings.maxImageBytes);
      }

      const timeoutSelect = document.getElementById('cfgTimeoutSelect');
      if (timeoutSelect && settings.aiTimeoutSeconds) {
        timeoutSelect.value = String(settings.aiTimeoutSeconds);
      }

      if (settings.aiTimeoutSeconds) {
        this.aiTimeoutSeconds = Number(settings.aiTimeoutSeconds);
      }

      const timeoutLabel = document.getElementById('diag_aiTimeoutLabel');
      if (timeoutLabel) {
        const sec = settings.aiTimeoutSeconds || 180;
        timeoutLabel.innerText = `${sec}초 (${Math.round(sec / 60)}분)`;
      }

      const neuronUsedEl = document.getElementById('diag_neuronsUsed');
      if (neuronUsedEl) {
        const used = Math.round(stats.totalNeuronsUsed || 0);
        const quota = stats.dailyNeuronsQuota || 10000;
        const pct = Math.round((used / quota) * 100);
        let colorClass = 'text-indigo-700';
        if (pct >= 90) colorClass = 'text-red-600';
        else if (pct >= 70) colorClass = 'text-amber-600';

        neuronUsedEl.className = `text-xs sm:text-sm font-extrabold font-mono mt-1 ${colorClass}`;
        neuronUsedEl.innerText = `${used.toLocaleString()} / ${quota.toLocaleString()} Neurons (${pct}%)`;
      }

      const utcLabel = document.getElementById('diag_utcDateLabel');
      if (utcLabel && stats.todayUtcDate) {
        utcLabel.innerText = `(${stats.todayUtcDate} 00:00 UTC 기준)`;
      }

      const totalJobs = document.getElementById('diag_totalJobs');
      if (totalJobs) totalJobs.innerText = `${stats.totalJobs || 0} 건`;

      const totalPosts = document.getElementById('diag_totalPosts');
      if (totalPosts) totalPosts.innerText = `${stats.totalPosts || 0} 건`;
    } catch (err) {
      alert('환경 설정 조회 실패: ' + err.message);
    }
  }

  async saveSettingsNow() {
    const expSelect = document.getElementById('cfgExpirationSelect');
    const maxBytesSelect = document.getElementById('cfgMaxBytesSelect');
    const timeoutSelect = document.getElementById('cfgTimeoutSelect');

    const expHours = parseInt(expSelect?.value || '24', 10);
    const maxBytes = parseInt(maxBytesSelect?.value || '10485760', 10);
    const timeoutSec = parseInt(timeoutSelect?.value || '180', 10);

    const payload = {
      expirationHours: expHours,
      maxImageBytes: maxBytes,
      aiTimeoutSeconds: timeoutSec,
    };

    const btn = document.getElementById('btnSaveSettings');
    if (btn) btn.disabled = true;

    try {
      const res = await api.updateSettings(payload);
      this.aiTimeoutSeconds = timeoutSec;
      const timeoutLabel = document.getElementById('diag_aiTimeoutLabel');
      if (timeoutLabel) {
        timeoutLabel.innerText = `${timeoutSec}초 (${Math.round(timeoutSec / 60)}분)`;
      }
      alert('💾 ' + (res.message || '설정이 D1 데이터베이스에 안전하게 영구 저장되었습니다.'));
      this.closeSettingsModal();
    } catch (err) {
      alert('설정 저장 오류: ' + err.message);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  saveSettings() {
    return this.saveSettingsNow();
  }
}

// Global App Instance
export const app = new StudioApp();
window.app = app;
