/**
 * open-pdf content script
 *
 * Full Hijack strategy:
 * - hide Chrome's native PDF embed
 * - mount a custom reader UI directly under document.body
 * - render extracted page text or streamed explanation inside the custom UI
 */

const LEVELS = ['normal', 'simple', 'technical'];
const DEFAULT_LEVEL = 'normal';
const STREAM_FLUSH_MS = 80;

const icons = {
  sparkle: `
    <svg class="open-pdf-icon-sparkle" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m0-12.728l.707.707m11.314 11.314l.707.707M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z" />
    </svg>
  `,
  external: `
    <svg class="open-pdf-icon-external" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  `,
  peek: `
    <svg class="open-pdf-icon-peek" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  `,
  lock: `
    <svg class="open-pdf-icon-lock" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
      <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
    </svg>
  `,
  spinner: `
    <svg class="open-pdf-spinner" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9"></circle>
      <path d="M21 12a9 9 0 0 0-9-9"></path>
    </svg>
  `,
};

const state = {
  mode: 'pdf',
  level: DEFAULT_LEVEL,
  peek: false,
  localAI: false,
  root: null,
  nativeEmbed: null,
  nativeObject: null,
  pdfDocument: null,
  pdfTitle: 'Research Paper.pdf',
  pageNumber: 1,
  pageCount: null,
  originalText: '',
  initialized: false,
  loadingOriginal: false,
  streaming: false,
  currentPort: null,
  currentRequestId: null,
  streamAbortController: null,
  streamRunId: 0,
};

