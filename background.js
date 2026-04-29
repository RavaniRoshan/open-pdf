// Background service worker (Manifest V3)
// Handles long-lived streaming operations to avoid context invalidation

const PORT_NAME = 'pdf-explain-stream';
const MAX_RETRIES = 3;
const RETRY_DELAYS = [0, 1000, 2000]; // ms

// Track active streaming ports and their abort controllers
const activePorts = new Map();
const activeControllers = new Map();

// Rate limit tracking: port -> { count, resetTime }
const rateLimitState = new Map();
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW = 12 * 60 * 60 * 1000; // 12 hours in ms

console.log('[PDF Explain] background service worker started');

// Cleanup on service worker shutdown/termination
self.addEventListener('activate', (event) => {
  cleanupAll();
});

self.addEventListener('install', (event) => {
  // Skip waiting to ensure new SW takes over quickly
  self.skipWaiting();
});

// Handle incoming connections from content scripts
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== PORT_NAME) return;

  const portId = `${port.sender?.tab?.id || 'unknown'}-${Date.now()}`;
  activePorts.set(portId, port);

  console.log(`[PDF Explain] Port connected: ${portId}`);

  port.onMessage.addListener((msg) => handlePortMessage(portId, port, msg));
  port.onDisconnect.addListener(() => {
    console.log(`[PDF Explain] Port disconnected: ${portId}`);
    cleanupPort(portId);
  });
});

chrome.action.onClicked.addListener((tab) => {
  if (tab.url && tab.url.toLowerCase().endsWith('.pdf')) {
    const readerUrl = chrome.runtime.getURL('templates/reader.html') + '?file=' + encodeURIComponent(tab.url);
    chrome.tabs.create({ url: readerUrl });
  } else {
    // If not a PDF, maybe show a message or just open the reader without a file
    const readerUrl = chrome.runtime.getURL('templates/reader.html');
    chrome.tabs.create({ url: readerUrl });
  }
});

// Also handle direct messages (one-time) for non-streaming operations
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'pdf-explain-check-rate-limit') {
    const state = checkRateLimit(sender?.tab?.id);
    sendResponse(state);
    return true; // Keep channel open for async response
  }
  if (msg.type === 'pdf-explain-cleanup') {
    cleanupPortForTab(sender?.tab?.id);
    sendResponse({ ok: true });
    return true;
  }
  // Return undefined for other messages (no response needed)
});

function handlePortMessage(portId, port, msg) {
  switch (msg.type) {
    case 'stream-extract':
      handleStreamExtract(portId, port, msg);
      break;
    case 'stream-cancel':
      handleStreamCancel(portId, port);
      break;
    case 'cleanup':
      cleanupPort(portId);
      break;
    default:
      console.warn(`[PDF Explain] Unknown message type: ${msg.type}`);
  }
}

async function handleStreamExtract(portId, port, msg) {
  const { text, level, requestId, pageNumber } = msg;
  const tabId = port.sender?.tab?.id;

  // Check rate limit before starting
  const rateLimit = checkRateLimit(tabId);
  if (rateLimit.isLimited) {
    port.postMessage({
      type: 'stream-error',
      requestId,
      error: {
        category: 'RATE_LIMIT',
        message: rateLimit.message,
        retryAfter: rateLimit.retryAfter,
      },
    });
    return;
  }

  // Cancel any existing stream for this port
  if (activeControllers.has(portId)) {
    activeControllers.get(portId).abort();
    activeControllers.delete(portId);
  }

  const controller = new AbortController();
  activeControllers.set(portId, controller);
  const signal = controller.signal;

  const endpoint = 'https://open-pdf.shivamkumar10958.workers.dev';

  // Retry loop
  let lastError = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (signal.aborted) {
      port.postMessage({
        type: 'stream-aborted',
        requestId,
      });
      return;
    }

    try {
      if (attempt > 0) {
        // Wait before retry (exponential backoff)
        await sleep(RETRY_DELAYS[attempt]);
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, level, pageNumber }),
        signal,
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        if (response.status === 429) {
          // Rate limited - update rate limit state
          updateRateLimit(tabId);
          throw new Error(`RATE_LIMIT: ${errText || 'Too many requests'}`);
        }
        throw new Error(`HTTP_${response.status}: ${errText}`);
      }

      // Success - stream the response
      await streamResponse(portId, port, requestId, response, signal);
      return; // Success, exit retry loop
    } catch (err) {
      lastError = err;

      // Don't retry on abort or rate limit
      if (signal.aborted) {
        port.postMessage({
          type: 'stream-aborted',
          requestId,
        });
        return;
      }

      if (err.message && err.message.includes('RATE_LIMIT')) {
        updateRateLimit(tabId);
        port.postMessage({
          type: 'stream-error',
          requestId,
          error: {
            category: 'RATE_LIMIT',
            message: 'Too many requests. Please wait a few minutes.',
            retryAfter: RATE_LIMIT_WINDOW / 1000,
          },
          final: true,
        });
        return;
      }

      // Network or server error - retry
      if (attempt < MAX_RETRIES - 1) {
        port.postMessage({
          type: 'stream-retry',
          requestId,
          attempt: attempt + 1,
          maxAttempts: MAX_RETRIES,
        });
        continue;
      }
    }
  }

  // All retries exhausted
  const errorCategory = categorizeError(lastError);
  port.postMessage({
    type: 'stream-error',
    requestId,
    error: {
      category: errorCategory,
      message: formatErrorMessage(lastError),
    },
    final: true,
  });
}

