/**
 * PDF Explain — Content Script (Robustness & Edge Cases)
 * Slices 1–7: UI, Extraction, Streaming, Level Control, Errors, Performance
 * Phase 1: Context invalidation fixes, blob cleanup, enhanced cleanup
 * Phase 2: Error handling, retry logic, operation queue, timeouts
 * Phase 3: Cache limits, progress indicator, browser compatibility
 */

// === Icons ===
const icons = {
  toggle: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>`,
  sun: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>`,
  moon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>`,
  spinner: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" stroke-opacity="0.25"></circle><path d="M12 2a10 10 0 0 1 10 10" stroke-linecap="round"></path></svg>`,
};

// === LRU Cache ===
class LRUCache {
  constructor(maxSize = 50) {
    this.maxSize = maxSize;
    this.cache = new Map();
  }

  get(key) {
    if (!this.cache.has(key)) return undefined;
    const value = this.cache.get(key);
    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  set(key, value) {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Remove least recently used (first key)
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }

  has(key) {
    return this.cache.has(key);
  }

  delete(key) {
    return this.cache.delete(key);
  }

  clear() {
    this.cache.clear();
  }

  get size() {
    return this.cache.size;
  }
}

// === Operation Queue ===
class OperationQueue {
  constructor() {
    this.queue = [];
    this.running = false;
    this.currentOperation = null;
  }

  async enqueue(fn, priority = 0) {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, resolve, reject, priority });
      // Sort by priority (higher first)
      this.queue.sort((a, b) => b.priority - a.priority);
      this.process();
    });
  }

  async process() {
    if (this.running || this.queue.length === 0) return;
    this.running = true;

    while (this.queue.length > 0) {
      const item = this.queue.shift();
      this.currentOperation = item;
      try {
        const result = await item.fn();
        item.resolve(result);
      } catch (err) {
        item.reject(err);
      } finally {
        this.currentOperation = null;
      }
    }

    this.running = false;
  }

  cancelAll() {
    this.queue = [];
    if (this.currentOperation) {
      // Can't cancel running op, but won't start new ones
    }
  }

  clear() {
    this.queue = [];
    this.running = false;
    this.currentOperation = null;
  }
}

// === State ===
let mode = 'pdf';
let level = localStorage.getItem('explainer-level') || 'normal';
let theme = localStorage.getItem('explainer-theme') || 'light';

// Phase 1: Context invalidation protection
let abortController = null;
let streamAbortController = null;
let isInitializing = false;
let isExtracting = false;
let isStreaming = false;
let isButtonDisabled = false;

// Phase 1: Blob URL tracking
const blobUrls = new Set();

// Phase 3: LRU cache
const rewriteCache = new LRUCache(50);

// Phase 2: Operation queue
const operationQueue = new OperationQueue();

// Phase 1: Cleanup registry
const cleanupHandlers = new Set();

// Phase 2: Viewer detection
let detectedViewer = null;

// === Init ===
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// === Enhanced Cleanup (Phase 1) ===
function registerCleanup(fn) {
  cleanupHandlers.add(fn);
}

function cleanup() {
  console.log('[PDF Explain] Running cleanup');

  // Abort all operations
  if (abortController) {
    abortController.abort();
    abortController = null;
  }
  if (streamAbortController) {
    streamAbortController.abort();
    streamAbortController = null;
  }

  // Run all registered cleanup handlers
  for (const fn of cleanupHandlers) {
    try {
      fn();
    } catch (e) {
      console.warn('[PDF Explain] Cleanup handler error:', e);
    }
  }
  cleanupHandlers.clear();

  // Revoke all blob URLs
  revokeAllBlobUrls();

  // Reset state flags
  isInitializing = false;
  isExtracting = false;
  isStreaming = false;
  isButtonDisabled = false;

  // Clear operation queue
  operationQueue.clear();

  // Notify background worker
  try {
    chrome.runtime.sendMessage({ type: 'pdf-explain-cleanup' }).catch(() => {});
  } catch (e) {}
}

function revokeAllBlobUrls() {
  for (const url of blobUrls) {
    try {
      URL.revokeObjectURL(url);
    } catch (e) {
      // Already revoked
    }
  }
  blobUrls.clear();
}

