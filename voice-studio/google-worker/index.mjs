/** Google Chirp 3 HD trial proxy (Cloudflare Worker).
 * No Google credentials or trial passcodes belong in this repository or in browser code.
 * Pilot-only: not ready for public commercial traffic or hard billing guarantees.
 */
const VOICES = Object.freeze({
  Aoede: 'female', Kore: 'female', Leda: 'female', Zephyr: 'female',
  Charon: 'male', Puck: 'male', Orus: 'male', Achird: 'male',
});
const ORIGIN = 'https://mutsumam-web.github.io';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const TTS_ENDPOINT = 'https://texttospeech.googleapis.com/v1/text:synthesize';
let tokenCache = { token: null, exp: 0, identity: null };

function json(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}
function error(message, status, headers = {}) { return json({ error: message }, status, headers); }
function corsHeaders(origin) {
  return origin === ORIGIN ? {
    'access-control-allow-origin': ORIGIN,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'Authorization, Content-Type',
    'access-control-max-age': '600',
    'vary': 'Origin',
  } : {};
}
function b64url(bytes) {
  let s = '';
  for (const byte of bytes) s += String.fromCharCode(byte);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function toBytes(text) { return new TextEncoder().encode(text); }
function pkcs8FromPem(pem) {
  const stripped = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, '');
  if (!/^[A-Za-z0-9+/=]+$/.test(stripped)) throw new Error('Invalid credential');
  return Uint8Array.from(atob(stripped), x => x.charCodeAt(0));
}
export function validateSynthesisRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('JSON object required');
  const { text, voice } = body;
  if (typeof text !== 'string' || !text.trim()) throw new Error('日本語の文章を入力してください');
  if (Array.from(text).length > 500) throw new Error('試験版は500文字までです');
  if (typeof voice !== 'string' || !Object.hasOwn(VOICES, voice)) throw new Error('選択できない声です');
  return { text, voice };
}
async function googleAccessToken(credentials, fetcher = fetch, nowSec = Math.floor(Date.now() / 1000)) {
  if (!credentials?.client_email?.endsWith('.gserviceaccount.com') || !credentials?.private_key) {
    throw new Error('Google credentials are not configured');
  }
  const identity = credentials.client_email;
  if (tokenCache.identity === identity && tokenCache.token && tokenCache.exp > nowSec + 90) {
    return tokenCache.token;
  }
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: identity,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: TOKEN_ENDPOINT,
    iat: nowSec,
    exp: nowSec + 3000,
  };
  const unsigned = b64url(toBytes(JSON.stringify(header))) + '.' + b64url(toBytes(JSON.stringify(claim)));
  const key = await crypto.subtle.importKey('pkcs8', pkcs8FromPem(credentials.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, toBytes(unsigned));
  const assertion = unsigned + '.' + b64url(new Uint8Array(signature));
  const res = await fetcher(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion,
    }),
  });
  if (!res.ok) throw new Error('Google authentication failed');
  const payload = await res.json();
  if (!payload.access_token || !Number.isFinite(payload.expires_in)) throw new Error('Google token response invalid');
  tokenCache = { token: payload.access_token, exp: nowSec + payload.expires_in, identity };
  return payload.access_token;
}
export async function handle(request, env, fetcher = fetch) {
  const origin = request.headers.get('origin');
  const headers = corsHeaders(origin);
  const pathname = new URL(request.url).pathname;
  if (origin && origin !== ORIGIN) return error('Origin not allowed', 403);
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }
  if (pathname === '/health' && request.method === 'GET') {
    return json({ status: 'ok', service: 'tunagu-google-chirp-trial', configured: !!(env.DEMO_ACCESS_CODE && env.GOOGLE_SERVICE_ACCOUNT_JSON) }, 200, headers);
  }
  if (pathname !== '/api/tts' || request.method !== 'POST') return error('Not found', 404, headers);
  if (!env.DEMO_ACCESS_CODE || !env.GOOGLE_SERVICE_ACCOUNT_JSON) return error('Google音声はまだ接続されていません', 503, headers);
  if (env.DEMO_ACCESS_CODE.length < 24) return error('Server not securely configured', 503, headers);
  if (request.headers.get('authorization') !== `Bearer ${env.DEMO_ACCESS_CODE}`) return error('試験用アクセスコードを確認してください', 401, headers);
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return error('JSON required', 415, headers);
  const length = Number(request.headers.get('content-length') || 0);
  if (length > 4_096) return error('Request too large', 413, headers);
  let payload;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 4_096) return error('Request too large', 413, headers);
    payload = validateSynthesisRequest(JSON.parse(raw));
  } catch (e) { return error(e.message === 'Request too large' ? e.message : '文章・声・JSON形式を確認してください', 400, headers); }
  // If no Cloudflare Rate Limiting binding is configured, trial passcode and GCP quotas still apply.
  if (env.GENERATE_RATE_LIMIT) {
    const ip = request.headers.get('cf-connecting-ip') || 'unknown';
    const limited = await env.GENERATE_RATE_LIMIT.limit({ key: ip });
    if (!limited.success) return error('試験回数の上限に達しました', 429, headers);
  }
  let credentials;
  try { credentials = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON); }
  catch { return error('Google credentials format invalid', 503, headers); }
  try {
    const token = await googleAccessToken(credentials, fetcher);
    const response = await fetcher(TTS_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({
        input: { text: payload.text },
        voice: { languageCode: 'ja-JP', name: `ja-JP-Chirp3-HD-${payload.voice}` },
        audioConfig: { audioEncoding: 'MP3' },
      }),
    });
    if (!response.ok) return error(`Google音声生成に失敗しました（HTTP ${response.status}）`, 502, headers);
    const result = await response.json();
    if (typeof result.audioContent !== 'string' || result.audioContent.length > 10_000_000) return error('Googleから音声データを取得できませんでした', 502, headers);
    const audio = Uint8Array.from(atob(result.audioContent), x => x.charCodeAt(0));
    return new Response(audio, {
      status: 200,
      headers: {
        ...headers,
        'content-type': 'audio/mpeg',
        'content-disposition': 'attachment; filename="tunagu-google-chirp.mp3"',
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
        'x-tts-voice': payload.voice,
      },
    });
  } catch (_err) { return error('Googleへの接続に失敗しました。設定を確認してください。', 502, headers); }
}
// Cloudflare passes an ExecutionContext as the third handler argument.
// Never forward it as the test-injected fetcher.
export default { fetch(request, env) { return handle(request, env); } };