import {
  getQuarterlies,
  getQuarterlyIndex,
  loadAllLessons,
  clearApiCache
} from '../lib/api';
import {
  downloadSinglePdf,
  downloadBatchSequential,
  downloadAsZip
} from '../lib/downloader';
import {
  esc,
  stripHtml,
  formatBytes,
  getPdfFileName,
  getQuarterZipFileName,
  getLessonZipFileName
} from '../lib/formatters';
import type {
  QuarterlySummary,
  QuarterlyDetailResponse,
  LessonDetailResponse,
  PdfItem,
  DownloadItem,
  LogLevel
} from '../types/adventech';

// Local storage helper
const storage = {
  get<T>(key: string, fallback: T): T {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set<T>(key: string, value: T): void {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  }
};

// Global App State
const state = {
  lang: storage.get<string>('ss.lang', 'es'),
  qid: storage.get<string>('ss.qid', '2026-04-cq'),
  quarterlies: [] as QuarterlySummary[],
  quarter: null as QuarterlyDetailResponse | null,
  lessons: new Map<string, LessonDetailResponse>(),
  selectedYear: 'all',
  isBusy: false,
  showRawJson: false,
  downloadAbortController: null as AbortController | null,
  fetchAbortController: null as AbortController | null
};

// Toast notification helper
function showToast(message: string, type: 'info' | 'success' | 'error' = 'info'): void {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast-message toast-${type}`;

  const iconSvg = type === 'success'
    ? '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>'
    : type === 'error'
    ? '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>'
    : '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>';

  toast.innerHTML = `${iconSvg}<span>${esc(message)}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-fadeout');
    setTimeout(() => toast.remove(), 250);
  }, 2600);
}

// Log to console activity panel
function logActivity(message: string, level: LogLevel = 'info'): void {
  const logBox = document.getElementById('logContent');
  if (!logBox) return;

  const entry = document.createElement('div');
  entry.className = `log-row log-${level}`;
  const now = new Date().toLocaleTimeString('es', { hour12: false });
  entry.innerHTML = `<span class="log-time">${now}</span><span class="log-msg">${esc(message)}</span>`;

  logBox.prepend(entry);
  while (logBox.children.length > 200) {
    logBox.lastElementChild?.remove();
  }
}

// Lock / Unlock interactive buttons during downloads
function setBusyState(busy: boolean): void {
  state.isBusy = busy;
  document.querySelectorAll<HTMLButtonElement>('[data-lock]').forEach(btn => {
    btn.disabled = busy;
  });

  const stopBtn = document.getElementById('stopBatchBtn') as HTMLButtonElement | null;
  if (stopBtn) {
    stopBtn.style.display = busy ? 'inline-flex' : 'none';
  }
}

// Extract year filters from loaded quarterlies
function renderYearFilters(): void {
  const bar = document.getElementById('yearFilterBar');
  if (!bar) return;

  const yearsSet = new Set<string>();
  state.quarterlies.forEach(q => {
    const match = q.id.match(/^(\d{4})/);
    if (match) yearsSet.add(match[1]);
  });

  const sortedYears = Array.from(yearsSet).sort((a, b) => b.localeCompare(a));
  if (sortedYears.length === 0) {
    bar.style.display = 'none';
    return;
  }

  bar.style.display = 'flex';
  bar.innerHTML = `
    <button class="year-chip ${state.selectedYear === 'all' ? 'active' : ''}" data-year="all">Todos</button>
    ${sortedYears
      .map(
        y => `<button class="year-chip ${state.selectedYear === y ? 'active' : ''}" data-year="${y}">${y}</button>`
      )
      .join('')}
  `;

  bar.querySelectorAll<HTMLButtonElement>('.year-chip').forEach(chip => {
    chip.onclick = () => {
      state.selectedYear = chip.dataset.year || 'all';
      renderYearFilters();
      renderQuarterliesList();
    };
  });
}

