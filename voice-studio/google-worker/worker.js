// TUNAGU Voice Studio / isolated Google Chirp 3 HD proxy.
// Service account JSON and access code must only be Cloudflare secrets.
export const VOICES = Object.freeze({
  Aoede:'女性 · 柔らかい',Kore:'女性 · 明瞭',Leda:'女性 · 落ち着き',
  Zephyr:'女性 · 軽やか',Achernar:'女性 · 自然',
  Charon:'男性 · 低め',Puck:'男性 · 軽やか',Fenrir:'男性 · 力強い'
});
const MAX_CHARS = 500;
let cachedToken = null;
function cors(origin, allowed) {
  const h = {'cache-control':'no-store','x-content-type-options':'nosniff','vary':'Origin'};
  if (origin === allowed) {
    h['access-control-allow-origin']=allowed;
    h['access-control-allow-methods']='GET,POST,OPTIONS';
    h['access-control-allow-headers']='content-type,x-studio-passcode';
  }
  return h;
}
function json(data, status, headers) {
  return new Response(JSON.stringify(data),{status,headers:{...headers,'content-type':'application/json; charset=utf-8'}});
}
function ready(env) {
  return Boolean(env.GOOGLE_SERVICE_ACCOUNT_JSON && env.STUDIO_ACCESS_CODE?.length>=16 && env.GOOGLE_PROJECT_ID && env.GOOGLE_PROJECT_ID!=='REPLACE_WITH_YOUR_GCP_PROJECT_ID' && env.TTS_RATE_LIMIT);
}
function b64url(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new TextEncoder().encode(bytes);
  let binary=''; for(const b of u8) binary+=String.fromCharCode(b);
  return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function privateKeyBytes(pem) {
  const s=pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s+/g,'');
  return Uint8Array.from(atob(s), c=>c.charCodeAt(0));
}
async function getToken(env) {
  if(cachedToken?.exp>Date.now()+60000) return cachedToken.value;
  const a=JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON);
  if(a.type!=='service_account'||!a.client_email||!a.private_key)throw Error('Missing service account');
  const now=Math.floor(Date.now()/1000);
  const signed=b64url(JSON.stringify({alg:'RS256',typ:'JWT'}))+'.'+b64url(JSON.stringify({
    iss:a.client_email,scope:'https://www.googleapis.com/auth/cloud-platform',
    aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600
  }));
  const key=await crypto.subtle.importKey('pkcs8',privateKeyBytes(a.private_key),
    {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
  const sig=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,new TextEncoder().encode(signed));
  const response=await fetch('https://oauth2.googleapis.com/token',{
    method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:signed+'.'+b64url(new Uint8Array(sig))})
  });
  if(!response.ok)throw Error('OAuth unavailable');
  const data=await response.json();
  if(!data.access_token)throw Error('OAuth response missing token');
  cachedToken={value:data.access_token,exp:Date.now()+Math.min(Math.max(data.expires_in||3600,60),3600)*1000};
  return cachedToken.value;
}
function equal(a,b) {
  const x=new TextEncoder().encode(String(a||'')), y=new TextEncoder().encode(String(b||''));
  let diff=x.length^y.length;
  for(let i=0;i<Math.max(x.length,y.length);i++)diff|=(x[i]||0)^(y[i]||0);
  return diff===0;
}
function decodeAudio(b64) {
  if(typeof b64!=='string'||!b64||b64.length>16000000)throw Error('Invalid audio');
  return Uint8Array.from(atob(b64),c=>c.charCodeAt(0));
}
export default {
  async fetch(request,env) {
    const path=new URL(request.url).pathname;
    const allowed=env.ALLOWED_ORIGIN||'https://mutsumam-web.github.io';
    const origin=request.headers.get('Origin')||'';
    const headers=cors(origin,allowed);
    if(origin!==allowed)return json({error:'Origin not allowed'},403,headers);
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
    if(path==='/config'&&request.method==='GET')return json({ready:ready(env),maxChars:MAX_CHARS,voices:VOICES},200,headers);
    if(path!=='/synthesize')return json({error:'Not found'},404,headers);
    if(request.method!=='POST')return json({error:'Method not allowed'},405,headers);
    if(!ready(env))return json({error:'Google音声サーバーの設定がまだ完了していません'},503,headers);
    if(!equal(request.headers.get('x-studio-passcode'),env.STUDIO_ACCESS_CODE))return json({error:'アクセスコードが正しくありません'},401,headers);
    if(!(request.headers.get('content-type')||'').startsWith('application/json'))return json({error:'JSON形式で送信してください'},415,headers);
    if(Number(request.headers.get('content-length')||0)>10000)return json({error:'入力が大きすぎます'},413,headers);
    let body; try{body=await request.json()}catch{return json({error:'JSONが不正です'},400,headers)}
    if(!body||typeof body.text!=='string'||typeof body.voice!=='string')return json({error:'音声指定が不正です'},400,headers);
    const text=body.text.trim(); const charCount=Array.from(text).length;
    const speed=body.speed===undefined?1:Number(body.speed);
    if(!text||charCount>MAX_CHARS||new TextEncoder().encode(text).length>4800)return json({error:'原稿は1〜500文字以内にしてください'},400,headers);
    if(!Object.hasOwn(VOICES,body.voice))return json({error:'許可されていない音声です'},400,headers);
    if(!Number.isFinite(speed)||speed<0.75||speed>1.25)return json({error:'話速は0.75〜1.25です'},400,headers);
    // Approximate per-PoP limiter. Google-side API quota and budget alerts are also required.
    const limited=await env.TTS_RATE_LIMIT.limit({key:'private-studio'});
    if(!limited.success)return json({error:'生成回数の上限に達しました。少し時間をおいてください'},429,headers);
    try {
      const token=await getToken(env);
      const resp=await fetch('https://texttospeech.googleapis.com/v1/text:synthesize',{
        method:'POST',headers:{'content-type':'application/json','authorization':'Bearer '+token,'x-goog-user-project':env.GOOGLE_PROJECT_ID},
        body:JSON.stringify({input:{text},voice:{languageCode:'ja-JP',name:'ja-JP-Chirp3-HD-'+body.voice},audioConfig:{audioEncoding:'MP3',speakingRate:speed}}),
        signal:AbortSignal.timeout(45000)
      });
      if(!resp.ok)return json({error:resp.status===429?'Google側の生成上限に達しました':'Google音声生成に失敗しました。認証と割当量を確認してください'},502,headers);
      const data=await resp.json();
      const audio=decodeAudio(data.audioContent);
      return new Response(audio,{status:200,headers:{...headers,'content-type':'audio/mpeg','content-disposition':'attachment; filename="tunagu-google.mp3"'}});
    }catch{return json({error:'Google音声生成サーバーに接続できませんでした'},502,headers)}
  }
};