if (window.pdfjsLib?.GlobalWorkerOptions) {
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdf.worker.min.js');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}

async function init() {
  if (state.initialized || !isPdfContext()) return;

  state.initialized = true;

  if (window.location.protocol === 'file:') {
    const hasAccess = await checkFilePermissions();
    if (!hasAccess) {
      showFileOnboarding();
      return;
    }
  }

  state.nativeEmbed = findNativePdfEmbed();
  state.nativeObject = document.querySelector('object[type="application/pdf"]');
  state.pdfTitle = derivePdfTitle();
  state.pageNumber = getCurrentPageNum();

  injectStyles();
  hijackNativeViewer();
  mountOpenPdfRoot();
  attachRootEvents();
  renderShell();
  setupCleanupHandlers();

  await loadOriginalText();
}

async function checkFilePermissions() {
  return new Promise((resolve) => {
    chrome.extension.isAllowedFileSchemeAccess((isAllowed) => {
      resolve(isAllowed);
    });
  });
}

function showFileOnboarding() {
  injectStyles();
  const root = document.createElement('div');
  root.id = 'open-pdf-onboarding';
  root.innerHTML = `
    <div class="open-pdf-onboarding-card">
      <h2>Unlock Local PDF Support</h2>
      <p>To use PDF Explainer with files from your computer, you need to enable "Allow access to file URLs" in Chrome settings.</p>
      <ol>
        <li>Click the puzzle icon or go to <strong>chrome://extensions</strong></li>
        <li>Find <strong>PDF Explain</strong> and click <strong>Details</strong></li>
        <li>Toggle <strong>Allow access to file URLs</strong> to ON</li>
        <li>Reload this page</li>
      </ol>
      <button onclick="window.location.reload()">I've enabled it, reload page</button>
    </div>
  `;
  document.body.appendChild(root);
}

function isPdfContext() {
  if (window.IS_ISOLATED_READER) return true;
  const url = window.location.href.toLowerCase();
  return url.includes('.pdf') || Boolean(findNativePdfEmbed());
}

function findNativePdfEmbed() {
  return (
    document.querySelector('embed[type="application/pdf"]') ||
    document.querySelector('embed[type*="pdf" i]') ||
    document.getElementById('native-pdf-embed')
  );
}

function hijackNativeViewer() {
  const targets = [state.nativeEmbed, state.nativeObject].filter(Boolean);

  for (const target of targets) {
    target.style.setProperty('position', 'fixed', 'important');
    target.style.setProperty('inset', '0', 'important');
    target.style.setProperty('width', '100vw', 'important');
    target.style.setProperty('height', '100vh', 'important');
    target.style.setProperty('z-index', '-1', 'important'); // Behind by default
    target.setAttribute('aria-hidden', 'true');
  }

  document.documentElement.classList.add('open-pdf-hijacked');
  document.body.classList.add('open-pdf-hijacked');
}

function syncNativeViewerPage() {
  const targets = [state.nativeEmbed, state.nativeObject].filter(Boolean);
  
  for (const target of targets) {
    const currentSrc = target.src || target.data;
    if (!currentSrc) continue;

    try {
      const url = new URL(currentSrc, window.location.href);
      const newHash = `page=${state.pageNumber}`;
      
      // Only update if hash is different to avoid unnecessary reloads
      if (url.hash !== `#${newHash}`) {
        url.hash = newHash;
        if (target.src) target.src = url.href;
        if (target.data) target.data = url.href;
      }
    } catch (err) {
      console.warn('[open-pdf] Could not sync native viewer page:', err);
    }
  }
}

function injectStyles() {
  if (document.getElementById('open-pdf-styles')) return;

  const link = document.createElement('link');
  link.id = 'open-pdf-styles';
  link.rel = 'stylesheet';
  link.href = chrome.runtime.getURL('styles/main.css');
  document.head.appendChild(link);
}

function mountOpenPdfRoot() {
  const existing = document.getElementById('open-pdf-root');
  if (existing) {
    state.root = existing;
    return;
  }

  const root = document.createElement('main');
  root.id = 'open-pdf-root';
  root.setAttribute('data-mode', state.mode);
  root.setAttribute('data-level', state.level);
  root.setAttribute('aria-label', 'open-pdf reader');
  document.body.appendChild(root);
  state.root = root;
}

function renderShell() {
  if (!state.root) return;

  state.root.dataset.mode = state.mode;
  state.root.dataset.level = state.level;
  state.root.dataset.peek = state.peek;
  
  state.root.innerHTML = `
    <section class="open-pdf-shell" aria-label="PDF reader">
      <header class="open-pdf-header">
        <div class="open-pdf-document-info">
          <h1 class="open-pdf-title">${escapeHtml(state.pdfTitle)}</h1>
          <p class="open-pdf-subtitle">${escapeHtml(getPageLabel())}</p>
        </div>

        <nav class="open-pdf-controls" aria-label="Reader controls">
          <div class="open-pdf-levels" role="group" aria-label="Explainer depth">
            ${LEVELS.map(renderLevelButton).join('')}
          </div>

          ${window.IS_ISOLATED_READER ? `
          <button class="open-pdf-local-toggle" type="button" data-action="toggle-local" title="Use Private Local AI" aria-pressed="${state.localAI}">
            ${icons.lock}
          </button>
          ` : ''}

          <button class="open-pdf-peek-toggle" type="button" data-action="toggle-peek" aria-pressed="${state.peek}">
            ${icons.peek}
          </button>

          ${window.IS_ISOLATED_READER ? '' : `
          <button class="open-pdf-isolated-toggle" type="button" data-action="open-isolated" title="Open in isolated reader">
            ${icons.external}
          </button>
          `}
        </nav>
      </header>

      <section id="open-pdf-content" class="open-pdf-content" aria-live="polite"></section>
    </section>
  `;

  renderReaderContent();
}

function renderLevelButton(level) {
  const label = level[0].toUpperCase() + level.slice(1);
  const isActive = state.level === level;

  return `
    <button
      class="open-pdf-level${isActive ? ' is-active' : ''}"
      type="button"
      data-level="${level}"
      aria-pressed="${isActive}"
    >${label}</button>
  `;
}

function togglePeek(force) {
  state.peek = typeof force === 'boolean' ? force : !state.peek;
  
  if (state.peek) {
    document.documentElement.classList.add('open-pdf-peeking');
  } else {
    document.documentElement.classList.remove('open-pdf-peeking');
  }
  
  syncUiState();
}

function toggleLocalAI() {
  if (!window.LocalEngine) {
    showError("Local AI engine is not available.");
    return;
  }
  state.localAI = !state.localAI;
  syncUiState();
  if (state.mode === 'explainer') {
    cancelCurrentStream();
    runExplainer();
  }
}

function attachRootEvents() {
  if (!state.root || state.root.dataset.eventsAttached === 'true') return;

  state.root.addEventListener('click', (event) => {
    const peek = event.target.closest('[data-action="toggle-peek"]');
    if (peek) {
      togglePeek();
      return;
    }

    const localToggle = event.target.closest('[data-action="toggle-local"]');
    if (localToggle) {
      toggleLocalAI();
      return;
    }

    const isolated = event.target.closest('[data-action="open-isolated"]');
    if (isolated) {
      const pdfUrl = window.location.href;
      const readerUrl = chrome.runtime.getURL('templates/reader.html') + '?file=' + encodeURIComponent(pdfUrl);
      window.open(readerUrl, '_blank');
      return;
    }

    const levelButton = event.target.closest('[data-level]');
    if (levelButton) {
      setLevel(levelButton.dataset.level);
    }

    const next = event.target.closest('[data-action="next-page"]');
    if (next) {
      goToNextPage();
      return;
    }

    const retry = event.target.closest('[data-action="retry"]');
    if (retry) {
      retryCurrentMode();
    }
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Shift') togglePeek(true);
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === 'Shift') togglePeek(false);
  });

  state.root.dataset.eventsAttached = 'true';
}