// Render sidebar list
function renderQuarterliesList(): void {
  const searchInput = document.getElementById('qsearch') as HTMLInputElement | null;
  const term = searchInput ? searchInput.value.trim().toLowerCase() : '';

  const list = state.quarterlies.filter(q => {
    if (state.selectedYear !== 'all' && !q.id.startsWith(state.selectedYear)) {
      return false;
    }
    if (!term) return true;
    return (
      q.title.toLowerCase().includes(term) ||
      q.id.toLowerCase().includes(term) ||
      String(q.human_date || '').toLowerCase().includes(term)
    );
  });

  const countBadge = document.getElementById('qcount');
  if (countBadge) {
    countBadge.textContent =
      list.length === state.quarterlies.length
        ? `${state.quarterlies.length}`
        : `${list.length} / ${state.quarterlies.length}`;
  }

  const qlistEl = document.getElementById('qlist');
  if (!qlistEl) return;

  if (list.length === 0) {
    qlistEl.innerHTML = `
      <div class="empty-list">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"></circle>
          <path d="m21 21-4.3-4.3"></path>
        </svg>
        <p>No se encontraron trimestres</p>
      </div>
    `;
    return;
  }

  const frag = document.createDocumentFragment();
  list.forEach(q => {
    const item = document.createElement('div');
    item.className = `quarter-item ${q.id === state.qid ? 'active' : ''}`;
    item.innerHTML = `
      <div class="quarter-item-content">
        <div class="quarter-item-title">${esc(q.title)}</div>
        <div class="quarter-item-sub">${esc(q.human_date || q.start_date || '')}</div>
      </div>
      <span class="quarter-item-id">${esc(q.id)}</span>
    `;

    item.onclick = () => {
      if (state.qid !== q.id) {
        selectQuarter(q.id);
        // On mobile, close sidebar after selecting
        const sidebar = document.getElementById('sidebar');
        const backdrop = document.getElementById('sidebarBackdrop');
        sidebar?.classList.remove('open');
        backdrop?.classList.remove('open');
      }
    };

    frag.appendChild(item);
  });

  qlistEl.innerHTML = '';
  qlistEl.appendChild(frag);
}

// Build array of download items
function getAllDownloadPairs(lessonId?: string): DownloadItem[] {
  if (!state.quarter) return [];

  const lessons = lessonId
    ? [state.lessons.get(lessonId)]
    : (state.quarter.lessons || []).map(l => state.lessons.get(l.id));

  const items: DownloadItem[] = [];

  lessons.forEach(d => {
    if (!d || !d.pdfs || d.pdfs.length === 0) return;
    const lid = lessonId || (d.lesson && d.lesson.id) || '00';
    d.pdfs.forEach(p => {
      items.push({
        pdf: p,
        lessonId: lid,
        fileName: getPdfFileName(state.quarter!._id || state.qid, state.lang, lid, p)
      });
    });
  });

  return items;
}

