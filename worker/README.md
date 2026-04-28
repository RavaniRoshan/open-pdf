# Cloudflare Worker — LLM Proxy (pdf-proxy)

## Setup

1. Install Wrangler:
   ```bash
   npm install -g wrangler
   ```

2. Authenticate:
   ```bash
   wrangler login
   ```

3. Set your Groq API key as a secret:
   ```bash
   wrangler secret put GROQ_API_KEY
   # Enter: YOUR_GROQ_API_KEY_HERE
   ```

4. Deploy:
   ```bash
   wrangler deploy
   ```

## Endpoint

After deploy, you'll get: `https://pdf-proxy.<account>.workers.dev`

POST `/` with JSON:
```json
{ "text": "string", "level": "simple|normal|technical" }
```

Returns streamed plain text (SSE tokens).

## Rate Limit

- 10 requests per 12 hours per IP (in-memory, resets on worker restart)
- Adjustable in `src/index.js` constants

## Zero Logging

No request/response bodies are logged. Only minimal error traces in Cloudflare console.