function trackBlobUrl(url) {
  blobUrls.add(url);
}

// Phase 1: Visibility-aware handlers
function setupVisibilityHandlers() {
  const onVisibilityChange = () => {
    if (document.hidden && isStreaming) {
      // Pause streaming when page hidden
      console.log('[PDF Explain] Page hidden, pausing operations');
    }
  };

  const onPageHide = () => {
    cleanup();
  };

  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('beforeunload', cleanup);
  window.addEventListener('unload', cleanup);

  registerCleanup(() => {
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('beforeunload', cleanup);
    window.removeEventListener('unload', cleanup);
  });
}

// Phase 2: Timeout wrapper
function withTimeout(promise, ms, message = 'Operation timed out') {
  const timeout = new Promise((_, reject) => {
    const id = setTimeout(() => {
      clearTimeout(id);
      reject(new Error(message));
    }, ms);
  });
  return Promise.race([promise, timeout]);
}

async function init() {
  if (!isPdfContext()) return;

  isInitializing = true;

  try {
    setupVisibilityHandlers();
    injectStyles();
    await injectToggleButton();
    injectOverlay();
    applyTheme(theme);
    setActiveLevel(level);
  } finally {
    isInitializing = false;
  }
}

// === Context Detection ===
function isPdfContext() {
  const url = window.location.href.toLowerCase();
  return url.includes('.pdf') || document.querySelector('embed[type="application/pdf"]') !== null;
}

// === Viewer Detection (Phase 3) ===
function detectViewer() {
  if (detectedViewer) return detectedViewer;

  const url = window.location.href.toLowerCase();
  const ua = navigator.userAgent;

  // Check for Chrome native PDF viewer
  if (url.includes('.pdf') && !document.querySelector('#viewer .page')) {
    // Check if it's Chrome's built-in PDF viewer
    if (document.querySelector('embed[type="application/pdf"]') ||
        document.querySelector('object[type="application/pdf"]')) {
      detectedViewer = 'chrome-native';
    } else if (document.getElementById('viewer') && document.querySelector('.page')) {
      detectedViewer = 'pdfjs';
    }
  }

  // Check for PDF.js viewer
  if (document.getElementById('pdf-viewer') ||
      (window.PDFViewerApplication && window.PDFViewerApplication.pdfViewer)) {
    detectedViewer = 'pdfjs';
  }

  // Check for Edge PDF viewer
  if (document.querySelector('.chrome-pdf-toolbar') ||
      document.getElementById('pdfViewer')) {
    detectedViewer = 'edge';
  }

  // Check for Firefox PDF.js
  if (ua.includes('firefox') && document.querySelector('.pdfViewer')) {
    detectedViewer = 'pdfjs';
  }

  if (!detectedViewer) {
    detectedViewer = 'unknown';
  }

  console.log(`[PDF Explain] Detected viewer: ${detectedViewer}`);
  return detectedViewer;
}

// === Inject CSS ===
function injectStyles() {
  if (document.getElementById('pdf-explain-styles')) return;
  const link = document.createElement('link');
  link.id = 'pdf-explain-styles';
  link.rel = 'stylesheet';
  link.href = chrome.runtime.getURL('styles/main.css');
  document.head.appendChild(link);
}

// === Inject Toggle (Phase 2: Improved Placement) ===
async function injectToggleButton() {
  const btn = document.createElement('button');
  btn.id = 'explainer-toggle';
  btn.title = 'Toggle Explainer Mode';
  btn.setAttribute('aria-label', 'Toggle PDF Explain mode');
  updateButtonText(btn);
  btn.addEventListener('click', toggleMode);

  // Phase 2: Expanded toolbar selectors
  const toolbarSelectors = [
    '#toolbar',
    '.toolbar',
    '.viewerToolbar',
    '.pdf-toolbar',
    '[role="toolbar"]',
    '.pdfViewer .toolbar',
    '#pdf-viewer-toolbar',
    '.chrome-pdf-toolbar',
    '.pdf-controls',
    '.pdf-toolbar',
    '.PDFViewerApplication .toolbar',
  ];

  let toolbar = null;
  for (const selector of toolbarSelectors) {
    toolbar = document.querySelector(selector);
    if (toolbar) break;
  }

  // Phase 2: Try to find button container within toolbar
  if (toolbar) {
    const buttonContainer = toolbar.querySelector('.buttons, .toolButtons, .toolbarGroup') || toolbar;
    buttonContainer.appendChild(btn);
    btn.classList.add('injected-in-toolbar');
    console.log('[PDF Explain] Button injected into toolbar');
  } else {
    // Phase 2: Fallback to fixed position
    positionFixed(btn, 12);
    document.body.appendChild(btn);
    console.log('[PDF Explain] Button using fixed position fallback');
  }

  // Phase 2: MutationObserver for dynamic toolbar
  setupToolbarObserver(btn);
}