async function loadOriginalText() {
  if (state.loadingOriginal) return;

  state.loadingOriginal = true;
  showStatus('Loading page text...');

  try {
    const { text, pageCount } = await extractCurrentPageText();
    state.originalText = text;
    state.pageCount = pageCount || state.pageCount;
    updateHeaderMeta();

    if (state.mode === 'pdf') {
      renderOriginalTextParagraphs(text);
    } else {
      await runExplainer();
    }
  } catch (err) {
    console.error('[open-pdf] Text extraction failed:', err);
    if (err.message === 'SCANNED_PAGE') {
      showError('This page appears to be a scanned image. Explainer Mode requires readable text.');
    } else {
      showError('Could not read text from this PDF page. It may be scanned, protected, or unavailable.');
    }
  } finally {
    state.loadingOriginal = false;
  }
}

function renderReaderContent() {
  if (state.mode === 'pdf') {
    if (state.originalText) {
      renderOriginalTextParagraphs(state.originalText);
    } else {
      showStatus('Loading page text...');
    }
    return;
  }

  if (state.streaming) {
    showStatus('Generating explanation...');
    return;
  }

  showStatus('Preparing explanation...');
}

function renderOriginalTextParagraphs(text) {
  const content = getContentArea();
  if (!content) return;

  const paragraphs = splitIntoParagraphs(text);
  if (!paragraphs.length) {
    showStatus('No readable text found on this page.');
    return;
  }

  content.innerHTML = `
    <article class="open-pdf-document open-pdf-original">
      ${renderOptionalHeading(paragraphs)}
      ${paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join('')}
      ${renderFooterActions()}
    </article>
  `;
}

function renderFooterActions() {
  if (!state.pageCount || state.pageNumber >= state.pageCount) return '';

  return `
    <footer class="open-pdf-footer-actions">
      <button class="open-pdf-next-page" type="button" data-action="next-page">
        Next Page (${state.pageNumber + 1}/${state.pageCount})
      </button>
    </footer>
  `;
}

function renderOptionalHeading(paragraphs) {
  const first = paragraphs[0];
  if (!first || first.length > 96) return '';

  const looksLikeHeading = /^[\dIVXLC]+\.\s+/.test(first) || first === first.toUpperCase();
  if (!looksLikeHeading) return '';

  paragraphs.shift();
  return `<h2>${escapeHtml(first)}</h2>`;
}

function getScrollPercentage() {
  const root = state.root;
  if (!root) return 0;
  
  const scrollTop = root.scrollTop;
  const scrollHeight = root.scrollHeight - root.clientHeight;
  return scrollHeight > 0 ? scrollTop / scrollHeight : 0;
}

