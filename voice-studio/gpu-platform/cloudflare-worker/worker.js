/** Cloudflare Worker: private trial gateway to self-hosted Qwen3-TTS.
 * Never ship GPU tokens to the browser. Trial access code is NOT customer auth.
 */
const METHODS = 'GET, POST, OPTIONS';
function headers(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': METHODS,
    'Access-Control-Allow-Headers': 'Content-Type, X-Demo-Code',
    'Access-Control-Max-Age': '600',
    'Vary': 'Origin',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  };
}
function response(status, message, origin) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...headers(origin), 'Content-Type': 'application/json; charset=utf-8' }
  });
}
export default {
  async fetch(request, env) {
    const source = request.headers.get('Origin') || '';
    const allowed = env.ALLOWED_ORIGIN || 'https://mutsumam-web.github.io';
    if (source !== allowed) return response(403, 'Origin denied', allowed);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: headers(allowed) });
    const path = new URL(request.url).pathname;
    if (path === '/api/health' && request.method === 'GET') {
      // Public readiness of gateway only; doesn't imply GPU/model is running.
      return new Response(JSON.stringify({ gateway: 'online', gpu: 'not_verified' }), {
        status: 200, headers: { ...headers(allowed), 'Content-Type': 'application/json' }
      });
    }
    if (path !== '/api/tts' || request.method !== 'POST') return response(404, 'Not found', allowed);
    if (!env.DEMO_ACCESS_CODE || !env.GPU_API_TOKEN || !env.GPU_BASE_URL || !env.TTS_RATE_LIMIT) {
      return response(503, 'Voice service not configured', allowed);
    }
    // Shared pilot code. For sale, replace with per-user authentication + strict quota.
    if (request.headers.get('X-Demo-Code') !== env.DEMO_ACCESS_CODE) {
      return response(401, 'Invalid trial code', allowed);
    }
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const quota = await env.TTS_RATE_LIMIT.limit({ key: ip });
    if (!quota.success) return response(429, 'Too many requests', allowed);
    const size = Number(request.headers.get('Content-Length') || '0');
    if (size > 4096) return response(413, 'Request too large', allowed);
    let payload;
    try {
      const raw = await request.text();
      if (raw.length > 4096) return response(413, 'Request too large', allowed);
      payload = JSON.parse(raw);
    } catch (_) { return response(400, 'Malformed JSON', allowed); }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
        typeof payload.text !== 'string' || !payload.text.trim() || payload.text.length > 240 ||
        typeof payload.voice !== 'string' || typeof payload.style !== 'string' || payload.style.length > 160 ||
        !['wav','mp3'].includes(payload.format)) return response(422, 'Invalid synthesis request', allowed);
    let upstream;
    try {
      const url = new URL(env.GPU_BASE_URL);
      if (url.protocol !== 'https:' || !url.hostname.endsWith('.proxy.runpod.net')) {
        return response(503, 'GPU URL is not an approved Runpod HTTPS origin', allowed);
      }
      upstream = await fetch(new URL('/v1/tts', url).toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Voice-Token': env.GPU_API_TOKEN },
        body: JSON.stringify({ text: payload.text, voice: payload.voice, style: payload.style, format: payload.format }),
        signal: AbortSignal.timeout(95000),
        redirect: 'error'
      });
    } catch (_) { return response(502, 'GPU temporarily unavailable', allowed); }
    if (!upstream.ok) {
      if (upstream.status === 429) return response(429, 'GPU busy, please retry', allowed);
      return response(502, 'GPU synthesis failed', allowed);
    }
    const mime = upstream.headers.get('Content-Type') || '';
    if (!mime.startsWith('audio/wav') && !mime.startsWith('audio/mpeg')) {
      return response(502, 'Unexpected GPU response', allowed);
    }
    return new Response(upstream.body, {
      status: 200,
      headers: {
        ...headers(allowed),
        'Content-Type': mime,
        'Content-Disposition': `attachment; filename="tunagu-voice.${payload.format}"`
      }
    });
  }
};