// Render stage view
function renderStage(): void {
  const stageEl = document.getElementById('stage');
  if (!stageEl) return;

  const q = state.quarter;
  if (!q) {
    stageEl.innerHTML = `
      <div class="empty-state">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
          <line x1="16" y1="2" x2="16" y2="6"></line>
          <line x1="8" y1="2" x2="8" y2="6"></line>
        </svg>
        <p>Selecciona un trimestre para ver y descargar sus lecciones</p>
      </div>
    `;
    return;
  }

  const quarterlyMeta = q.quarterly || ({} as any);
  const lessons = q.lessons || [];

  // Count total PDFs
  let totalPdfs = 0;
  lessons.forEach(l => {
    const detail = state.lessons.get(l.id);
    if (detail?.pdfs) {
      totalPdfs += detail.pdfs.length;
    }
  });

  const descRaw = stripHtml(quarterlyMeta.description || '');
  const hasLongDesc = descRaw.length > 300;
  const shortDesc = hasLongDesc ? descRaw.slice(0, 300) + '...' : descRaw;

  const htmlParts: string[] = [];

  // Header Card
  htmlParts.push(`
    <div class="card quarter-header-card">
      <div class="quarter-cover-box">
        <img
          class="quarter-cover-img"
          src="${esc(quarterlyMeta.cover || '')}"
          alt="Portada"
          loading="lazy"
          onerror="this.parentElement.style.display='none'"
        />
      </div>

      <div class="quarter-info-box">
        <div class="quarter-badges">
          <span class="badge badge-blue">${esc(state.lang.toUpperCase())}</span>
          <span class="badge">${lessons.length} lecciones</span>
          <span class="badge ${totalPdfs > 0 ? 'badge-green' : 'badge-amber'}">${totalPdfs} PDFs disponibles</span>
          <span class="badge badge-id">${esc(q._id || state.qid)}</span>
        </div>

        <h1 class="quarter-title">${esc(quarterlyMeta.title || q._id)}</h1>
        <div class="quarter-date">${esc(quarterlyMeta.human_date || '')}</div>

        <div class="quarter-desc-container">
          <p class="quarter-desc" id="quarterDescText">${esc(shortDesc)}</p>
          ${hasLongDesc ? `<button class="btn-link" id="toggleDescBtn" data-full="${esc(descRaw)}" data-short="${esc(shortDesc)}">Leer más</button>` : ''}
        </div>

        <div class="quarter-action-buttons">
          ${totalPdfs > 0 ? `
            <button class="btn btn-zip" id="dlZipAll" data-lock>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="21 8 21 21 3 21 3 8"></polyline>
                <rect x="1" y="3" width="22" height="5"></rect>
                <line x1="10" y1="12" x2="14" y2="12"></line>
              </svg>
              <span>Descargar ZIP completo (${totalPdfs} PDFs)</span>
            </button>

            <button class="btn btn-primary" id="dlSequentialAll" data-lock>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
              <span>Descargar por lotes (.pdf)</span>
            </button>
          ` : ''}

          <button class="btn btn-ghost" id="toggleJsonBtn">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="16 18 22 12 16 6"></polyline>
              <polyline points="8 6 2 12 8 18"></polyline>
            </svg>
            <span>${state.showRawJson ? 'Ocultar JSON' : 'Ver JSON'}</span>
          </button>

          <a
            class="btn btn-ghost"
            href="https://sabbath-school.adventech.io/${esc(state.lang)}/${esc(q._id)}"
            target="_blank"
            rel="noopener noreferrer"
          >
            <span>Ver en web adventech</span>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
              <polyline points="15 3 21 3 21 9"></polyline>
              <line x1="10" y1="14" x2="21" y2="3"></line>
            </svg>
          </a>
        </div>

        ${totalPdfs === 0 ? `
          <div class="warning-banner">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="8" x2="12" y2="12"></line>
              <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
            <span>Este trimestre no cuenta con archivos PDF descargables para este idioma (solo lectura en línea o trimestre legado). Prueba seleccionando otro idioma o trimestre.</span>
          </div>
        ` : ''}
      </div>
    </div>
  `);

  // Download Progress & Terminal Console Section
  htmlParts.push(`
    <div class="card download-activity-card" id="activityCard" style="display: none;">
      <div class="activity-header">
        <div class="activity-status">
          <span class="spin" id="activitySpinner" style="display: none;"></span>
          <span id="activityTitle" class="activity-title">Progreso de descarga</span>
          <span id="activityCounter" class="activity-counter"></span>
        </div>
        <div class="activity-controls">
          <button class="btn btn-sm btn-danger" id="stopBatchBtn" style="display: none;">
            Detener descarga
          </button>
          <button class="btn btn-sm btn-ghost" id="clearLogBtn" title="Limpiar terminal">
            Limpiar registro
          </button>
        </div>
      </div>

      <div class="progress-bar-container">
        <div class="progress-bar-fill" id="progressBar"></div>
      </div>

      <div class="log-terminal" id="logContent"></div>
    </div>
  `);

  // Lessons Section
  htmlParts.push(`<div class="lessons-container">`);

  lessons.forEach(l => {
    const detail = state.lessons.get(l.id);
    const pdfs = detail?.pdfs || [];
    const error = detail?.error;

    htmlParts.push(`
      <div class="card lesson-card">
        <div class="lesson-header">
          <div class="lesson-num">${esc(l.id)}</div>
          <div class="lesson-info">
            <div class="lesson-title">${esc(l.title)}</div>
            <div class="lesson-dates">
              ${esc(l.start_date || '')} ${l.end_date ? `→ ${esc(l.end_date)}` : ''}
              ${l.pdfOnly
                ? '<span class="badge badge-amber badge-sm">Solo PDF</span>'
                : '<span class="badge badge-green badge-sm">Lectura online</span>'}
            </div>
          </div>
          <div class="lesson-actions">
            ${pdfs.length > 0 ? `
              <button class="btn btn-sm btn-zip" data-lock data-lesson-zip="${esc(l.id)}" title="Descargar lección en ZIP">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="21 8 21 21 3 21 3 8"></polyline>
                  <rect x="1" y="3" width="22" height="5"></rect>
                  <line x1="10" y1="12" x2="14" y2="12"></line>
                </svg>
                <span>ZIP (${pdfs.length})</span>
              </button>
              <button class="btn btn-sm btn-primary" data-lock data-lesson-batch="${esc(l.id)}" title="Descargar lección en PDFs individuales">
                ⬇ Lote (${pdfs.length})
              </button>
            ` : ''}
            <button class="btn btn-sm btn-ghost" data-lesson-raw="${esc(l.id)}" title="Ver datos JSON de la lección">
              JSON
            </button>
          </div>
        </div>

        <div class="lesson-pdfs-list">
          ${error ? `<div class="pdf-none warning">⚠ ${esc(error)}</div>` : ''}
          ${!error && pdfs.length === 0 ? '<div class="pdf-none">Sin archivos PDF disponibles para este idioma</div>' : ''}
          ${pdfs.map(p => `
            <div class="pdf-row" data-pdf-row="${esc(p.id)}">
              <div class="pdf-icon-badge">PDF</div>
              <div class="pdf-meta">
                <div class="pdf-name" title="${esc(p.title)}">${esc(p.title)}</div>
                <div class="pdf-sub">${esc(p.target || p.id.slice(0, 16))}</div>
              </div>
              <div class="pdf-status" data-status-id="${esc(p.id)}"></div>
              <div class="pdf-actions">
                <button class="btn btn-sm btn-primary" data-lock data-dl-pdf="${esc(p.id)}" data-lid="${esc(l.id)}" title="Descargar PDF">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <polyline points="7 10 12 15 17 10"></polyline>
                    <line x1="12" y1="15" x2="12" y2="3"></line>
                  </svg>
                  <span>Descargar</span>
                </button>
                <button class="btn btn-sm btn-ghost" data-pv-pdf="${esc(p.id)}" title="Vista previa en modal">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"></path>
                    <circle cx="12" cy="12" r="3"></circle>
                  </svg>
                  <span>Ver</span>
                </button>
                <button class="btn btn-sm btn-ghost" data-copy-pdf="${esc(p.id)}" title="Copiar enlace al PDF">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect>
                    <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path>
                  </svg>
                </button>
              </div>
            </div>
          `).join('')}
        </div>

        <details class="lesson-raw-details" id="rawLesson-${esc(l.id)}">
          <summary>Respuesta API: lessons/${esc(l.id)}/index.json</summary>
          <pre>${esc(JSON.stringify(detail ?? null, null, 2))}</pre>
        </details>
      </div>
    `);
  });

  htmlParts.push(`</div>`);

  // Raw JSON quarterly view
  if (state.showRawJson) {
    htmlParts.push(`
      <div class="card quarter-raw-card">
        <div class="raw-card-header">
          <span>Respuesta cruda: /quarterlies/${esc(q._id)}/index.json</span>
          <button class="btn btn-sm btn-ghost" id="copyQuarterJsonBtn">Copiar JSON</button>
        </div>
        <pre class="raw-pre">${esc(JSON.stringify(q, null, 2))}</pre>
      </div>
    `);
  }

  stageEl.innerHTML = htmlParts.join('');
  attachStageEventListeners();
}