function applyScrollPercentage(percentage) {
  const root = state.root;
  if (!root) return;

  requestAnimationFrame(() => {
    const scrollHeight = root.scrollHeight - root.clientHeight;
    root.scrollTop = scrollHeight * percentage;
  });
}

async function setLevel(nextLevel) {
  if (!LEVELS.includes(nextLevel) || nextLevel === state.level) return;

  const scrollPct = getScrollPercentage();
  state.level = nextLevel;

  if (nextLevel === 'normal') {
    state.mode = 'pdf';
    cancelCurrentStream();
    syncUiState();
    renderOriginalTextParagraphs(state.originalText);
  } else {
    state.mode = 'explainer';
    syncUiState();

    if (!state.originalText && !state.loadingOriginal) {
      await loadOriginalText();
    } else {
      cancelCurrentStream();
      await runExplainer();
    }
  }

  applyScrollPercentage(scrollPct);
}

function syncUiState() {
  if (!state.root) return;

  state.root.dataset.mode = state.mode;
  state.root.dataset.level = state.level;
  state.root.dataset.peek = state.peek;

  const localToggle = state.root.querySelector('.open-pdf-local-toggle');
  if (localToggle) {
    localToggle.setAttribute('aria-pressed', String(state.localAI));
  }

  const peekToggle = state.root.querySelector('.open-pdf-peek-toggle');
  if (peekToggle) {
    peekToggle.setAttribute('aria-pressed', String(state.peek));
  }

  state.root.querySelectorAll('.open-pdf-level').forEach((button) => {
    const isActive = button.dataset.level === state.level;
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  });
}

async function goToNextPage() {
  if (!state.pageCount || state.pageNumber >= state.pageCount) return;

  state.pageNumber += 1;
  state.originalText = '';
  updateHeaderMeta();
  syncNativeViewerPage();
  
  if (state.mode === 'explainer') {
    // Briefly show the transition
    showStatus(`Moving to page ${state.pageNumber}...`);
  }

  await loadOriginalText();
}

async function retryCurrentMode() {
  if (state.mode === 'explainer') {
    await runExplainer();
  } else {
    await loadOriginalText();
  }
}

async function generateCacheKey(text, level, pageNumber) {
  const msgUint8 = new TextEncoder().encode(`${level}:${pageNumber}:${text}`);
  const hashBuffer = await crypto.subtle.digest('SHA-1', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return `open_pdf_cache_${hashHex}`;
}

async function checkCache(key) {
  return new Promise((resolve) => {
    chrome.storage.local.get([key], (result) => {
      resolve(result[key] || null);
    });
  });
}

async function saveToCache(key, explanation) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [key]: explanation }, () => resolve());
  });
}

