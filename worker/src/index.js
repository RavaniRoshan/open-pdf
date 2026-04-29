/**
 * Cloudflare Worker — LLM Proxy (Groq)
 * - Rate limit: 10 requests / 12 hours per IP
 * - Zero request/response body logging
 * - Streaming SSE proxy to Groq
 */

const RATE_LIMIT_WINDOW = 12 * 60 * 60 * 1000; // 12 hours
const RATE_LIMIT_MAX = 10;
const rateLimitStore = new Map(); // IP → [timestamps]

export default {
  async fetch(request, env, ctx) {
    // === Health check (GET /) ===
    if (request.method === 'GET') {
      return new Response(JSON.stringify({ status: 'ok', service: 'pdf-proxy' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // === CORS preflight ===
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    // === Only POST allowed ===
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    // === Rate limiting by IP ===
    const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown';
    const rateInfo = checkRateLimit(ip);
    if (!rateInfo.allowed) {
      return new Response(
        JSON.stringify({
          error: 'Rate limit exceeded',
          remaining: 0,
          reset_in_seconds: Math.floor(rateInfo.reset / 1000),
        }),
        { status: 429, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // === Parse body ===
    let body;
    try {
      body = await request.json();
    } catch {
      return new Response('Invalid JSON', { status: 400 });
    }

    const { text, level, pageNumber } = body;
    if (!text || typeof text !== 'string') {
      return new Response('Missing "text" field', { status: 400 });
    }
    const validLevels = ['simple', 'normal', 'technical'];
    const effectiveLevel = validLevels.includes(level) ? level : 'normal';

    // === Build prompt ===
    const prompt = buildPrompt(text, effectiveLevel, pageNumber);

    // === Forward to Groq (server-side, key never exposed) ===
    let groqResponse;
    try {
      groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.GROQ_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [
            { role: 'system', content: 'You are a helpful assistant that rewrites text for clarity.' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.3,
          max_tokens: 2048,
          stream: true,
        }),
      });
    } catch (err) {
      return new Response(`Upstream error: ${err.message}`, { status: 502 });
    }

    if (!groqResponse.ok) {
      const errBody = await groqResponse.text().catch(() => '{}');
      return new Response(`Groq error ${groqResponse.status}: ${errBody}`, { status: groqResponse.status });
    }

    // === Stream SSE tokens directly to client (no buffering, zero storage) ===
    const stream = new ReadableStream({
      async start(controller) {
        const reader = groqResponse.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop();
            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const data = line.slice(6);
                if (data === '[DONE]') continue;
                try {
                  const json = JSON.parse(data);
                  const token = json.choices?.[0]?.delta?.content;
                  if (token) controller.enqueue(new TextEncoder().encode(token));
                } catch { /* ignore malformed */ }
              }
            }
          }
        } catch (err) {
          controller.error(err);
        } finally {
          reader.releaseLock();
        }
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Transfer-Encoding': 'chunked',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache, no-transform',
      },
    });
  },
};

// === Rate limit ===
function checkRateLimit(ip) {
  const now = Date.now();
  const history = rateLimitStore.get(ip) || [];
  const valid = history.filter(t => now - t < RATE_LIMIT_WINDOW);
  if (valid.length >= RATE_LIMIT_MAX) {
    const oldest = valid[0];
    return { allowed: false, remaining: 0, reset: oldest + RATE_LIMIT_WINDOW - now };
  }
  valid.push(now);
  rateLimitStore.set(ip, valid);
  return { allowed: true, remaining: RATE_LIMIT_MAX - valid.length, reset: 0 };
}

// === Prompts ===
function buildPrompt(text, level, pageNumber) {
  const pageContext = pageNumber ? `\nNote: This is text extracted specifically from Page ${pageNumber} of the document.` : '';

  const commonConstraints = `
- If you encounter fragmented data arrays, raw numbers, or broken formulas, DO NOT attempt to rewrite or interpret them. Preserve them exactly as extracted or explicitly state [Unreadable Formula/Table].
- Keep all numeric and author-date citations (e.g. [1], (Smith et al., 2019)) exactly where they appear in the original text.
- Preserve technical meaning and key details.
- Do not summarize the document as a whole. Focus strictly on explaining the text provided from this specific page.
- Do not add commentary or opinion.`;

  const t = {
    simple: `Rewrite the content to improve clarity for a beginner.${pageContext}

Constraints:
${commonConstraints}
- Use simple, everyday language and avoid jargon.
- Explain any necessary concepts intuitively.
- Keep sentences short and direct.

Content:
{text}`,

    normal: `Rewrite the content to improve clarity while staying faithful to the original.${pageContext}

Constraints:
${commonConstraints}
- Improve sentence structure and flow.
- Remove unnecessary complexity.
- Use clear, standard language.

Content:
{text}`,

    technical: `Rewrite the content with precision and structure for a technical audience.${pageContext}

Constraints:
${commonConstraints}
- Use precise terminology.
- Maintain logical structure.
- Include relevant details and specifics.
- Be concise but complete.

Content:
{text}`
  };
  return (t[level] || t.normal).replace('{text}', text.substring(0, 8000));
}