// Find a PDF item by ID
function findPdf(pdfId: string): { pdf: PdfItem; lessonId: string } | null {
  if (!state.quarter) return null;
  for (const [lid, detail] of state.lessons.entries()) {
    if (detail?.pdfs) {
      const match = detail.pdfs.find(p => p.id === pdfId);
      if (match) return { pdf: match, lessonId: lid };
    }
  }
  return null;
}

// Preview PDF in modal
function openPreviewModal(pdf: PdfItem): void {
  const modal = document.getElementById('modal');
  const title = document.getElementById('mtitle');
  const frame = document.getElementById('mframe') as HTMLIFrameElement | null;
  const openBtn = document.getElementById('mopen');
  const copyBtn = document.getElementById('mcopy');

  if (!modal || !title || !frame) return;

  title.textContent = `${pdf.title} · ${state.quarter?._id || ''}`;
  frame.src = `${pdf.src}#view=FitH`;

  if (openBtn) {
    openBtn.onclick = () => window.open(pdf.src, '_blank', 'noopener');
  }

  if (copyBtn) {
    copyBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(pdf.src);
        showToast('Enlace copiado al portapapeles', 'success');
      } catch {
        showToast('No se pudo copiar el enlace', 'error');
      }
    };
  }

  modal.classList.add('open');
}

