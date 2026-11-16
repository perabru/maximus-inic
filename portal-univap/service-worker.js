// PWA offline app shell. Dados de matrícula e entregas permanecem sob regras do Firebase.
const VERSION='pixel-academy-v3-20261116';
const CORE=['./','./index.html','./styles.css','./app.js','./management.js','./notas.js','./curriculo.js','./favicon.svg','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(VERSION).then(cache=>cache.addAll(CORE)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==VERSION&&k.startsWith('pixel-academy-')).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==self.location.origin)return;
  if(request.mode==='navigate'){
    event.respondWith(fetch(request).then(response=>{const copy=response.clone();caches.open(VERSION).then(c=>c.put('./index.html',copy)).catch(()=>{});return response}).catch(async()=>await caches.match('./index.html')||Response.error()));return;
  }
  event.respondWith(caches.match(request).then(hit=>hit||fetch(request).then(response=>{if(response.ok&&!response.redirected){const clone=response.clone();caches.open(VERSION).then(c=>c.put(request,clone)).catch(()=>{})}return response})));
});