async function runExplainer() {
  if (!state.originalText) {
    showStatus('Loading page text...');
    return;
  }

  cancelCurrentStream();
  const runId = ++state.streamRunId;

  const content = getContentArea();
  if (!content) return;

  state.streaming = true;
  state.root.classList.add('is-loading-explainer');
  syncUiState();

  try {
    const cacheKey = await generateCacheKey(state.originalText, state.level, state.pageNumber);
    const cachedExplanation = await checkCache(cacheKey);

    if (cachedExplanation && state.streamRunId === runId) {
      state.root.classList.remove('is-loading-explainer');
      renderStreamedExplanation(cachedExplanation);
      state.streaming = false;
      syncUiState();
      return;
    }

    content.innerHTML = `
      <div class="open-pdf-skeleton">
        <div class="open-pdf-skeleton-line" style="width: 100%"></div>
        <div class="open-pdf-skeleton-line" style="width: 90%"></div>
        <div class="open-pdf-skeleton-line" style="width: 95%"></div>
        <div class="open-pdf-skeleton-line" style="width: 40%"></div>
      </div>
    `;

    const article = document.createElement('article');
    article.className = 'open-pdf-document open-pdf-explanation';
    article.style.display = 'none'; // Hide until first chunk

    const paragraph = document.createElement('p');
    paragraph.className = 'open-pdf-stream-line';

    const highlight = document.createElement('span');
    highlight.className = 'open-pdf-stream-highlight';

    paragraph.appendChild(highlight);
    article.appendChild(paragraph);

    const progress = document.createElement('div');
    progress.className = 'open-pdf-stream-status';
    progress.innerHTML = `${icons.spinner}<span>Generating ${state.level} explanation...</span>`;
    article.appendChild(progress);

    content.appendChild(article);

    let result = '';
    const firstChunkCallback = () => {
      state.root.classList.remove('is-loading-explainer');
      const skeleton = content.querySelector('.open-pdf-skeleton');
      if (skeleton) skeleton.remove();
      article.style.display = 'block';
    };

    if (state.localAI && window.LocalEngine) {
      result = await streamWithLocalEngine(state.originalText, state.level, highlight, progress, firstChunkCallback, state.pageNumber);
    } else {
      result = await streamWithBackgroundWorker(state.originalText, state.level, highlight, progress, firstChunkCallback, state.pageNumber);
    }

    if (state.mode === 'explainer' && state.streamRunId === runId) {
      state.root.classList.remove('is-loading-explainer');
      renderStreamedExplanation(result);
      await saveToCache(cacheKey, result);
    }
  } catch (err) {
    if (isAbortError(err)) return;
    if (state.streamRunId !== runId) return;
    console.error('[open-pdf] Streaming failed:', err);
    state.root.classList.remove('is-loading-explainer');
    showError('The explanation service is unavailable. Try again in a moment.');
  } finally {
    if (state.streamRunId === runId) {
      state.streaming = false;
      syncUiState();
    }
  }
}

function renderStreamedExplanation(text) {
  const content = getContentArea();
  if (!content) return;

  // Use marked for proper formatting
  const htmlContent = typeof marked !== 'undefined' ? marked.parse(text) : escapeHtml(text).replace(/\n/g, '<br>');

  content.innerHTML = `
    <article class="open-pdf-document open-pdf-explanation">
      <div class="open-pdf-markdown-body">
        ${htmlContent}
      </div>
      ${renderFooterActions()}
    </article>
  `;
}

