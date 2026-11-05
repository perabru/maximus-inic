'use strict';
const CACHE='maximus-inic-public-v5';
const SHELL=['./','index.html','styles.css','uiverse-components.css','experience.css','experience.js','assets/maximus-banner.png','public-platform.css','app.js','theme.js','pwa.js','photos.json','articles.json','portal.html','portal.css','portal.css?v=20261105-3','portal.js','firebase-service.js','manifest.webmanifest','instalar.html','conformidade.html','conformidade.css','assets/logo-maximus.png','assets/logo-mark.png','assets/spark.svg','assets/icons/icon-192.png','assets/icons/icon-512.png','assets/icons/apple-touch-icon.png','documentos/Termo_Compromisso_INIC_2027_Maximus.pdf'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('maximus-inic-public-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==self.location.origin)return;
  // Firebase, authenticated requests and private messages are never cached.
  if(request.headers.has('Authorization'))return;
  const path=url.pathname.slice(new URL(self.registration.scope).pathname.length);
  const publicAsset=SHELL.includes(path)||path===''||path.startsWith('assets/photos/');
  if(!publicAsset)return;
  event.respondWith(fetch(request,{cache:'no-cache'}).then(response=>{if(response.ok&&response.type==='basic'){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(request,copy));}return response;}).catch(async()=>{const cached=await caches.match(request,{ignoreSearch:true});if(cached)return cached;if(request.mode==='navigate')return caches.match(new URL('./index.html',self.registration.scope));return new Response('Sem conexão',{status:503,headers:{'Content-Type':'text/plain;charset=utf-8'}});}));
});
