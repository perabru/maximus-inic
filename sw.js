'use strict';
const CACHE='maximus-inic-community-20261112-14';
const SHELL=['./','community.js','community.js?v=20261112-9','community.css','community.css?v=20261112-13','filter-controls.css','filter-controls.css?v=20261112-7','readability.css','readability.css?v=20261112-4','article-content.js','article-content.js?v=20261109-1','article-richtext.js','article-richtext.js?v=20261112-4','article-editor.js','article-editor.js?v=20261112-4','article-editor.css','article-editor.css?v=20261112-4','tcc-proposal.js','tcc-proposal.js?v=20261112-8','tcc-proposal.css','tcc-proposal.css?v=20261112-8','coordination-dashboard.js','coordination-dashboard.js?v=20261112-13','coordination-dashboard.css','coordination-dashboard.css?v=20261112-14','signed-term-pdf.js','signed-term-pdf.js?v=20261105-11','assets/vendor/pdf-lib-1.17.1.esm.min.js','notification-card.css','notification-card.css?v=20261109-2','calendar.js','calendar.js?v=20261112-7','calendar.css','calendar.css?v=20261109-2','notifications.js','notifications.js?v=20261105-8','notification-config.json','assets/photos/photo-28.webp','assets/photos/photo-29.jpg','assets/photos/photo-30.jpg','assets/photos/photo-31.jpg','assets/photos/photo-32.jpg','index.html','styles.css','styles.css?v=20261112-2','uiverse-components.css','experience.css','experience.css?v=20261109-2','uiverse-components.css?v=20261109-2','carousel.css','carousel.css?v=20261105-5','app.js?v=20261112-7','hero-cover.js','hero-cover.js?v=20261112-2','portal.js?v=20261112-13','firebase-service.js?v=20261112-13','experience.js','assets/maximus-banner.png','public-platform.css','public-platform.css?v=20261109-2','portal.css?v=20261112-6','header-login.css','header-login.css?v=20261109-2','responsive.css','responsive.css?v=20261109-2','brand-typography.css','brand-typography.css?v=20261109-2','assets/fonts/montserrat-latin-800-italic.woff2','assets/fonts/montserrat-latin-ext-800-italic.woff2','app.js','theme.js','pwa.js','pwa.js?v=20261112-10','pwa-install.css','pwa-install.css?v=20261112-10','photos.json','photos.json?v=20261112-3','articles.json','portal.html','portal.css','portal.js','firebase-service.js','manifest.webmanifest','instalar.html','conformidade.html','term-form.js','term-form.js?v=20261112-12','term-form.css','term-form.css?v=20261112-12','signature-pad.js','signature-pad.js?v=20261112-12','term-pdf.js','term-pdf.js?v=20261112-12','documentos/termo-layout.json','documentos/termo-layout.json?v=20261112-12','conformidade.css','conformidade.css?v=20261112-10','assets/logo-maximus.png','assets/logo-mark.png','assets/spark.svg','assets/icons/icon-192.png','assets/icons/icon-512.png','assets/icons/apple-touch-icon.png','documentos/Termo_Compromisso_INIC_2027_Maximus.pdf','documentos/Termo_Compromisso_INIC_2027_Maximus.pdf?v=20261112-12'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>(key.startsWith('maximus-inic-public-')||key.startsWith('maximus-inic-community-'))&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
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

// Web Push is delivered by the browser even when the installed app is closed.
// Signed documents and private Firebase responses never enter this public cache.
self.addEventListener('push',event=>{
  let payload={};
  try {payload=event.data?event.data.json():{};} catch {payload={};}
  const title='Máximu’s · INIC';
  const body=typeof payload.body==='string'&&payload.body.trim()?payload.body.trim().slice(0,220):'Confira suas entregas e eventos no calendário do INIC.';
  const scope=new URL(self.registration.scope);
  const destination=new URL('portal.html#calendario',scope);
  try {
    const requested=new URL(payload.url||destination.href,scope);
    if(requested.origin===scope.origin&&requested.pathname===destination.pathname)destination.hash=requested.hash;
  } catch { /* Keep the calendar destination for malformed or external links. */ }
  event.waitUntil(self.registration.showNotification(title,{
    body,icon:new URL('assets/icons/icon-192.png',scope).href,
    badge:new URL('assets/icons/icon-192.png',scope).href,
    tag:typeof payload.tag==='string'?payload.tag.slice(0,100):'maximus-inic-calendar',
    data:{url:destination.href},renotify:false
  }));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const destination=new URL('portal.html#calendario',self.registration.scope);
  try {
    const supplied=new URL(event.notification.data?.url||destination.href);
    if(supplied.origin===destination.origin&&supplied.pathname===destination.pathname)destination.hash=supplied.hash;
  } catch { /* Open the calendar for stale notifications. */ }
  event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(async clients=>{
    const existing=clients.find(client=>{try{return new URL(client.url).origin===destination.origin&&new URL(client.url).pathname===destination.pathname;}catch{return false;}});
    if(existing){if('navigate' in existing)await existing.navigate(destination.href);return existing.focus();}
    return self.clients.openWindow(destination.href);
  }));
});
