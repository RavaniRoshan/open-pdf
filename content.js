/**
 * PDF Explain — Content Script (complete)
 * Slices 1–7: UI, Extraction, Streaming, Level Control, Errors, Performance
 */

// === Icons ===
const icons = {
  toggle: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>`,
  sun: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>`,
  moon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>`,
};

// === State ===
let mode = 'pdf';
let level = localStorage.getItem('explainer-level') || 'normal';
let theme = localStorage.getItem('explainer-theme') || 'light';
let rewriteInProgress = false;
let abortController = null;
const rewriteCache = new Map();

// === Init ===
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

async function init() {
  if (!isPdfContext()) return; // only run on PDF pages
  injectStyles();
  injectToggleButton();
  injectOverlay();
  applyTheme(theme);
  setActiveLevel(level);
}

// === Context Detection ===
function isPdfContext() {
  const url = window.location.href.toLowerCase();
  return url.includes('.pdf') || document.querySelector('embed[type="application/pdf"]') !== null;
}

// === Inject CSS ===
function injectStyles() {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = chrome.runtime.getURL('styles/main.css');
  document.head.appendChild(link);
}

// === Inject Toggle (below toolbar if present) ===
function injectToggleButton() {
  const btn = document.createElement('button');
  btn.id = 'explainer-toggle';
  btn.title = 'Toggle Explainer Mode';
  btn.innerHTML = icons.toggle + ' Explain';
  btn.addEventListener('click', toggleMode);
  positionBelowToolbar(btn);
}

function positionBelowToolbar(btn) {
  const toolbar = document.querySelector('#toolbar, .toolbar, .viewerToolbar, .pdf-toolbar, [role="toolbar"]');
  if (toolbar) {
    const top = toolbar.getBoundingClientRect().height + 8;
    positionFixed(btn, top);
  } else {
    positionFixed(btn, 12);
  }
  document.body.appendChild(btn);
}

function positionFixed(btn, top) {
  btn.style.cssText = `position: fixed; top: ${top}px; right: 12px; z-index: 1000000; padding: 6px 12px; display: flex; align-items: center; gap: 6px; font-size: 12px; font-family: sans-serif; background: #fff; border: 2px solid #000; cursor: pointer;`;
}

// === Inject Overlay ===
function injectOverlay() {
  const overlay = document.createElement('div');
  overlay.id = 'pdf-explain-overlay';
  overlay.setAttribute('data-theme', theme);
  overlay.setAttribute('data-level', level);
  overlay.innerHTML = `
    <div id="pdf-explain-header">
      <div id="pdf-explain-controls">
        <div id="level-selector">
          <button class="level-option" data-level="simple">Simple</button>
          <button class="level-option active" data-level="normal">Normal</button>
          <button class="level-option" data-level="technical">Technical</button>
        </div>
        <button id="theme-toggle">${theme === 'light' ? 'Light' : 'Dark'}</button>
      </div>
      <button id="explainer-toggle">ON</button>
    </div>
    <div id="pdf-explain-content"></div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('#explainer-toggle').addEventListener('click', toggleMode);
  overlay.querySelector('#theme-toggle').addEventListener('click', toggleTheme);
  overlay.querySelectorAll('.level-option').forEach(btn => {
    btn.addEventListener('click', (e) => setLevel(e.target.dataset.level));
  });
}

// === Toggle Mode ===
async function toggleMode() {
  mode = mode === 'pdf' ? 'explainer' : 'pdf';
  const overlay = document.getElementById('pdf-explain-overlay');
  const toggleBtn = document.getElementById('explainer-toggle');

  if (mode === 'explainer') {
    overlay.classList.add('active');
    toggleBtn.innerHTML = icons.toggle + ' Exit';
    await runExplainer();
  } else {
    overlay.classList.remove('active');
    toggleBtn.innerHTML = icons.toggle + ' Explain';
    if (abortController) abortController.abort();
  }
}

// === Main Pipeline (Slice 7: cancellation, dedup, lazy-load) ===
async function runExplainer() {
  if (abortController) abortController.abort();
  rewriteInProgress = true;

  // Dedup key: URL + pageNum + level
  const cacheKey = `${window.location.href}#${getCurrentPageNum()}_${level}`;
  if (rewriteCache.has(cacheKey)) {
    showText(rewriteCache.get(cacheKey));
    rewriteInProgress = false;
    return;
  }

  const myController = new AbortController();
  abortController = myController;
  const signal = myController.signal;

  try {
    await loadPDFJS(); // lazy-load library before extraction

    showText('(Extracting text from current page...)', 'state-loading');
    const rawText = await extractText();
    if (!rawText || rawText.trim().length === 0) {
      showText('(No readable text found on this page. This may be a scanned PDF or image-based page.)', 'state-empty');
      return;
    }

    const contentArea = document.getElementById('pdf-explain-content');
    contentArea.innerHTML = '';
    const container = document.createElement('div');
    container.className = 'extracted-text';
    contentArea.appendChild(container);

    // Stream tokens with batch updates (50ms)
    let buffer = '';
    let lastFlush = 0;
    for await (const token of streamRewrite(rawText, level, signal)) {
      buffer += token;
      const now = Date.now();
      if (now - lastFlush >= 50) {
        container.textContent = buffer;
        lastFlush = now;
      }
    }
    container.textContent = buffer; // final flush

    rewriteCache.set(cacheKey, buffer);
  } catch (err) {
    if (err.name === 'AbortError') return;
    console.error('[PDF Explain] pipeline error:', err);
    const errorMsg = (err && typeof err === 'object' && err.message) ? err.message : String(err);
    showErrorWithRetry(`Error: ${errorMsg}`);
  } finally {
    if (abortController === myController) abortController = null;
    rewriteInProgress = false;
  }
}