// Phase 2: MutationObserver for late-appearing toolbar
function setupToolbarObserver(fallbackBtn) {
  const observer = new MutationObserver((mutations) => {
    const existingBtn = document.getElementById('explainer-toggle');
    if (!existingBtn || existingBtn.classList.contains('injected-in-toolbar')) {
      return;
    }

    const toolbarSelectors = [
      '#toolbar', '.toolbar', '.viewerToolbar', '.pdf-toolbar',
      '[role="toolbar"]', '.pdfViewer .toolbar',
    ];

    for (const selector of toolbarSelectors) {
      const toolbar = document.querySelector(selector);
      if (toolbar && !toolbar.querySelector('#explainer-toggle')) {
        const buttonContainer = toolbar.querySelector('.buttons, .toolButtons, .toolbarGroup') || toolbar;
        // Move button to toolbar
        existingBtn.remove();
        buttonContainer.appendChild(existingBtn);
        existingBtn.classList.add('injected-in-toolbar');
        console.log('[PDF Explain] Button moved to newly detected toolbar');
        observer.disconnect();
        return;
      }
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  registerCleanup(() => observer.disconnect());
}

function positionFixed(btn, bottomPx) {
  btn.style.cssText = `
    position: fixed;
    bottom: ${bottomPx}px;
    right: 12px;
    z-index: 999998;
    box-shadow: 0 2px 8px rgba(0,0,0,0.2);
  `;
}

function updateButtonText(btn) {
  if (isButtonDisabled) {
    btn.innerHTML = icons.spinner + ' Loading...';
    btn.disabled = true;
  } else if (mode === 'explainer') {
    btn.innerHTML = icons.toggle + ' Exit';
    btn.disabled = false;
  } else {
    btn.innerHTML = icons.toggle + ' Explain';
    btn.disabled = false;
  }
}

function setButtonLoading(loading) {
  isButtonDisabled = loading;
  const btn = document.getElementById('explainer-toggle');
  const overlayBtn = document.getElementById('pdf-explain-overlay')?.querySelector('#explainer-toggle');
  if (btn) updateButtonText(btn);
  if (overlayBtn) updateButtonText(overlayBtn);
}

// === Inject Overlay ===
function injectOverlay() {
  if (document.getElementById('pdf-explain-overlay')) return;

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
  if (isButtonDisabled) return;

  mode = mode === 'pdf' ? 'explainer' : 'pdf';
  const overlay = document.getElementById('pdf-explain-overlay');
  const toggleBtn = document.getElementById('explainer-toggle');

  if (mode === 'explainer') {
    overlay.classList.add('active');
    updateButtonText(toggleBtn);
    await runExplainer();
  } else {
    overlay.classList.remove('active');
    updateButtonText(toggleBtn);
    // Cancel any ongoing operations
    if (abortController) abortController.abort();
    if (streamAbortController) streamAbortController.abort();
  }
}

// === Main Pipeline (Phase 1, 2, 3) ===
async function runExplainer() {
  // Phase 2: Operation queue to prevent race conditions
  await operationQueue.enqueue(async () => {
    if (isExtracting || isStreaming) {
      console.log('[PDF Explain] Operation already in progress, skipping');
      return;
    }

    // Cancel any previous operations
    if (abortController) abortController.abort();
    if (streamAbortController) streamAbortController.abort();

    abortController = new AbortController();
    const signal = abortController.signal;
    isExtracting = true;
    setButtonLoading(true);

    // Dedup key: URL + pageNum + level
    const cacheKey = `${window.location.href}#${getCurrentPageNum()}_${level}`;
    const cached = rewriteCache.get(cacheKey);
    if (cached) {
      console.log('[PDF Explain] Using cached result');
      showText(cached);
      isExtracting = false;
      setButtonLoading(false);
      return;
    }

    try {
      // Phase 2: Timeout for loading PDF.js (30s)
      await withTimeout(loadPDFJS(), 30000, 'PDF.js library failed to load');

      showText('(Extracting text from current page...)', 'state-loading');

      // Phase 2: Timeout for extraction (30s)
      const rawText = await withTimeout(extractText(), 30000, 'Text extraction timed out');

      if (!rawText || rawText.trim().length === 0) {
        showText('(No readable text found on this page. This may be a scanned PDF or image-based page.)', 'state-empty');
        isExtracting = false;
        setButtonLoading(false);
        return;
      }

      const contentArea = document.getElementById('pdf-explain-content');
      contentArea.innerHTML = '';
      const container = document.createElement('div');
      container.className = 'extracted-text';
      contentArea.appendChild(container);

      // Phase 1: Use background worker for streaming
      isStreaming = true;
      await streamWithBackgroundWorker(rawText, level, container, signal);

      isStreaming = false;
      setButtonLoading(false);
      isExtracting = false;
      abortController = null;
    } catch (err) {
      isStreaming = false;
      setButtonLoading(false);
      isExtracting = false;
      abortController = null;

      if (err.name === 'AbortError') {
        console.log('[PDF Explain] Operation aborted');
        return;
      }

      console.error('[PDF Explain] pipeline error:', err);
      handleError(err);
    }
  }, 10); // Priority 10
}

// === Phase 1: Background Worker Streaming ===
async function streamWithBackgroundWorker(text, level, container, signal) {
  return new Promise((resolve, reject) => {
    const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    let buffer = '';
    let tokenCount = 0;
    let lastFlush = 0;
    let progressInterval = null;

    // Phase 3: Progress indicator
    const progressEl = createProgressIndicator();
    container.appendChild(progressEl);

    const port = chrome.runtime.connect({ name: 'pdf-explain-stream' });
    streamAbortController = new AbortController();

    const cleanup = () => {
      if (progressInterval) {
        clearInterval(progressInterval);
        progressInterval = null;
      }
      try {
        port.disconnect();
      } catch (e) {}
    };

    registerCleanup(cleanup);

    const handleMessage = (msg) => {
      if (msg.requestId !== requestId) return;

      switch (msg.type) {
        case 'stream-chunk':
          buffer += msg.chunk;
          tokenCount = msg.tokenCount || tokenCount;

          // Phase 3: Update progress indicator
          updateProgressIndicator(progressEl, tokenCount, msg.duration);

          // Phase 3: Batch updates with requestAnimationFrame
          const now = Date.now();
          if (now - lastFlush >= 100) {
            container.textContent = buffer;
            container.appendChild(progressEl);
            lastFlush = now;
          }
          break;

        case 'stream-complete':
          container.textContent = buffer;
          container.removeChild(progressEl);
          
          // Cache the result
          const cacheKey = `${window.location.href}#${getCurrentPageNum()}_${level}`;
          rewriteCache.set(cacheKey, buffer);

          cleanup();
          resolve();
          break;

        case 'stream-error':
          container.removeChild(progressEl);
          cleanup();
          if (msg.error) {
            reject(new Error(`${msg.error.category}: ${msg.error.message}`));
          } else {
            reject(new Error('Streaming error'));
          }
          break;

        case 'stream-aborted':
          container.removeChild(progressEl);
          cleanup();
          reject(new Error('AbortError'));
          break;

        case 'stream-retry':
          console.log(`[PDF Explain] Retry attempt ${msg.attempt}/${msg.maxAttempts}`);
          break;
      }
    };

    port.onMessage.addListener(handleMessage);
    port.onDisconnect.addListener(() => {
      if (chrome.runtime.lastError) {
        console.log('[PDF Explain] Port disconnected:', chrome.runtime.lastError.message);
      }
    });

    // Send the streaming request
    port.postMessage({
      type: 'stream-extract',
      text,
      level,
      requestId,
    });

    // Phase 2: Watch for abort signal
    signal?.addEventListener('abort', () => {
      port.postMessage({ type: 'stream-cancel', requestId });
      cleanup();
      reject(new Error('AbortError'));
    });

    // Phase 2: Overall timeout (60s)
    const timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error('STREAM_TIMEOUT: Streaming timed out after 60 seconds'));
    }, 60000);

    // Clean up timeout on completion
    const originalResolve = resolve;
    resolve = (...args) => {
      clearTimeout(timeoutId);
      originalResolve(...args);
    };
    const originalReject = reject;
    reject = (...args) => {
      clearTimeout(timeoutId);
      originalReject(...args);
    };
  });
}

