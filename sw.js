/* Abitur Cockpit 2027 · Service Worker · Release 1.2
   Startseite: Netz zuerst (am HTTP-Cache vorbei), aber höchstens 3,5 s warten – dann die gespeicherte Version.
   Offline: Startseite auch bei Aufrufen mit ?-Parametern. Gecacht werden nur vollständige 200-Antworten der eigenen Adresse.
   Der Service Worker liest oder schreibt nie Lerndaten (localStorage). */
const CACHE='abitur-cockpit-26-aufgabenbelege';
const ASSETS=['./','./index.html','./manifest.webmanifest','./icon-180.png','./icon-192.png','./icon-512.png'];
const NET_TIMEOUT=3500;

self.addEventListener('install',e=>{
  e.waitUntil(caches.open(CACHE)
    .then(c=>c.addAll(ASSETS.map(u=>new Request(u,{cache:'reload'}))))
    .then(()=>self.skipWaiting()));
});

self.addEventListener('activate',e=>{
  e.waitUntil(caches.keys()
    .then(keys=>Promise.all(keys.filter(k=>k!==CACHE&&k.startsWith('abitur-')).map(k=>caches.delete(k))))
    .then(()=>self.clients.claim()));
});

const cacheable=r=>r&&r.status===200&&r.type==='basic'&&!r.redirected;

function fromNetwork(request,cacheKey){
  // Lädt aus dem Netz und legt nur vollständige Antworten im Cache ab (Abbruch mitten im Download → alter Stand bleibt).
  return fetch(request).then(r=>{
    if(cacheable(r)){const copy=r.clone();caches.open(CACHE).then(c=>c.put(cacheKey,copy)).catch(()=>{})}
    return r;
  });
}

function withTimeout(promise,ms){
  return new Promise((resolve,reject)=>{
    const t=setTimeout(()=>reject(new Error('timeout')),ms);
    promise.then(v=>{clearTimeout(t);resolve(v)},err=>{clearTimeout(t);reject(err)});
  });
}

function offlinePage(){
  return new Response('<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Abitur Cockpit · offline</title><body style="font-family:-apple-system,sans-serif;padding:24px;color:#14253d"><h1>Gerade offline</h1><p>Die App ist auf diesem Gerät noch nicht gespeichert. Öffne sie einmal mit Internetverbindung. Deine Lerndaten sind davon nicht betroffen.</p></body></html>',
    {status:503,headers:{'Content-Type':'text/html; charset=utf-8'}});
}

self.addEventListener('fetch',e=>{
  const req=e.request;
  if(req.method!=='GET')return;
  const url=new URL(req.url);
  if(url.origin!==self.location.origin)return;           // fremde Adressen nicht anfassen

  if(req.mode==='navigate'){
    const isStart=url.pathname.endsWith('/')||url.pathname.endsWith('/index.html');
    if(!isStart)return;                                   // andere Seiten: Browser-Standard (keine Umleitungsprobleme)
    const net=fromNetwork(new Request(url.origin+url.pathname,{cache:'no-cache',credentials:'same-origin'}),'./index.html');
    e.waitUntil(net.catch(()=>{}));                       // Aktualisierung darf auch nach dem Timeout fertig laufen
    e.respondWith(
      withTimeout(net,NET_TIMEOUT)
        .then(r=>r.ok&&!r.redirected?r:caches.match('./index.html').then(c=>c||r))
        .catch(()=>caches.match('./index.html').then(c=>c||caches.match('./')).then(c=>c||offlinePage()))
    );
    return;
  }

  // übrige eigene Dateien (z. B. manifest): Netz mit Zeitlimit, sonst Cache (Parameter ignoriert)
  const net=fromNetwork(new Request(req,{cache:'no-cache'}),req);
  e.waitUntil(net.catch(()=>{}));
  e.respondWith(
    withTimeout(net,NET_TIMEOUT)
      .catch(()=>caches.match(req,{ignoreSearch:true}).then(c=>c||new Response('Offline und nicht zwischengespeichert',{status:503})))
  );
});
