# PDF Explain — Browser Extension

<img width="1887" height="1075" alt="image" src="https://github.com/user-attachments/assets/67bc603c-61c2-4c81-ae2e-4a08e5c84f94" />


A fallback PDF viewer that rewrites complex pages into clearer content in real-time.

## Architecture

```
PDF page → Text extraction → Cloudflare Worker (proxy) → Groq LLM → Stream → Explainer view
```

- **Client**: Extracts text from current PDF page using PDF.js, sends to proxy
- **Server**: Cloudflare Worker forwards to Groq with protected API key, streams response back
- **Zero data storage**: No user PDFs or LLM responses are logged or cached

## Features

- Toggle between PDF and explainer view
- Three depth levels: Simple, Normal, Technical
- Real-time streaming (first token <2s)
- Dark/Light theme with localStorage persistence
- Brutalist UI — sharp, minimal, high-contrast
- Performance: request deduplication, abortable streams

## Development

### Prerequisites
- Chrome (or Chromium-based browser)
- Node.js + npm (for Wrangler CLI)

### Install Extension Locally

1. Open Chrome → `chrome://extensions/`
2. Enable **Developer mode** (top-right)
3. Click **Load unpacked**
4. Select `/home/roshandamm/open-pdf`
5. Navigate to any `.pdf` URL
6. Click the **Explain** button (top-right, below viewer toolbar)

### Set Your Cloudflare Worker URL

Edit `content.js`:
```js
const PROXY_ENDPOINT = 'https://pdf-proxy.YOUR-ACCOUNT.workers.dev';
```

Replace `YOUR-ACCOUNT` with your deployed worker subdomain.

## Deploy the Cloudflare Worker

The LLM proxy lives in `worker/`. Deploy with Wrangler:

```bash
cd worker
npm install -g wrangler   # or: npx wrangler@latest
wrangler login            # opens browser OAuth
  wrangler secret put GROQ_API_KEY
  # Paste: YOUR_GROQ_API_KEY_HERE
  wrangler deploy
```

After deploy, update `PROXY_ENDPOINT` in `content.js` with your worker URL.

**Worker features:**
- Rate limit: 10 requests per 12 hours per IP (in-memory; resets on restart)
- Health check: `GET https://pdf-proxy.<account>.workers.dev/` → `{status: "ok"}`
- Zero request/response body logging
- Streams SSE directly from Groq to client

## File Structure

```
open-pdf/
├── manifest.json          # Chrome MV3 extension config
├── content.js             # Main logic (UI, extraction, streaming)
├── styles/main.css        # Brutalist theme + responsive layout
├── lib/
│   ├── pdf.js             # PDF.js library (local)
│   └── pdf.worker.min.js  # Web Worker for PDF.js
├── icons/                 # Extension icons (16/48/128px)
├── worker/                # Cloudflare Worker project
│   ├── src/index.js       # Proxy + rate limiting
│   ├── wrangler.toml
│   └── README.md
└── plan.md                # Architecture spec
```

## Configuration

| Setting | Location | Description |
|---------|----------|-------------|
| `PROXY_ENDPOINT` | `content.js` line 4 | Your Cloudflare Worker URL |
| `level` | localStorage `explainer-level` | Last selected depth (normal/simple/technical) |
| `theme` | localStorage `explainer-theme` | Light or Dark |

## Validation Checklist (per slice)

- ✅ Slice 1: Toggle + skeleton (UI only)
- ✅ Slice 2: Text extraction from PDF pages
- ✅ Slice 3: AI transform (blocking)
- ✅ Slice 4: Streaming tokens, no layout shift
- ✅ Slice 5: Level switching cancels/rerenders
- ✅ Slice 6: Error states + retry button
- ✅ Slice 7: Deduplication, lazy-load PDF.js, AbortController

## License

MIT