// Phase 3: Progress indicator
function createProgressIndicator() {
  const el = document.createElement('div');
  el.className = 'stream-progress';
  el.style.cssText = `
    padding: 8px 12px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 4px;
    margin-bottom: 12px;
    font-family: var(--font-sans);
    font-size: 12px;
    color: var(--text-secondary);
    display: flex;
    align-items: center;
    gap: 8px;
  `;
  el.innerHTML = `
    <span class="stream-spinner">${icons.spinner}</span>
    <span class="stream-text">Generating explanation...</span>
    <span class="stream-tokens"></span>
  `;
  return el;
}

function updateProgressIndicator(el, tokenCount, duration) {
  const tokensEl = el.querySelector('.stream-tokens');
  const textEl = el.querySelector('.stream-text');
  if (tokensEl) {
    tokensEl.textContent = `(${tokenCount} chars`;
    if (duration > 1000) {
      const tps = (tokenCount / (duration / 1000)).toFixed(0);
      tokensEl.textContent += `, ${tps}/s`;
    }
    tokensEl.textContent += ')';
  }
}

// === Fallback: Direct streaming (if background worker unavailable) ===
async function* streamRewrite(text, level, signal) {
  const response = await fetch('https://open-pdf.shivamkumar10958.workers.dev', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, level }),
    signal,
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Proxy error ${response.status}: ${err}`);
  }

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
  if (window.pdfjsLib && window.pdfjsLib.GlobalWorkerOptions) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdf.worker.min.js');
  }
}

// === Error Handling (Phase 2) ===
function handleError(err) {
  const errorInfo = categorizeError(err);
  const message = formatErrorMessage(err);
  const contentArea = document.getElementById('pdf-explain-content');

  if (!contentArea) return;

  console.error(`[PDF Explain] ${errorInfo.category}:`, err);

  switch (errorInfo.category) {
    case 'NETWORK_ERROR':
      showErrorWithRetry(
        'Unable to connect to the AI service. Check your internet connection.',
        true
      );
      break;
    case 'RATE_LIMIT':
      showErrorWithRetry(
        'Too many requests. Please wait a few minutes before trying again.',
        false
      );
      break;
    case 'EXTRACTION_ERROR':
      showErrorWithRetry(
        'Could not read this PDF. It may be a scanned document or corrupted file.',
        true
      );
      break;
    case 'LLM_ERROR':
      // Phase 3: Graceful degradation - show extracted text
      const cached = rewriteCache.get(`${window.location.href}#${getCurrentPageNum()}_${level}`);
      if (cached) {
        showText(cached);
      } else {
        showErrorWithRetry(
          'AI service temporarily unavailable. Showing original text instead.',
          true
        );
      }
      break;
    default:
      showErrorWithRetry(message, true);
  }
}