// Attach event listeners to stage elements
function attachStageEventListeners(): void {
  // Toggle description expand
  const descBtn = document.getElementById('toggleDescBtn') as HTMLButtonElement | null;
  const descText = document.getElementById('quarterDescText');
  if (descBtn && descText) {
    let expanded = false;
    descBtn.onclick = () => {
      expanded = !expanded;
      descText.textContent = expanded ? descBtn.dataset.full || '' : descBtn.dataset.short || '';
      descBtn.textContent = expanded ? 'Leer menos' : 'Leer más';
    };
  }

  // Toggle JSON view
  const jsonBtn = document.getElementById('toggleJsonBtn');
  if (jsonBtn) {
    jsonBtn.onclick = () => {
      state.showRawJson = !state.showRawJson;
      renderStage();
    };
  }

  // Copy quarterly JSON
  const copyJsonBtn = document.getElementById('copyQuarterJsonBtn');
  if (copyJsonBtn && state.quarter) {
    copyJsonBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(JSON.stringify(state.quarter, null, 2));
        showToast('JSON copiado al portapapeles', 'success');
      } catch {
        showToast('No se pudo copiar el JSON', 'error');
      }
    };
  }

  // Clear log
  const clearLogBtn = document.getElementById('clearLogBtn');
  if (clearLogBtn) {
    clearLogBtn.onclick = () => {
      const logBox = document.getElementById('logContent');
      if (logBox) logBox.innerHTML = '';
      showToast('Registro limpiado', 'info');
    };
  }

  // Stop batch button
  const stopBtn = document.getElementById('stopBatchBtn');
  if (stopBtn) {
    stopBtn.onclick = () => {
      if (state.downloadAbortController) {
        state.downloadAbortController.abort();
        state.downloadAbortController = null;
        showToast('Cancelando descargas...', 'info');
      }
    };
  }

  // Download all as ZIP
  const dlZipBtn = document.getElementById('dlZipAll');
  if (dlZipBtn) {
    dlZipBtn.onclick = async () => {
      const items = getAllDownloadPairs();
      if (items.length === 0) return;

      const zipName = getQuarterZipFileName(state.quarter?._id || state.qid, state.lang);
      startZipDownload(items, zipName);
    };
  }

  // Download all sequentially
  const dlSeqBtn = document.getElementById('dlSequentialAll');
  if (dlSeqBtn) {
    dlSeqBtn.onclick = async () => {
      const items = getAllDownloadPairs();
      if (items.length === 0) return;
      startSequentialDownload(items);
    };
  }

  // Single PDF downloads
  document.querySelectorAll<HTMLButtonElement>('[data-dl-pdf]').forEach(btn => {
    btn.onclick = async () => {
      const pdfId = btn.dataset.dlPdf;
      const lid = btn.dataset.lid;
      if (!pdfId || !lid) return;

      const found = findPdf(pdfId);
      if (!found) return;

      const fileName = getPdfFileName(state.quarter?._id || state.qid, state.lang, lid, found.pdf);
      const statusEl = document.querySelector(`[data-status-id="${pdfId}"]`);

      btn.disabled = true;
      if (statusEl) statusEl.textContent = '0%';

      try {
        await downloadSinglePdf(
          { pdf: found.pdf, lessonId: lid, fileName },
          pct => {
            if (statusEl) statusEl.textContent = `${pct}%`;
          },
          (msg, lvl) => {
            logActivity(msg, lvl);
          }
        );
        showToast(`Descargado: ${fileName}`, 'success');
        if (statusEl) statusEl.textContent = '✓ Listo';
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          showToast(`Error al descargar: ${err.message}`, 'error');
          logActivity(`Error al descargar ${fileName}: ${err.message}`, 'error');
          if (statusEl) statusEl.textContent = 'Error';
        }
      } finally {
        btn.disabled = false;
        setTimeout(() => {
          if (statusEl && statusEl.textContent === '✓ Listo') {
            statusEl.textContent = '';
          }
        }, 4000);
      }
    };
  });

  // Single PDF preview
  document.querySelectorAll<HTMLButtonElement>('[data-pv-pdf]').forEach(btn => {
    btn.onclick = () => {
      const pdfId = btn.dataset.pvPdf;
      if (!pdfId) return;
      const found = findPdf(pdfId);
      if (found) openPreviewModal(found.pdf);
    };
  });

  // Copy PDF url
  document.querySelectorAll<HTMLButtonElement>('[data-copy-pdf]').forEach(btn => {
    btn.onclick = async () => {
      const pdfId = btn.dataset.copyPdf;
      if (!pdfId) return;
      const found = findPdf(pdfId);
      if (!found) return;

      try {
        await navigator.clipboard.writeText(found.pdf.src);
        showToast('Enlace al PDF copiado', 'success');
      } catch {
        showToast('No se pudo copiar el enlace', 'error');
      }
    };
  });

  // Lesson ZIP download
  document.querySelectorAll<HTMLButtonElement>('[data-lesson-zip]').forEach(btn => {
    btn.onclick = () => {
      const lid = btn.dataset.lessonZip;
      if (!lid) return;
      const items = getAllDownloadPairs(lid);
      if (items.length === 0) return;

      const zipName = getLessonZipFileName(state.quarter?._id || state.qid, state.lang, lid);
      startZipDownload(items, zipName);
    };
  });

  // Lesson sequential batch download
  document.querySelectorAll<HTMLButtonElement>('[data-lesson-batch]').forEach(btn => {
    btn.onclick = () => {
      const lid = btn.dataset.lessonBatch;
      if (!lid) return;
      const items = getAllDownloadPairs(lid);
      if (items.length === 0) return;
      startSequentialDownload(items);
    };
  });

  // Toggle lesson raw JSON
  document.querySelectorAll<HTMLButtonElement>('[data-lesson-raw]').forEach(btn => {
    btn.onclick = () => {
      const lid = btn.dataset.lessonRaw;
      if (!lid) return;
      const details = document.getElementById(`rawLesson-${lid}`) as HTMLDetailsElement | null;
      if (details) {
        details.open = !details.open;
        if (details.open) {
          details.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }
    };
  });
}

