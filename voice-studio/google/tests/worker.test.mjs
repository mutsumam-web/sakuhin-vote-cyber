import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import worker, { handle, validateSynthesisRequest } from '../worker/index.mjs';

const PASS = 'long-unpredictable-32-plus-letter-test-access-code';
const URL = 'https://example.workers.dev/api/tts';
const H = { origin: 'https://mutsumam-web.github.io', authorization: `Bearer ${PASS}`, 'content-type': 'application/json' };
const request = (body, headers = H) => new Request(URL, { method: 'POST', headers, body: JSON.stringify(body) });
const plainEnv = { DEMO_ACCESS_CODE: PASS, GOOGLE_SERVICE_ACCOUNT_JSON: '{}' };

test('rejects empty text and voice not in allowlist', () => {
 assert.throws(() => validateSynthesisRequest({ text: ' ', voice: 'Aoede' }));
 assert.throws(() => validateSynthesisRequest({ text: 'テスト', voice: 'Custom-Evil' }));
 assert.deepEqual(validateSynthesisRequest({ text: 'こんにちは', voice: 'Kore' }), { text: 'こんにちは', voice: 'Kore' });
});
test('rejects more than 500 unicode characters', () => {
 assert.throws(() => validateSynthesisRequest({ text: '声'.repeat(501), voice: 'Kore' }));
 assert.doesNotThrow(() => validateSynthesisRequest({ text: '声'.repeat(500), voice: 'Kore' }));
});
test('health is readable and reflects setup state', async () => {
 const x = await handle(new Request('https://example.workers.dev/health', { headers: { origin: H.origin } }), {});
 assert.equal(x.status, 200);
 assert.equal((await x.json()).configured, false);
 assert.equal(x.headers.get('access-control-allow-origin'), H.origin);
});
test('unknown origin blocked and secrets never exposed', async () => {
 const x = await handle(request({ text: 'こんにちは', voice: 'Kore' }, { ...H, origin: 'https://evil.example' }), plainEnv);
 assert.equal(x.status, 403);
 assert.equal(x.headers.get('access-control-allow-origin'), null);
});
test('unconfigured backend fails closed', async () => {
 const x = await handle(request({ text: 'こんにちは', voice: 'Kore' }), {});
 assert.equal(x.status, 503);
});
test('missing passcode fails', async () => {
 const x = await handle(request({ text: 'こんにちは', voice: 'Kore' }, { ...H, authorization: 'Bearer invalid' }), plainEnv);
 assert.equal(x.status, 401);
});
test('wrong content type rejected', async () => {
 const x = await handle(request({ text: 'こんにちは', voice: 'Kore' }, { ...H, 'content-type': 'text/plain' }), plainEnv);
 assert.equal(x.status, 415);
});
test('overlong raw request rejected before Google call', async () => {
 const x = await handle(request({ text: '声'.repeat(3000), voice: 'Kore' }), plainEnv);
 assert.equal(x.status, 413);
});
test('unavailable voice rejected', async () => {
 const x = await handle(request({ text: 'こんにちは', voice: 'NotARealVoice' }), plainEnv);
 assert.equal(x.status, 400);
});
test('OPTIONS returns browser CORS rules', async () => {
 const x = await handle(new Request(URL, { method: 'OPTIONS', headers: { origin: H.origin } }), {});
 assert.equal(x.status, 204);
 assert.match(x.headers.get('access-control-allow-headers'), /Authorization/);
});
test('voice synthesis signs OAuth assertion and streams MP3 bytes', async () => {
 const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
 const creds = JSON.stringify({ client_email: 'test-tts@example.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) });
 const env = { DEMO_ACCESS_CODE: PASS, GOOGLE_SERVICE_ACCOUNT_JSON: creds };
 const calls=[];
 async function fakeFetch(url, options) {
  calls.push({url,options});
  if (url.endsWith('/token')) {
   const body = new URLSearchParams(options.body);
   assert.equal(body.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
   assert.equal(body.get('assertion').split('.').length, 3);
   return new Response(JSON.stringify({ access_token: 'test-token', expires_in: 3000 }), { status: 200 });
  }
  assert.equal(options.headers.authorization, 'Bearer test-token');
  const payload=JSON.parse(options.body);
  assert.equal(payload.voice.name,'ja-JP-Chirp3-HD-Aoede');
  assert.equal(payload.audioConfig.audioEncoding,'MP3');
  assert.equal(payload.input.text,'こんにちは');
  return new Response(JSON.stringify({ audioContent: Buffer.from('FAKE-MP3-TEST').toString('base64') }), { status: 200 });
 }
 const r = await handle(request({ text: 'こんにちは', voice: 'Aoede' }), env, fakeFetch);
 assert.equal(r.status, 200);
 assert.equal(r.headers.get('content-type'), 'audio/mpeg');
 assert.equal(Buffer.from(await r.arrayBuffer()).toString(), 'FAKE-MP3-TEST');
 assert.equal(calls.length,2);
});
test('rate limit rejects requests before paid Google call', async () => {
 const env = { ...plainEnv, GENERATE_RATE_LIMIT: { limit: async () => ({ success: false }) } };
 const r = await handle(request({ text: 'こんにちは', voice: 'Kore' }), env, () => { throw Error('should not call'); });
 assert.equal(r.status,429);
});

test('Cloudflare default fetch entrypoint accepts execution context', async () => {
 const x = await worker.fetch(new Request('https://example.workers.dev/health', { headers: { origin: H.origin } }), {}, { waitUntil() {} });
 assert.equal(x.status, 200);
 assert.equal((await x.json()).service, 'tunagu-google-chirp-trial');
});