import { createServer } from 'node:http';
import { env } from '../src/config/env.js';

if (env.isProduction) throw new Error('The connection browser demo is development-only');
const html = `<!doctype html><meta charset="utf-8"><title>OpenVio connection demo</title>
<main><h1>LinkedIn connection demo</h1><p>Development-only controls for the seeded demo project.</p>
<p id="status">Checking connection…</p><button id="connect">Connect</button> <button id="disconnect">Disconnect</button><pre id="result"></pre></main>
<script>
const projectId='00000000-0000-4000-8000-000000000001';
const userId='00000000-0000-4000-8000-000000000011';
const api='http://localhost:4000/api/linkedin';
async function request(path, options={}) { const response=await fetch(api+path,{...options,headers:{'x-dev-user-id':userId,...options.headers}}); return {response,body:await response.json()}; }
async function refresh() { const {response,body}=await request('/connection?projectId='+projectId); document.querySelector('#status').textContent=response.ok?'Connection status: '+body.data.status:'Connection request failed ('+response.status+')'; }
document.querySelector('#connect').onclick=async()=>{const {response,body}=await request('/connect?projectId='+projectId); if(response.ok) location.assign(body.data.authorizationUrl); else document.querySelector('#result').textContent='Connect failed ('+response.status+')';};
document.querySelector('#disconnect').onclick=async()=>{const {response,body}=await request('/connection?projectId='+projectId,{method:'DELETE'}); document.querySelector('#result').textContent=response.ok?'Disconnect complete: '+body.data.status:'Disconnect failed ('+response.status+')'; await refresh();};
refresh();
</script>`;
const server = createServer((_request, response) => { response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(html); });
server.listen(Number(process.env.PORT ?? 5173), '127.0.0.1', () => process.stdout.write('Development connection demo listening on port 5173\n'));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => server.close(() => process.exit(0)));
