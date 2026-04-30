# Implementation Plan: Caching & Local AI (WebLLM)

## Overview
This plan details the technical feasibility and implementation strategy for adding **Local Caching** (Suggestion 6) and **Client-Side AI via WebLLM** (Suggestion 4) to our existing `open-pdf` extension architecture.

---

## 1. Local Caching (Suggestion 6: The Immediate Cost-Saver)

### Feasibility: 🟢 100% Feasible & Immediate
Caching is extremely feasible and provides the highest immediate ROI. Since we extract page text individually, users often flip between "Page 1" and "Page 2". Re-summarizing the same page burns tokens and wastes time.

### Implementation Strategy:
1. **Hashing:** When `runExplainer()` is triggered, we generate a fast hash (e.g., SHA-256) of the `originalText` + `level` + `pageNumber`.
2. **Storage:** We will use `chrome.storage.local` (which can store up to 5MB by default, or unlimited with the `unlimitedStorage` permission) or standard `IndexedDB` to store the key-value pair: `{ hash: "Markdown explanation" }`.
3. **The Pipeline:**
   - User clicks "Simple".
   - Extension hashes the page text.
   - If hash exists in cache → instantly render the saved Markdown (Zero latency, Zero API cost).
   - If hash doesn't exist → start the `streamWithBackgroundWorker` pipeline.
   - Upon stream completion, save the final buffer to the cache.

### Effort: Low. Can be implemented perfectly in our current `content.js` and `background.js`.

---

## 2. Client-Side AI Parsing (Suggestion 4: The Ultimate Privacy Tier)

### Feasibility: 🟡 85% Feasible (Requires powerful hardware & WebGPU)
Running an LLM entirely in the browser is possible using **WebLLM** (by MLC.ai), which compiles LLMs to WebAssembly and uses WebGPU for hardware acceleration. 

**Our Architectural Advantage:** Normally, Chrome Extensions struggle with this because Manifest V3 background service workers cannot use WebGPU easily. **However**, because we already built the **Isolated Reader Tab** (`reader.html`), we have a full DOM and standard Web context! We can run WebLLM directly inside the tab.

### Implementation Strategy:
1. **Model Selection:** We cannot run a 70B model in the browser. We must use a highly optimized, quantized "small" model. Good candidates:
   - `Llama-3.2-1B-Instruct-q4f16_1-MLC` (~1 GB download, runs on 2GB+ RAM).
   - `Phi-3.5-mini-instruct-q4f16_1-MLC` (~2 GB download, runs on 4GB+ RAM).
2. **The "Local Engine" Module:**
   - Import the WebLLM library into `reader.html`.
   - Add a UI toggle in the header: 🔒 **"Local AI Mode (Beta)"**.
3. **The User Experience:**
   - When the user turns on Local Mode for the first time, our UI shows a progress bar: *"Downloading AI Engine (1.2 GB)..."*
   - The model is cached in the browser's persistent cache.
   - Future uses are instant. 
   - When the user asks for a summary, `runExplainer` detects the "Local" state and generates the text locally using the WebGPU model instead of sending data to Cloudflare/Groq.

### Effort: High. 
*   Requires adding WebLLM library dependencies.
*   Requires complex UI state handling for downloading and loading the model weights.
*   Requires a fallback mechanism if the user's PC does not support WebGPU.

---

## My Recommendation

1. **Phase 1 (Let's do this now):** Implement **Suggestion 6 (Caching)** immediately. It takes little effort, makes the UI feel infinitely faster when re-visiting pages, and slashes your API costs to zero for repeated reads.
2. **Phase 2 (Optional Next Step):** Implement the WebLLM Client-Side logic. It is a massive "wow" feature for privacy-conscious users, but it is a heavy engineering lift that will require adding ~1.5MB of library code and handling massive WebGL/WebGPU downloads.

**Do you approve of implementing Phase 1 (Caching) first to get the immediate performance gains, or do you want to tackle both right now?**