function categorizeError(err) {
  if (!err) return { category: 'UNKNOWN_ERROR', message: 'An unknown error occurred.' };
  const msg = String(err.message || err).toUpperCase();
  if (msg.includes('RATE_LIMIT') || msg.includes('429')) {
    return { category: 'RATE_LIMIT', message: 'Too many requests.' };
  }
  if (msg.includes('NETWORK') || msg.includes('FETCH') || msg.includes('ABORT') || msg.includes('TIMEOUT')) {
    return { category: 'NETWORK_ERROR', message: 'Network or timeout error.' };
  }
  if (msg.includes('EXTRACTION') || msg.includes('PDF') || msg.includes('TEXT')) {
    return { category: 'EXTRACTION_ERROR', message: 'Text extraction failed.' };
  }
  return { category: 'LLM_ERROR', message: 'AI service error.' };
}

function formatErrorMessage(err) {
  if (!err) return 'An unknown error occurred.';
  const msg = String(err.message || err);
  if (msg.includes('RATE_LIMIT')) return 'Too many requests. Please wait.';
  if (msg.includes('ABORT')) return 'Request was cancelled.';
  if (msg.includes('NETWORK') || msg.includes('FETCH')) return 'Unable to connect. Check your internet.';
  if (msg.includes('TIMEOUT')) return 'The request timed out.';
  if (msg.includes('429')) return 'Too many requests.';
  return `Error: ${msg}`;
}