async function streamResponse(portId, port, requestId, response, signal) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let tokenCount = 0;
  const startTime = Date.now();

  try {
    while (true) {
      if (signal.aborted) {
        reader.cancel();
        port.postMessage({
          type: 'stream-aborted',
          requestId,
        });
        return;
      }

      const { done, value } = await reader.read();

      if (done) {
        const duration = Date.now() - startTime;
        port.postMessage({
          type: 'stream-complete',
          requestId,
          tokenCount,
          duration,
        });
        return;
      }

      const chunk = decoder.decode(value, { stream: true });
      tokenCount += chunk.length;

      port.postMessage({
        type: 'stream-chunk',
        requestId,
        chunk,
        tokenCount,
        duration: Date.now() - startTime,
      });
    }
  } finally {
    reader.releaseLock();
  }
}

function handleStreamCancel(portId, port) {
  if (activeControllers.has(portId)) {
    const controller = activeControllers.get(portId);
    controller.abort();
    activeControllers.delete(portId);
  }
}

function cleanupPort(portId) {
  if (activeControllers.has(portId)) {
    activeControllers.get(portId).abort();
    activeControllers.delete(portId);
  }
  if (activePorts.has(portId)) {
    const port = activePorts.get(portId);
    try {
      port.disconnect();
    } catch (e) {
      // Port may already be disconnected
    }
    activePorts.delete(portId);
  }
}

function cleanupPortForTab(tabId) {
  for (const [portId, port] of activePorts.entries()) {
    if (port.sender?.tab?.id === tabId) {
      cleanupPort(portId);
    }
  }
}

function cleanupAll() {
  for (const controller of activeControllers.values()) {
    try {
      controller.abort();
    } catch (e) {}
  }
  activeControllers.clear();
  activePorts.clear();
  rateLimitState.clear();
}

function checkRateLimit(tabId) {
  if (!tabId) return { isLimited: false };
  const state = rateLimitState.get(tabId);
  if (!state) return { isLimited: false };

  const now = Date.now();
  if (now > state.resetTime) {
    rateLimitState.delete(tabId);
    return { isLimited: false };
  }

  if (state.count >= RATE_LIMIT_MAX) {
    return {
      isLimited: true,
      message: 'Rate limit exceeded. Please wait before trying again.',
      retryAfter: Math.ceil((state.resetTime - now) / 1000),
    };
  }

  return { isLimited: false };
}

function updateRateLimit(tabId) {
  if (!tabId) return;
  const now = Date.now();
  const state = rateLimitState.get(tabId) || { count: 0, resetTime: now + RATE_LIMIT_WINDOW };
  state.count += 1;
  state.resetTime = now + RATE_LIMIT_WINDOW;
  rateLimitState.set(tabId, state);
}

function categorizeError(err) {
  if (!err) return 'UNKNOWN_ERROR';
  const msg = String(err.message || err).toUpperCase();
  if (msg.includes('RATE_LIMIT') || msg.includes('429')) return 'RATE_LIMIT';
  if (msg.includes('NETWORK') || msg.includes('FETCH') || msg.includes('ABORT')) return 'NETWORK_ERROR';
  if (msg.includes('TIMEOUT')) return 'NETWORK_ERROR';
  if (msg.includes('EXTRACTION') || msg.includes('PDF')) return 'EXTRACTION_ERROR';
  return 'LLM_ERROR';
}

function formatErrorMessage(err) {
  if (!err) return 'An unknown error occurred.';
  const msg = String(err.message || err);
  if (msg.includes('RATE_LIMIT')) return 'Too many requests. Please wait a few minutes.';
  if (msg.includes('ABORT')) return 'Request was cancelled.';
  if (msg.includes('NETWORK') || msg.includes('FETCH')) return 'Unable to connect to the AI service. Check your internet connection.';
  if (msg.includes('TIMEOUT')) return 'The request timed out. Please try again.';
  if (msg.includes('429')) return 'Too many requests. Please wait before trying again.';
  return `Error: ${msg}`;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
