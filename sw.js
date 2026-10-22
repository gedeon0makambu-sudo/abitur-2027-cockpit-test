/* Abitur-Cockpit 2027 Stand 27: resilient, scope-safe offline navigation.
   Cache enthält ausschließlich öffentliche App-Dateien, niemals persönliche Lerndaten.
   Core installation requires index.html; optional icons/manifest cannot abort installation.
*/
const CACHE='abitur-cockpit-27-offline-core';
const CORE=new URL('index.html',self.registration.scope).href;
const OPTIONAL=['manifest.webmanifest','icon-180.png','icon-192.png','icon-512.png'];
const SCOPE=self.registration.scope;
const TIMEOUT_MS=3000;

async function fetchAndCache(url, cache, key=url){
  const response=await fetch(new Request(url,{cache:'reload',credentials:'same-origin'}));
  if(!response || !response.ok || response.type==='opaque')throw new Error('Resource not available: '+url);
  await cache.put(key,response.clone());
  return response;
}
self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    const cache=await caches.open(CACHE);
    // Must succeed: otherwise this worker must not claim offline capability.
    await fetchAndCache(CORE,cache);
    await Promise.allSettled(OPTIONAL.map(name=>fetchAndCache(new URL(name,SCOPE).href,cache)));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    await self.clients.claim();
    // Keep other version's caches until the new core was verified.
    const cache=await caches.open(CACHE);
    if(await cache.match(CORE)){
      const keys=await caches.keys();
      await Promise.all(keys.filter(k=>k!==CACHE&&k.startsWith('abitur-cockpit-')).map(k=>caches.delete(k)));
    }
  })());
});
function timeout(ms){return new Promise((_,reject)=>setTimeout(()=>reject(new Error('network timeout')),ms));}
async function navigation(request,event){
  const cache=await caches.open(CACHE);
  const target=new URL(request.url);
  const canonical=target.pathname.endsWith('/')||target.pathname.endsWith('/index.html');
  if(!canonical)return fetch(request);
  // Offline response is always the cached, canonical index regardless of query parameters.
  const online=fetch(new Request(CORE,{cache:'no-store',credentials:'same-origin'})).then(async response=>{
    if(response.ok && response.type!=='opaque'){
      await cache.put(CORE,response.clone());
      return response;
    }
    throw new Error('HTTP '+response.status);
  });
  // Let network refresh continue, but never block navigation beyond timeout.
  event.waitUntil(online.catch(()=>{}));
  try{return await Promise.race([online,timeout(TIMEOUT_MS)]);}
  catch(error){
    const saved=await cache.match(CORE);
    if(saved)return saved;
    return new Response('<!doctype html><html lang="de"><meta charset="utf-8"><title>Offline nicht bereit</title><h1>Offline-Kopie fehlt</h1><p>Bitte die Online-Diagnose unter offline-check.html öffnen.</p>',{status:503,headers:{'Content-Type':'text/html; charset=utf-8'}});
  }
}
self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET')return;
  const url=new URL(req.url);
  if(url.origin!==self.location.origin||!url.href.startsWith(SCOPE))return;
  if(req.mode==='navigate'){
    event.respondWith(navigation(req,event));
    return;
  }
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    try{
      const response=await fetch(req);
      if(response.ok&&response.type!=='opaque')event.waitUntil(cache.put(req,response.clone()).catch(()=>{}));
      return response;
    }catch(error){return await cache.match(req,{ignoreSearch:true})||new Response('Offline nicht verfügbar',{status:503});}
  })());
});