function showErrorWithRetry(message, showRetry) {
  const area = document.getElementById('pdf-explain-content');
  if (!area) return;
  area.innerHTML = `
    <div class="state-error">
      <p>${escapeHtml(message)}</p>
      ${showRetry ? '<button id="retry-btn" class="retry-button">Try Again</button>' : ''}
    </div>
  `;
  if (showRetry) {
    document.getElementById('retry-btn').addEventListener('click', () => {
      // Clear cache for this page to force re-extraction
      const cacheKey = `${window.location.href}#${getCurrentPageNum()}_${level}`;
      rewriteCache.delete(cacheKey);
      runExplainer();
    });
  }
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
//  Text Extraction (Multi-strategy with Phase 3 improvements)
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

// Phase 3: Enhanced extraction with retry, CORS handling, scanned detection
async function tryExtractText() {
  // Phase 3: Detect viewer type
  detectedViewer = detectViewer();

  // Strategy 1: Hook existing viewer (PDF.js viewer instance)
  const viewer = getPdfViewerInstance();
  if (viewer && (viewer.pdfDocument || viewer.pages)) {
    try {
      const page = await findCurrentPage(viewer);
      if (page) {
        const tc = await page.getTextContent();
        const text = tc.items.map(i => i.str).join(' ');
        if (text && text.trim().length > 0) {
          return text;
        }
      }
    } catch (e) {
      console.warn('[PDF Explain] Strategy 1 (viewer hook) failed:', e);
    }
  }

  // Strategy 2: Fetch PDF and feed as ArrayBuffer (with CORS retry)
  const pageNum = getCurrentPageNum();
  const fetchStrategies = [
    { url: window.location.href, credentials: 'include' },
    { url: window.location.href, credentials: 'omit' },
  ];

  // Phase 3: Try embed src too
  const embed = document.querySelector('embed[type="application/pdf"]');
  if (embed && embed.src) {
    fetchStrategies.unshift({ url: embed.src, credentials: 'include' });
    fetchStrategies.unshift({ url: embed.src, credentials: 'omit' });
  }

  for (let i = 0; i < fetchStrategies.length; i++) {
    const strategy = fetchStrategies[i];
    try {
      const resp = await withTimeout(
        fetch(strategy.url, { credentials: strategy.credentials }),
        15000,
        'Fetch timeout'
      );
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const buf = await resp.arrayBuffer();
      const doc = await window.pdfjsLib.getDocument({ data: buf }).promise;
      const page = await doc.getPage(pageNum);
      const tc = await page.getTextContent();
      const text = tc.items.map(i => i.str).join(' ');
      if (text && text.trim().length > 0) {
        return text;
      }
    } catch (e) {
      console.warn(`[PDF Explain] Strategy 2 (fetch ${i}) failed:`, e.message);
    }
  }

  // Strategy 3: Blob fallback (with URL tracking for cleanup)
  try {
    const resp = await withTimeout(
      fetch(window.location.href),
      15000,
      'Blob fetch timeout'
    );
    const blob = await resp.blob();
    const blobUrl = URL.createObjectURL(blob);
    trackBlobUrl(blobUrl); // Track for cleanup
    
    const doc = await window.pdfjsLib.getDocument(blobUrl).promise;
    const page = await doc.getPage(pageNum);
    const tc = await page.getTextContent();
    const text = tc.items.map(i => i.str).join(' ');
    
    // Revoke after use (but keep in set in case of reuse)
    setTimeout(() => {
      try { URL.revokeObjectURL(blobUrl); } catch (e) {}
      blobUrls.delete(blobUrl);
    }, 5000);
    
    if (text && text.trim().length > 0) {
      return text;
    }
  } catch (e) {
    console.warn('[PDF Explain] Strategy 3 (blob) failed:', e.message);
  }

  // Strategy 4: DOM fallback — extract visible text (Chrome native viewer)
  const domText = extractTextFromDOM();
  if (domText) {
    return domText;
  }

  // Phase 3: Scanned/image detection
  throw new Error('EXTRACTION_ERROR: No readable text found. This appears to be a scanned document or image-based PDF.');
}

// Fallback: grab visible text from document body
function extractTextFromDOM() {
  const clone = document.body.cloneNode(true);
  const extensionEls = clone.querySelectorAll('#explainer-toggle, #pdf-explain-overlay, .pdf-explain');
  extensionEls.forEach(el => el.remove());
  const uiSelectors = ['#toolbar', '.toolbar', '.viewerToolbar', '.pdf-toolbar', '[role="toolbar"]', '#header', '#footer', '#viewer', '.pdfViewer'];
  uiSelectors.forEach(sel => {
    const els = clone.querySelectorAll(sel);
    els.forEach(el => el.remove());
  });
  const text = clone.innerText || clone.textContent || '';
  const cleaned = text.replace(/\s+/g, ' ').trim().substring(0, 10000);
  return cleaned.length > 100 ? cleaned : null;
}

// === Viewer Helpers (Phase 3: Enhanced) ===
function getPdfViewerInstance() {
  const candidates = [
    window.PDFViewer, window.pdfViewer, window.pdfView,
    window.pdfjsViewer, window.viewer,
    document.getElementById('pdfViewer'),
    document.getElementById('viewer'),
  ];
  for (const c of candidates) {
    if (c && (c.pdfDocument || c.pages || c.pdfViewer)) {
      return c.pdfViewer || c;
    }
  }
  // Check for PDF.js app
  if (window.PDFViewerApplication) {
    return window.PDFViewerApplication.pdfViewer;
  }
  return null;
}

function getCurrentPageNum() {
  // Check URL hash: #page=N or &page=N
  const hash = window.location.hash;
  if (hash) {
    const m = hash.match(/[?&]page=(\d+)/) || hash.match(/page=(\d+)/);
    if (m) return Math.max(1, parseInt(m[1], 10));
  }

  // Check viewer instance
  const viewer = getPdfViewerInstance();
  if (viewer) {
    if (typeof viewer.currentPageNumber !== 'undefined') {
      return Math.max(1, viewer.currentPageNumber);
    }
    if (typeof viewer.page !== 'undefined') {
      return Math.max(1, viewer.page);
    }
  }

  // Check global PDF.js viewer
  if (window.pdfjsViewer && window.pdfjsViewer.currentPageNumber) {
    return Math.max(1, window.pdfjsViewer.currentPageNumber);
  }

  // Check DOM for page indicator
  const pageInput = document.querySelector('input[type="number"][value]');
  if (pageInput) {
    const val = parseInt(pageInput.value, 10);
    if (val > 0) return val;
  }

  // Check for page element with data attribute
  const pageEl = document.querySelector('[data-page-number]');
  if (pageEl) {
    const val = parseInt(pageEl.dataset.pageNumber, 10);
    if (val > 0) return val;
  }

  return 1;
}

async function findCurrentPage(viewer) {
  const num = getCurrentPageNum();
  try {
    if (viewer.pages && viewer.pages[num]) return viewer.pages[num];
    if (viewer.pdfDocument && typeof viewer.pdfDocument.getPage === 'function') {
      return viewer.pdfDocument.getPage(num);
    }
    if (window.currentPdfDoc && typeof window.currentPdfDoc.getPage === 'function') {
      return window.currentPdfDoc.getPage(num);
    }
  } catch (e) {
    console.warn('[PDF Explain] findCurrentPage error:', e);
  }
  return null;
}