function streamWithBackgroundWorker(text, level, targetSpan, progressEl, onFirstChunk, pageNumber) {
  return new Promise((resolve, reject) => {
    const requestId = `open_pdf_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const port = chrome.runtime.connect({ name: 'pdf-explain-stream' });
    const controller = new AbortController();
    const startedAt = Date.now();

    let buffer = '';
    let renderedLength = 0;
    let queued = false;
    let lastFlushAt = 0;
    let completed = false;
    let firstChunkReported = false;

    state.currentPort = port;
    state.currentRequestId = requestId;
    state.streamAbortController = controller;

    const cleanup = () => {
      if (state.currentRequestId === requestId) {
        state.currentPort = null;
        state.currentRequestId = null;
        state.streamAbortController = null;
      }

      try {
        port.onMessage.removeListener(handleMessage);
      } catch (err) {}

      try {
        port.disconnect();
      } catch (err) {}
    };

    const flush = (force = false) => {
      queued = false;

      const now = performance.now();
      if (!force && now - lastFlushAt < STREAM_FLUSH_MS) {
        scheduleFlush();
        return;
      }

      if (renderedLength !== buffer.length) {
        if (!firstChunkReported && buffer.length > 0) {
          firstChunkReported = true;
          if (onFirstChunk) onFirstChunk();
        }
        targetSpan.textContent = buffer;
        renderedLength = buffer.length;
        lastFlushAt = now;
      }
    };

    const scheduleFlush = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => flush(false));
    };

    const handleMessage = (msg) => {
      if (msg.requestId !== requestId) return;

      if (msg.type === 'stream-chunk') {
        buffer += msg.chunk || '';
        scheduleFlush();
        updateStreamProgress(progressEl, msg.tokenCount || buffer.length, startedAt);
        return;
      }

      if (msg.type === 'stream-complete') {
        completed = true;
        flush(true);
        progressEl?.remove();
        cleanup();
        resolve(buffer);
        return;
      }

      if (msg.type === 'stream-retry') {
        updateStreamProgress(progressEl, buffer.length, startedAt, `Retrying ${msg.attempt}/${msg.maxAttempts}...`);
        return;
      }

      if (msg.type === 'stream-aborted') {
        cleanup();
        reject(new DOMException('Stream aborted', 'AbortError'));
        return;
      }

      if (msg.type === 'stream-error') {
        progressEl?.remove();
        cleanup();
        reject(new Error(msg.error?.message || 'Streaming error'));
      }
    };

    port.onMessage.addListener(handleMessage);
    port.onDisconnect.addListener(() => {
      if (!completed && state.currentRequestId === requestId) {
        cleanup();
        reject(new Error(chrome.runtime.lastError?.message || 'Stream disconnected'));
      }
    });

    controller.signal.addEventListener('abort', () => {
      try {
        port.postMessage({ type: 'stream-cancel', requestId });
      } catch (err) {}
      cleanup();
      reject(new DOMException('Stream aborted', 'AbortError'));
    }, { once: true });

    port.postMessage({
      type: 'stream-extract',
      text,
      level,
      pageNumber,
      requestId,
    });
  });
}

async function streamWithLocalEngine(text, level, targetSpan, progressEl, onFirstChunk, pageNumber) {
  if (!window.LocalEngine) throw new Error("LocalEngine not bundled.");
  
  const pageContext = pageNumber ? `\nNote: This is text extracted specifically from Page ${pageNumber} of the document.` : '';
  const systemPrompt = `Rewrite the content to improve clarity while staying faithful to the original.${pageContext}
Constraints:
- If you encounter fragmented data arrays, raw numbers, or broken formulas, DO NOT attempt to rewrite or interpret them. Preserve them exactly as extracted or explicitly state [Unreadable Formula/Table].
- Keep all numeric and author-date citations (e.g. [1], (Smith et al., 2019)) exactly where they appear in the original text.
- Preserve technical meaning and key details.
- Do not summarize the document as a whole. Focus strictly on explaining the text provided from this specific page.
- Do not add commentary or opinion.`;

  await window.LocalEngine.init((progress) => {
    if (progressEl) {
      progressEl.innerHTML = `${icons.spinner}<span>Downloading Local AI... ${Math.round(progress.progress * 100)}%</span>`;
    }
  });

  const controller = new AbortController();
  state.streamAbortController = controller;
  
  let buffer = '';
  let firstChunkReported = false;
  const startedAt = Date.now();
  
  for await (const chunk of window.LocalEngine.stream(systemPrompt, text)) {
    if (controller.signal.aborted) throw new DOMException('Stream aborted', 'AbortError');
    buffer += chunk;
    if (!firstChunkReported && buffer.length > 0) {
      firstChunkReported = true;
      if (onFirstChunk) onFirstChunk();
    }
    targetSpan.textContent = buffer;
    updateStreamProgress(progressEl, buffer.length, startedAt, 'Local AI Generating...');
  }
  
  progressEl?.remove();
  state.streamAbortController = null;
  return buffer;
}

function cancelCurrentStream() {
  state.streamRunId += 1;

  if (state.streamAbortController) {
    state.streamAbortController.abort();
  } else if (state.currentPort && state.currentRequestId) {
    try {
      state.currentPort.postMessage({ type: 'stream-cancel', requestId: state.currentRequestId });
      state.currentPort.disconnect();
    } catch (err) {}
  }

  state.currentPort = null;
  state.currentRequestId = null;
  state.streamAbortController = null;
  state.streaming = false;
}

function updateStreamProgress(progressEl, tokenCount, startedAt, label = 'Generating explanation...') {
  if (!progressEl) return;

  const elapsedSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
  progressEl.innerHTML = `
    ${icons.spinner}
    <span>${escapeHtml(label)} ${tokenCount ? `${tokenCount} chars · ${elapsedSeconds}s` : ''}</span>
  `;
}

async function extractCurrentPageText() {
  await ensurePDFJS();

  const doc = await getPdfDocument();
  // Strictly clamp pageNumber to valid range
  const pageNumber = Math.min(Math.max(1, state.pageNumber), doc.numPages || 1);
  state.pageNumber = pageNumber;

  console.log(`[open-pdf] Extracting text strictly for Page ${pageNumber} of ${doc.numPages}`);

  const page = await doc.getPage(pageNumber);
  const textContent = await page.getTextContent();
  const text = normalizeTextItems(textContent.items || []);

  // Text density check for scanned pages
  if (text.trim().length < 50) {
    throw new Error('SCANNED_PAGE');
  }

  return {
    text,
    pageCount: doc.numPages,
  };
}

async function ensurePDFJS() {
  if (!window.pdfjsLib?.getDocument) {
    throw new Error('PDF.js library not loaded');
  }

  if (window.pdfjsLib.GlobalWorkerOptions) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdf.worker.min.js');
  }
}

async function getPdfDocument() {
  if (state.pdfDocument) return state.pdfDocument;

  const sources = getPdfSources();
  let lastError = null;

  for (const source of sources) {
    for (const credentials of ['include', 'omit']) {
      try {
        const response = await fetch(source, { credentials });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const data = await response.arrayBuffer();
        state.pdfDocument = await window.pdfjsLib.getDocument({ data }).promise;
        return state.pdfDocument;
      } catch (err) {
        lastError = err;
        console.warn('[open-pdf] PDF source failed:', source, credentials, err);
      }
    }
  }

  throw lastError || new Error('Unable to load PDF');
}

function getPdfSources() {
  const sources = new Set();
  if (window.IS_ISOLATED_READER && window.PDF_SOURCE_URL) {
    sources.add(stripHash(window.PDF_SOURCE_URL));
  }
  
  const embedSrc = state.nativeEmbed?.src;
  const objectData = state.nativeObject?.data;

  if (embedSrc) sources.add(stripHash(embedSrc));
  if (objectData) sources.add(stripHash(objectData));
  sources.add(stripHash(window.location.href));

  return Array.from(sources).filter(Boolean);
}

const LIGATURE_MAP = {
  '\uFB00': 'ff',
  '\uFB01': 'fi',
  '\uFB02': 'fl',
  '\uFB03': 'ffi',
  '\uFB04': 'ffl',
  '\uFB05': 'ft',
  '\uFB06': 'st',
};

function sanitizeText(text) {
  if (!text) return '';

  // Fix ligatures
  let cleaned = text;
  for (const [ligature, replacement] of Object.entries(LIGATURE_MAP)) {
    cleaned = cleaned.split(ligature).join(replacement);
  }

  // Remove structural noise (headers/footers/page numbers)
  cleaned = cleaned.replace(/Page \d+ of \d+/gi, '');
  cleaned = cleaned.replace(/^\d+$/gm, ''); // Standalone page numbers

  return cleaned.trim();
}

function normalizeTextItems(items) {
  if (!items || !items.length) return '';

  // 1. Sort by Y coordinate (descending) then X (ascending)
  // PDF coordinates usually have 0,0 at bottom-left. Y decreases as we go down.
  const sortedItems = [...items].sort((a, b) => {
    const yA = Math.round(a.transform?.[5] || 0);
    const yB = Math.round(b.transform?.[5] || 0);
    const xA = Math.round(a.transform?.[4] || 0);
    const xB = Math.round(b.transform?.[4] || 0);

    if (Math.abs(yA - yB) > 5) {
      return yB - yA; // Higher Y first
    }
    return xA - xB; // Lower X first on same line
  });

  const lines = [];
  let currentLine = [];
  let lastY = null;
  let currentY = null;

  for (const item of sortedItems) {
    const text = item.str || '';
    if (!text.trim()) continue;

    const y = Math.round(item.transform?.[5] || 0);
    
    // Column detection: if we have a massive gap in X on the same line,
    // we might be jumping columns. But since we sorted by Y then X,
    // we should already be reading across the line properly.
    
    if (lastY !== null && Math.abs(y - lastY) > 5 && currentLine.length) {
      lines.push({
        text: currentLine.join(' ').replace(/\s+/g, ' ').trim(),
        y: currentY,
      });
      currentLine = [];
    }

    currentY = y;
    currentLine.push(text);
    lastY = y;
  }

  if (currentLine.length) {
    lines.push({
      text: currentLine.join(' ').replace(/\s+/g, ' ').trim(),
      y: currentY,
    });
  }

  const fullText = lines
    .map((line, index) => {
      if (index === 0) return line.text;

      const previous = lines[index - 1];
      const verticalGap = Math.abs((line.y || 0) - (previous.y || 0));
      return `${verticalGap > 25 ? '\n\n' : '\n'}${line.text}`;
    })
    .join('')
    .replace(/[ \t]+\n/g, '\n');

  return sanitizeText(fullText);
}

function splitIntoParagraphs(text) {
  if (!text) return [];

  const normalized = String(text).replace(/\r/g, '').trim();
  if (!normalized) return [];

  const blockParagraphs = normalized
    .split(/\n{2,}/)
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  if (blockParagraphs.length > 1) return blockParagraphs;

  const sentences = normalized.replace(/\s+/g, ' ').match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) || [normalized];
  const paragraphs = [];
  let current = '';

  for (const sentence of sentences) {
    const clean = sentence.trim();
    if (!clean) continue;

    if ((current + ' ' + clean).trim().length > 420 && current) {
      paragraphs.push(current);
      current = clean;
    } else {
      current = `${current} ${clean}`.trim();
    }
  }

  if (current) paragraphs.push(current);
  return paragraphs;
}

function showStatus(message) {
  const content = getContentArea();
  if (!content) return;

  content.innerHTML = `
    <div class="open-pdf-state">
      ${icons.spinner}
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}

function showError(message) {
  const content = getContentArea();
  if (!content) return;

  content.innerHTML = `
    <div class="open-pdf-state open-pdf-error">
      <p>${escapeHtml(message)}</p>
      <button type="button" data-action="retry">Try Again</button>
    </div>
  `;
}

function getContentArea() {
  return state.root?.querySelector('#open-pdf-content') || null;
}

function updateHeaderMeta() {
  const title = state.root?.querySelector('.open-pdf-title');
  const subtitle = state.root?.querySelector('.open-pdf-subtitle');

  if (title) title.textContent = state.pdfTitle;
  if (subtitle) subtitle.textContent = getPageLabel();
}

function getPageLabel() {
  return `Page ${state.pageNumber}${state.pageCount ? ` of ${state.pageCount}` : ''}`;
}

function derivePdfTitle() {
  const source = state.nativeEmbed?.src || state.nativeObject?.data || window.location.href;

  try {
    const url = new URL(source);
    const lastSegment = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() || '');
    return lastSegment && lastSegment.toLowerCase().endsWith('.pdf') ? lastSegment : 'Research Paper.pdf';
  } catch (err) {
    return 'Research Paper.pdf';
  }
}

function getCurrentPageNum() {
  const hash = window.location.hash || '';
  const hashMatch = hash.match(/(?:page=|#page=)(\d+)/i);
  if (hashMatch) return Math.max(1, Number.parseInt(hashMatch[1], 10));

  const params = new URLSearchParams(window.location.search);
  const queryPage = Number.parseInt(params.get('page') || '', 10);
  if (queryPage > 0) return queryPage;

  return 1;
}

function stripHash(url) {
  if (!url) return '';
  return String(url).split('#')[0];
}

function isAbortError(err) {
  return err?.name === 'AbortError' || String(err?.message || err).toLowerCase().includes('abort');
}

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = String(value ?? '');
  return div.innerHTML;
}

function setupCleanupHandlers() {
  const cleanup = () => {
    cancelCurrentStream();
    try {
      chrome.runtime.sendMessage({ type: 'pdf-explain-cleanup' });
    } catch (err) {}
  };

  window.addEventListener('pagehide', cleanup);
  window.addEventListener('beforeunload', cleanup);
}