// === Helpers ===
async function loadPDFJS() {
  if (!window.pdfjsLib) {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('lib/pdf.js');
      script.onload = resolve;
      script.onerror = (e) => reject(new Error('Failed to load PDF.js library'));
      document.head.appendChild(script);
    });
  }
  // Always set workerSrc (overwrite if page already loaded PDF.js)
  if (window.pdfjsLib && window.pdfjsLib.GlobalWorkerOptions) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdf.worker.min.js');
  }
}

function showErrorWithRetry(message) {
  const area = document.getElementById('pdf-explain-content');
  if (!area) return;
  area.innerHTML = `<div class="state-error"><p>${escapeHtml(message)}</p><button id="retry-btn" class="retry-button">Try Again</button></div>`;
  document.getElementById('retry-btn').addEventListener('click', runExplainer);
}

// === Theme Toggle ===
function toggleTheme() {
  theme = theme === 'light' ? 'dark' : 'light';
  localStorage.setItem('explainer-theme', theme);
  applyTheme(theme);
  document.getElementById('theme-toggle').textContent = theme === 'light' ? 'Light' : 'Dark';
}

function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  const overlay = document.getElementById('pdf-explain-overlay');
  if (overlay) overlay.setAttribute('data-theme', t);
}

// === Level Selector ===
function setLevel(newLevel) {
  level = newLevel;
  localStorage.setItem('explainer-level', level);
  setActiveLevel(level);
  if (mode === 'explainer') runExplainer();
}

function setActiveLevel(activeLevel) {
  document.querySelectorAll('.level-option').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.level === activeLevel);
  });
  const overlay = document.getElementById('pdf-explain-overlay');
  if (overlay) overlay.setAttribute('data-level', activeLevel);
}

// === Display ===
function showText(text, className = '') {
  const area = document.getElementById('pdf-explain-content');
  if (!area) return;
  area.innerHTML = `<div class="extracted-text ${className}">${escapeHtml(text)}</div>`;
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML.replace(/\n/g, '<br>');
}

// ==========================================
//  Text Extraction (Slice 2 — multi-strategy)
// ==========================================
async function extractText() {
  await waitForPDFJS();
  return await tryExtractText();
}

function waitForPDFJS(timeout = 5000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (window.pdfjsLib && window.pdfjsLib.getDocument) resolve();
      else if (Date.now() - start > timeout) reject(new Error('PDF.js not loaded'));
      else setTimeout(check, 100);
    };
    check();
  });
}

