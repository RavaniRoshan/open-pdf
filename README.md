<h1 align="center">PDF Explain</h1>

<p align="center">
  <strong>A resilient, intelligent PDF viewer that rewrites complex documents for absolute clarity.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-1.0.0-blue.svg?cacheSeconds=2592000" />
  <img src="https://img.shields.io/badge/license-MIT-green.svg" />
  <img src="https://img.shields.io/badge/platform-Chrome%20Extension-orange.svg" />
</p>

## The Problem
PDFs are a graveyard of good intentions. They are a visual coordinate format, not a semantic text format. Reading multi-column academic papers, deciphering broken formulas, or just trying to quickly understand a dense document is painful. 

## The Solution
**PDF Explain** is a Chrome extension that acts as a fallback PDF viewer. Instead of struggling through dense text, you can read the document natively or switch to **Explainer Mode** to have an AI dynamically rewrite the page for you.

### Features
- **Isolated Reader Tab:** No more conflicting with Chrome's native PDF viewer. Click the extension icon to open any PDF in a clean, dedicated tab.
- **Three Tiers of Clarity:**
  - `Normal`: Displays the raw, original text of the PDF.
  - `Simple`: Rewrites the text in plain, everyday language for beginners.
  - `Technical`: Clarifies and structures the text for a technical audience while preserving precision.
- **True "Stealth" Peek Mode:** Need to see the original chart or formula? Hold `Shift` or click the Eye icon. The Explainer UI becomes 10% transparent and passes all clicks through to the native PDF embedded underneath. 
- **Flawless Page Synchronization:** When you turn the page in Explainer Mode, the native PDF underneath automatically updates its hash to stay perfectly synced.
- **Smart Local Caching:** Once a page is explained, it's instantly cached locally. Re-visiting pages requires zero API calls and loads instantly.
- **Local AI Privacy Mode (Beta):** Click the Lock icon to download a highly optimized WebLLM model directly into your browser. Explanations will run 100% locally via WebGPU, providing a truly zero-cloud, privacy-first experience.
- **Defensive Engineering:** Built-in safeguards to handle multi-column scrambling, ligature fixing, scanned document detection, and proper Markdown rendering for AI outputs.
- **Cost-Efficient:** Extracts and processes strictly one page at a time.

## Installation

1. Download the latest `v1.0.0.zip` from the [Releases](#) page.
2. Extract the ZIP file to a folder on your computer.
3. Open Google Chrome and navigate to `chrome://extensions`.
4. Enable **Developer mode** in the top right corner.
5. Click **Load unpacked** and select the extracted folder.
6. **Crucial Step for Local PDFs:** Click on the "Details" button for the PDF Explain extension and toggle ON **Allow access to file URLs**.

## Usage

1. Open any PDF in Chrome (either from the web or from your local machine).
2. Click the **PDF Explain** extension icon in your toolbar.
3. A new isolated tab will open.
4. Select your preferred clarity level (`Normal`, `Simple`, or `Technical`) from the top control bar.
5. Read seamlessly. Use the `Next Page` button at the bottom to progress, or hold `Shift` to peek at the original layout.

## License
MIT License. See `LICENSE` for more information.