// Start Zip Download with progress display
async function startZipDownload(items: DownloadItem[], zipFileName: string): Promise<void> {
  if (state.isBusy) {
    showToast('Ya hay una descarga en curso', 'error');
    return;
  }

  const activityCard = document.getElementById('activityCard');
  const activityTitle = document.getElementById('activityTitle');
  const activityCounter = document.getElementById('activityCounter');
  const activitySpinner = document.getElementById('activitySpinner');
  const progressBar = document.getElementById('progressBar');

  if (activityCard) activityCard.style.display = 'block';
  if (activityTitle) activityTitle.textContent = `Creando archivo ZIP (${items.length} PDFs)...`;
  if (activitySpinner) activitySpinner.style.display = 'inline-block';
  if (progressBar) progressBar.style.width = '0%';

  state.downloadAbortController = new AbortController();
  setBusyState(true);

  try {
    await downloadAsZip(
      items,
      zipFileName,
      prog => {
        if (progressBar) progressBar.style.width = `${prog.percentage}%`;
        if (activityCounter) {
          activityCounter.textContent = `${prog.current} / ${prog.total} (${prog.percentage}%)`;
        }
      },
      (msg, lvl) => logActivity(msg, lvl),
      state.downloadAbortController.signal
    );
    showToast(`Archivo ZIP descargado: ${zipFileName}`, 'success');
  } catch (err: any) {
    if (err.name === 'AbortError') {
      showToast('Descarga ZIP cancelada', 'info');
      logActivity('Descarga ZIP cancelada por el usuario', 'error');
    } else {
      showToast(`Error al generar ZIP: ${err.message}`, 'error');
      logActivity(`Error al generar ZIP: ${err.message}`, 'error');
    }
  } finally {
    setBusyState(false);
    state.downloadAbortController = null;
    if (activitySpinner) activitySpinner.style.display = 'none';
    if (progressBar) progressBar.style.width = '100%';
    setTimeout(() => {
      if (!state.isBusy && progressBar) progressBar.style.width = '0%';
    }, 3000);
  }
}

