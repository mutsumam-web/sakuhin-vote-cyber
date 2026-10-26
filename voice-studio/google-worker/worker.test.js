import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import handler from './worker.js';

const ORIGIN='https://mutsumam-web.github.io';
const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}});
const env={ALLOWED_ORIGIN:ORIGIN,GOOGLE_PROJECT_ID:'example-project',GOOGLE_SERVICE_ACCOUNT_JSON:JSON.stringify({type:'service_account',client_email:'test@example.iam.gserviceaccount.com',private_key:privateKey}),STUDIO_ACCESS_CODE:'long-nontrivial-test-passcode',TTS_RATE_LIMIT:{async limit(){return {success:true}}}};
function req(path,method='GET',body,overrides={}) {return new Request('https://worker.example'+path,{method,headers:{Origin:ORIGIN,...(body?{'content-type':'application/json','x-studio-passcode':env.STUDIO_ACCESS_CODE}:{}),...overrides},body:body?JSON.stringify(body):undefined});}
const oldFetch=globalThis.fetch;
after(()=>{globalThis.fetch=oldFetch});
test('config excludes credentials, lists Japanese voices',async()=>{const r=await handler.fetch(req('/config'),env);assert.equal(r.status,200);const a=await r.json();assert.equal(a.ready,true);assert.equal(a.maxChars,500);assert.ok(a.voices.Kore);assert.ok(!JSON.stringify(a).includes('private_key'));});
test('no credentials means fail closed',async()=>{const r=await handler.fetch(req('/config'),{...env,GOOGLE_SERVICE_ACCOUNT_JSON:''});assert.equal((await r.json()).ready,false);const synth=await handler.fetch(req('/synthesize','POST',{text:'こんにちは',voice:'Kore'}),{...env,GOOGLE_SERVICE_ACCOUNT_JSON:''});assert.equal(synth.status,503)});
test('bad origin denied',async()=>{const r=await handler.fetch(req('/config','GET',null,{Origin:'https://evil.example'}),env);assert.equal(r.status,403);assert.equal(r.headers.get('access-control-allow-origin'),null)});
test('preflight authorized',async()=>{const r=await handler.fetch(req('/synthesize','OPTIONS'),env);assert.equal(r.status,204);assert.equal(r.headers.get('access-control-allow-origin'),ORIGIN)});
test('wrong passcode denied',async()=>{const r=await handler.fetch(req('/synthesize','POST',{text:'こんにちは',voice:'Kore'},{'x-studio-passcode':'bad'}),env);assert.equal(r.status,401)});
test('too many characters denied',async()=>{const r=await handler.fetch(req('/synthesize','POST',{text:'あ'.repeat(501),voice:'Kore'}),env);assert.equal(r.status,400)});
test('unknown voice denied',async()=>{const r=await handler.fetch(req('/synthesize','POST',{text:'こんにちは',voice:'AnythingElse'}),env);assert.equal(r.status,400)});
test('invalid speed denied',async()=>{const r=await handler.fetch(req('/synthesize','POST',{text:'こんにちは',voice:'Kore',speed:9}),env);assert.equal(r.status,400)});
test('missing rate binding denied',async()=>{const r=await handler.fetch(req('/synthesize','POST',{text:'こんにちは',voice:'Kore'}),{...env,TTS_RATE_LIMIT:null});assert.equal(r.status,503)});
test('rate limited denied before Google',async()=>{const r=await handler.fetch(req('/synthesize','POST',{text:'こんにちは',voice:'Kore'}),{...env,TTS_RATE_LIMIT:{async limit(){return {success:false}}}});assert.equal(r.status,429)});
test('signed Google OAuth request and synthesize MP3 successfully',async()=>{
 let count=0;
 globalThis.fetch=async (url,options)=>{
  count++;
  if(String(url).includes('oauth2')){assert.match(String(options.body),/grant_type=/);return Response.json({access_token:'fake-access',expires_in:3590})}
  assert.equal(url,'https://texttospeech.googleapis.com/v1/text:synthesize');
  assert.equal(options.headers.authorization,'Bearer fake-access');
  const data=JSON.parse(options.body);assert.equal(data.voice.name,'ja-JP-Chirp3-HD-Kore');assert.equal(data.audioConfig.audioEncoding,'MP3');assert.equal(data.audioConfig.speakingRate,0.9);
  return Response.json({audioContent:Buffer.from([0x49,0x44,0x33,0x02]).toString('base64')});
 };
 const r=await handler.fetch(req('/synthesize','POST',{text:'おはよう',voice:'Kore',speed:0.9}),env);
 assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),'audio/mpeg');assert.deepEqual([...new Uint8Array(await r.arrayBuffer())],[0x49,0x44,0x33,0x02]);assert.equal(count,2);
});