// Try strategies in order: existing viewer → fetch+arrayBuffer → embed → blob → DOM fallback
async function tryExtractText() {
  // 1) Hook existing viewer (PDF.js viewer instance)
  const viewer = getPdfViewerInstance();
  if (viewer && (viewer.pdfDocument || viewer.pages)) {
    const page = await findCurrentPage(viewer);
    if (page) {
      const tc = await page.getTextContent();
      return tc.items.map(i => i.str).join(' ');
    }
  }

  // 2) Fetch PDF and feed as ArrayBuffer
  try {
    const resp = await fetch(window.location.href, { credentials: 'include' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const buf = await resp.arrayBuffer();
    const doc = await window.pdfjsLib.getDocument({ data: buf }).promise;
    const page = await doc.getPage(getCurrentPageNum());
    const tc = await page.getTextContent();
    return tc.items.map(i => i.str).join(' ');
  } catch (e) {
    console.warn('[PDF Explain] Strategy 2 (fetch+arrayBuffer) failed:', e);
  }

  // 3) Embedded <embed> fallback
  const embed = document.querySelector('embed[type="application/pdf"]');
  if (embed && embed.src) {
    try {
      const resp = await fetch(embed.src, { credentials: 'include' });
      if (resp.ok) {
        const buf = await resp.arrayBuffer();
        const doc = await window.pdfjsLib.getDocument({ data: buf }).promise;
        const page = await doc.getPage(getCurrentPageNum());
        const tc = await page.getTextContent();
        return tc.items.map(i => i.str).join(' ');
      }
    } catch (e) {
      console.warn('[PDF Explain] Strategy 3 (embed) failed:', e);
    }
  }

  // 4) Blob fallback
  try {
    const blob = await fetch(window.location.href).then(r => r.blob());
    const blobUrl = URL.createObjectURL(blob);
    const doc = await window.pdfjsLib.getDocument(blobUrl).promise;
    const page = await doc.getPage(getCurrentPageNum());
    const tc = await page.getTextContent();
    return tc.items.map(i => i.str).join(' ');
  } catch (e) {
    console.warn('[PDF Explain] Strategy 4 (blob) failed:', e);
  }

  // 5) DOM fallback — extract visible text from page (Chrome native viewer)
  const domText = extractTextFromDOM();
  if (domText) return domText;

  throw new Error('Text extraction failed; try a different PDF or viewer.');
}

// Fallback: grab visible text from document body, excluding extension UI
function extractTextFromDOM() {
  // Clone body to avoid mutating live DOM
  const clone = document.body.cloneNode(true);
  // Remove extension elements
  const extensionEls = clone.querySelectorAll('#explainer-toggle, #pdf-explain-overlay, .pdf-explain');
  extensionEls.forEach(el => el.remove());
  // Also try to remove common UI elements (toolbar, etc.)
  const uiSelectors = ['#toolbar', '.toolbar', '.viewerToolbar', '.pdf-toolbar', '[role="toolbar"]', '#header', '#footer'];
  uiSelectors.forEach(sel => {
    const els = clone.querySelectorAll(sel);
    els.forEach(el => el.remove());
  });
  // Get innerText (rendered text, respects line breaks)
  const text = clone.innerText || clone.textContent || '';
  // Collapse whitespace, limit length
  return text.replace(/\s+/g, ' ').trim().substring(0, 10000);
}
  }

  // 2) Fetch PDF and feed as ArrayBuffer (works cross-origin if server sends CORS headers)
  try {
    const resp = await fetch(window.location.href, { credentials: 'include' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const buf = await resp.arrayBuffer();
    const doc = await window.pdfjsLib.getDocument({ data: buf }).promise;
    const page = await doc.getPage(getCurrentPageNum());
    const tc = await page.getTextContent();
    return tc.items.map(i => i.str).join(' ');
  } catch (e) {
    console.warn('[PDF Explain] Strategy 2 (fetch+arrayBuffer) failed:', e);
  }

  // 3) Embedded <embed> fallback
  const embed = document.querySelector('embed[type="application/pdf"]');
  if (embed && embed.src) {
    try {
      const resp = await fetch(embed.src, { credentials: 'include' });
      if (resp.ok) {
        const buf = await resp.arrayBuffer();
        const doc = await window.pdfjsLib.getDocument({ data: buf }).promise;
        const page = await doc.getPage(getCurrentPageNum());
        const tc = await page.getTextContent();
        return tc.items.map(i => i.str).join(' ');
      }
    } catch (e) {
      console.warn('[PDF Explain] Strategy 3 (embed) failed:', e);
    }
  }

  // 4) Blob storage fallback
  try {
    const blob = await fetch(window.location.href).then(r => r.blob());
    const blobUrl = URL.createObjectURL(blob);
    const doc = await window.pdfjsLib.getDocument(blobUrl).promise;
    const page = await doc.getPage(getCurrentPageNum());
    const tc = await page.getTextContent();
    return tc.items.map(i => i.str).join(' ');
  } catch (e) {
    console.warn('[PDF Explain] Strategy 4 (blob) failed:', e);
  }

  throw new Error('Text extraction failed; try a different PDF or view.');
}

// === Viewer Helpers ===
function getPdfViewerInstance() {
  const candidates = [window.PDFViewer, window.pdfViewer, window.pdfView, window.pdfjsViewer, window.viewer];
  for (const c of candidates) {
    if (c && (c.pdfDocument || c.pages)) return c;
  }
  const div = document.getElementById('viewer') || document.getElementById('pdfViewer');
  return (div && div.pdfViewer) ? div.pdfViewer : null;
}

function getCurrentPageNum() {
  const hash = window.location.hash;
  const m = hash.match(/[?&]page=(\d+)/);
  if (m) return parseInt(m[1], 10);

  const viewer = getPdfViewerInstance();
  if (viewer && typeof viewer.currentPageNumber !== 'undefined') return viewer.currentPageNumber;
  if (window.pdfjsViewer && window.pdfjsViewer.currentPageNumber) return window.pdfjsViewer.currentPageNumber;

  return 1;
}

async function findCurrentPage(viewer) {
  const num = getCurrentPageNum();
  if (viewer.pages) return viewer.pages[num];
  if (viewer.pdfDocument && typeof viewer.pdfDocument.getPage === 'function') return viewer.pdfDocument.getPage(num);
  if (window.currentPdfDoc) return window.currentPdfDoc.getPage(num);
  return null;
}

// ==========================================
//  LLM Proxy via Cloudflare Worker (Slice 3–4)
// ==========================================
const PROXY_ENDPOINT = 'https://open-pdf.shivamkumar10958.workers.dev';

async function* streamRewrite(text, level, signal) {
  const response = await fetch(PROXY_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, level }),
    signal,
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Proxy error ${response.status}: ${err}`);
  }

  // Worker streams plain text tokens directly (no SSE formatting)
  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      yield decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}