// Start Sequential Download with progress display
async function startSequentialDownload(items: DownloadItem[]): Promise<void> {
  if (state.isBusy) {
    showToast('Ya hay una descarga en curso', 'error');
    return;
  }

  const activityCard = document.getElementById('activityCard');
  const activityTitle = document.getElementById('activityTitle');
  const activityCounter = document.getElementById('activityCounter');
  const activitySpinner = document.getElementById('activitySpinner');
  const progressBar = document.getElementById('progressBar');

  if (activityCard) activityCard.style.display = 'block';
  if (activityTitle) activityTitle.textContent = `Descargando por lotes (${items.length} archivos)...`;
  if (activitySpinner) activitySpinner.style.display = 'inline-block';
  if (progressBar) progressBar.style.width = '0%';

  state.downloadAbortController = new AbortController();
  setBusyState(true);

  try {
    const result = await downloadBatchSequential(
      items,
      prog => {
        if (progressBar) progressBar.style.width = `${prog.percentage}%`;
        if (activityCounter) {
          activityCounter.textContent = `${prog.current} / ${prog.total} (${prog.percentage}%)`;
        }
      },
      (msg, lvl) => logActivity(msg, lvl),
      state.downloadAbortController.signal,
      600
    );

    if (result.failed === 0) {
      showToast(`Lote completado: ${result.successful} PDFs`, 'success');
    } else {
      showToast(`Lote terminado con ${result.failed} errores`, 'error');
    }
  } catch (err: any) {
    if (err.name === 'AbortError') {
      showToast('Descarga cancelada', 'info');
    } else {
      showToast(`Error en la descarga: ${err.message}`, 'error');
    }
  } finally {
    setBusyState(false);
    state.downloadAbortController = null;
    if (activitySpinner) activitySpinner.style.display = 'none';
    if (progressBar) progressBar.style.width = '100%';
    setTimeout(() => {
      if (!state.isBusy && progressBar) progressBar.style.width = '0%';
    }, 3000);
  }
}

// Select a quarterly and fetch its data progressively
async function selectQuarter(id: string): Promise<void> {
  state.qid = id;
  storage.set('ss.qid', id);
  state.quarter = null;
  state.lessons.clear();

  // Abort any ongoing fetch
  if (state.fetchAbortController) {
    state.fetchAbortController.abort();
  }
  state.fetchAbortController = new AbortController();
  const signal = state.fetchAbortController.signal;

  renderQuarterliesList();

  const stageEl = document.getElementById('stage');
  if (stageEl) {
    stageEl.innerHTML = `
      <div class="empty-state">
        <div class="spin-lg"></div>
        <p>Cargando información y lecciones de <strong>${esc(id)}</strong>...</p>
      </div>
    `;
  }

  try {
    const qIndex = await getQuarterlyIndex(state.lang, id, signal);
    state.quarter = qIndex;

    const lessonIds = (qIndex.lessons || []).map(l => l.id);

    // Initial render with metadata so user sees immediate feedback
    renderStage();

    // Progressively load all lessons with concurrency control
    await loadAllLessons(
      state.lang,
      id,
      lessonIds,
      5,
      (_loaded, _total, detail) => {
        if (detail && detail.lesson) {
          state.lessons.set(detail.lesson.id, detail);
          // Update lesson status in place or rerender
        }
      },
      signal
    );

    // Final render with all PDFs loaded
    renderStage();
  } catch (err: any) {
    if (err.name === 'AbortError') return;
    if (stageEl) {
      stageEl.innerHTML = `
        <div class="empty-state">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
          <p>No se pudo cargar el trimestre: ${esc(err.message)}</p>
          <button class="btn btn-sm btn-primary" id="retryQuarterBtn">Reintentar</button>
        </div>
      `;
      const retryBtn = document.getElementById('retryQuarterBtn');
      if (retryBtn) retryBtn.onclick = () => selectQuarter(id);
    }
  }
}

