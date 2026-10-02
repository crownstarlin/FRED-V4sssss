import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, '..', 'public');
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';

function loadEnv(){
  const p=path.join(__dirname,'..','.env');
  if(!fs.existsSync(p)) return;
  for(const line of fs.readFileSync(p,'utf8').split(/\r?\n/)){
    const m=line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/); if(!m) continue;
    if(process.env[m[1]]===undefined) process.env[m[1]]=m[2].replace(/^['"]|['"]$/g,'');
  }
}
loadEnv();

const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
const securityHeaders=(res)=>{res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Permissions-Policy','camera=(),geolocation=(),payment=()');};
const readBody=(req,max=2*1024*1024)=>new Promise((resolve,reject)=>{let chunks=[],size=0;req.on('data',c=>{size+=c.length;if(size>max){reject(new Error('Request too large'));req.destroy();return}chunks.push(c)});req.on('end',()=>resolve(Buffer.concat(chunks)));req.on('error',reject)});
function safeMath(input){const s=input.replace(/,/g,'').trim();if(s.length>120||!/^[0-9+\-*/%().\s^]+$/.test(s)||!/[0-9]/.test(s))return null;try{const result=Function(`"use strict";return (${s.replace(/\^/g,'**')})`)();return typeof result==='number'&&Number.isFinite(result)?String(result):null}catch{return null}}
function aiConfigured(){return Boolean(process.env.AI_API_KEY&&process.env.AI_MODEL)}
function systemPrompt(memory=[]){const m=memory.length?`\nUseful memories supplied by the user:\n- ${memory.slice(-30).join('\n- ')}`:'';return `You are FRED, a helpful personal AI assistant. Address the owner naturally as "Master Crownstarlin" when appropriate. Be accurate, concise, friendly and transparent. Never claim an Android action happened unless the app confirms it. You can help with conversation, writing, reasoning, mathematics, coding, translation and supported image/document analysis.${m}`}
async function callAI(messages){if(!aiConfigured())return null;const base=(process.env.AI_BASE_URL||'https://api.openai.com/v1').replace(/\/$/,'');const r=await fetch(`${base}/chat/completions`,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${process.env.AI_API_KEY}`},body:JSON.stringify({model:process.env.AI_MODEL,messages,temperature:.7})});if(!r.ok)throw new Error(`AI provider returned ${r.status}`);const d=await r.json();return d?.choices?.[0]?.message?.content?.trim()||'I received an empty response.'}
async function api(req,res,url){
 securityHeaders(res);
 if(req.method==='GET'&&(url.pathname==='/api/health'||url.pathname==='/api/healthz'))return json(res,200,{ok:true,status:'healthy',version:'4.0.0',aiConfigured:aiConfigured(),time:new Date().toISOString()});
 if(req.method==='GET'&&url.pathname==='/api/ready')return json(res,aiConfigured()?200:503,{ok:aiConfigured(),status:aiConfigured()?'ready':'not_ready',aiConfigured:aiConfigured()});
 if(req.method==='GET'&&url.pathname==='/api/config')return json(res,200,{version:'4.0.0',features:{chat:true,memory:true,math:true,voice:true,imageUpload:true,androidActions:true,agentTasks:true,visionReady:true,webReady:true,pwa:true},aiConfigured:aiConfigured()});
 if(req.method==='POST'&&url.pathname==='/api/chat'){
  try{const body=JSON.parse((await readBody(req)).toString('utf8'));const message=body?.message;if(typeof message!=='string'||!message.trim())return json(res,400,{error:'Message is required.'});const math=safeMath(message);if(math!==null)return json(res,200,{reply:`The answer is ${math}.`,tool:'calculator'});const history=Array.isArray(body.history)?body.history.slice(-20).map(x=>({role:x.role==='user'?'user':'assistant',content:String(x.content||'')})):[];const memory=Array.isArray(body.memory)?body.memory:[];const reply=await callAI([{role:'system',content:systemPrompt(memory)},...history,{role:'user',content:message}]);if(!reply)return json(res,200,{reply:'FRED V4 backend is online, but the live AI provider is not configured yet. Add your AI settings to .env, then restart the server.',setupRequired:true});return json(res,200,{reply})}catch(e){return json(res,502,{error:'The AI service could not be reached.',detail:process.env.NODE_ENV==='development'?e.message:undefined})}
 }
 if(req.method==='POST'&&url.pathname==='/api/upload')return json(res,200,{ok:true,files:[],note:'V4 upload endpoint is reachable. For full multipart image processing, connect the native/mobile upload adapter.'});
 if(req.method==='POST'&&url.pathname==='/api/action'){try{const b=JSON.parse((await readBody(req)).toString('utf8'));const supported=['open_settings','open_wifi_settings','open_bluetooth_settings','open_battery_settings'];if(!supported.includes(b?.action))return json(res,400,{ok:false,error:'This action requires the Android app/native bridge.'});return json(res,200,{ok:true,action:b.action,message:'Action approved. The Android client must execute the native intent.'})}catch{return json(res,400,{ok:false,error:'Invalid action request.'})}}
 return false;
}
function serveStatic(req,res,url){
 securityHeaders(res);let pathname=decodeURIComponent(url.pathname);if(pathname==='/' )pathname='/index.html';if(pathname.includes('..'))return json(res,400,{error:'Invalid path'});let file=path.join(PUBLIC,pathname);if(!fs.existsSync(file)||!fs.statSync(file).isFile())file=path.join(PUBLIC,'index.html');const ext=path.extname(file);const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};res.writeHead(200,{'Content-Type':types[ext]||'application/octet-stream'});fs.createReadStream(file).pipe(res)}
const server=http.createServer(async(req,res)=>{try{const url=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);if(url.pathname.startsWith('/api/')){const handled=await api(req,res,url);if(handled!==false)return;}serveStatic(req,res,url)}catch(e){console.error(e);json(res,500,{error:'FRED server error. Please try again.'})}});
server.requestTimeout = 120000;
server.headersTimeout = 125000;
server.listen(PORT,HOST,()=>console.log(`FRED V4 running on http://${HOST}:${PORT}`));
const shutdown=(signal)=>{console.log(`FRED V4 received ${signal}; shutting down.`);server.close(()=>process.exit(0));setTimeout(()=>process.exit(1),10000).unref();};
process.on('SIGTERM',()=>shutdown('SIGTERM'));
process.on('SIGINT',()=>shutdown('SIGINT'));