// Load all quarterlies for selected language
async function loadQuarterlies(): Promise<void> {
  const stageEl = document.getElementById('stage');
  if (stageEl) {
    stageEl.innerHTML = `
      <div class="empty-state">
        <div class="spin-lg"></div>
        <p>Cargando catálogo de trimestres (${state.lang.toUpperCase()})...</p>
      </div>
    `;
  }

  const qlistEl = document.getElementById('qlist');
  if (qlistEl) {
    qlistEl.innerHTML = `
      <div class="loading-state">
        <div class="skeleton" style="height: 48px; margin-bottom: 8px;"></div>
        <div class="skeleton" style="height: 48px; margin-bottom: 8px;"></div>
        <div class="skeleton" style="height: 48px; margin-bottom: 8px;"></div>
        <div class="skeleton" style="height: 48px;"></div>
      </div>
    `;
  }

  try {
    const list = await getQuarterlies(state.lang);
    state.quarterlies = list;

    // Default to stored qid or first available
    if (!state.quarterlies.some(q => q.id === state.qid)) {
      state.qid = state.quarterlies[0]?.id || '';
    }

    renderYearFilters();
    renderQuarterliesList();

    if (state.qid) {
      await selectQuarter(state.qid);
    } else {
      renderStage();
    }
  } catch (err: any) {
    if (stageEl) {
      stageEl.innerHTML = `
        <div class="empty-state">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
          <p>Error de conexión con la API de Adventech: ${esc(err.message)}</p>
          <button class="btn btn-sm btn-primary" id="retryCatalogBtn">Reintentar conexión</button>
        </div>
      `;
      const retry = document.getElementById('retryCatalogBtn');
      if (retry) retry.onclick = () => loadQuarterlies();
    }
  }
}

// Global initialization
export function initApp(): void {
  // Search input binding
  const searchInput = document.getElementById('qsearch') as HTMLInputElement | null;
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      renderQuarterliesList();
    });
  }

  // Language selector binding
  const langSelect = document.getElementById('lang') as HTMLSelectElement | null;
  if (langSelect) {
    langSelect.value = state.lang;
    langSelect.addEventListener('change', e => {
      const newLang = (e.target as HTMLSelectElement).value;
      state.lang = newLang;
      storage.set('ss.lang', newLang);
      state.quarterlies = [];
      state.quarter = null;
      state.lessons.clear();
      loadQuarterlies();
    });
  }

  // Reload button
  const reloadBtn = document.getElementById('reload');
  if (reloadBtn) {
    reloadBtn.onclick = () => {
      clearApiCache();
      state.quarterlies = [];
      state.quarter = null;
      state.lessons.clear();
      showToast('Caché limpiada y recargando datos', 'info');
      loadQuarterlies();
    };
  }

  // Modal controls
  const modal = document.getElementById('modal');
  const mclose = document.getElementById('mclose');
  const mframe = document.getElementById('mframe') as HTMLIFrameElement | null;

  const closeModal = () => {
    if (modal) modal.classList.remove('open');
    if (mframe) mframe.src = 'about:blank';
  };

  if (mclose) mclose.onclick = closeModal;
  if (modal) {
    modal.onclick = e => {
      if (e.target === modal) closeModal();
    };
  }

  // Keyboard navigation
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closeModal();
    }
    // '/' or 'Ctrl+K' focuses search if not currently in an input
    if (
      (e.key === '/' || (e.ctrlKey && e.key === 'k')) &&
      document.activeElement?.tagName !== 'INPUT' &&
      document.activeElement?.tagName !== 'TEXTAREA'
    ) {
      e.preventDefault();
      searchInput?.focus();
    }
  });

  // Mobile sidebar toggle
  const toggleBtn = document.getElementById('sidebarToggle');
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebarBackdrop');

  if (toggleBtn && sidebar && backdrop) {
    const toggleSidebar = () => {
      sidebar.classList.toggle('open');
      backdrop.classList.toggle('open');
    };
    toggleBtn.onclick = toggleSidebar;
    backdrop.onclick = toggleSidebar;
  }

  // Start initial load
  loadQuarterlies();
}
