const CACHE='sos-rider-v10-unified-20260904-push1';
const ASSETS=['./','./index.html','./styles.css','./app.js','./config.js','./manifest.webmanifest','./icon-192.png','./icon-512.png','./logo-sos-rider.png'];

self.addEventListener('install',e=>{
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));
});

self.addEventListener('activate',e=>{
  e.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener('push',event=>{
  let data={};
  try{data=event.data?.json?.()||{}}catch{}
  const title=data.title||'⚡ Nuova richiesta SOS Rider';
  const options={
    body:data.body||'Hai una nuova richiesta. Tocca per aprire l’Area Rider.',
    icon:'./icon-192.png',
    badge:'./icon-192.png',
    tag:data.tag||('sos-rider-'+Date.now()),
    renotify:true,
    requireInteraction:true,
    data:{url:data.url||'./?hub=rider'}
  };
  event.waitUntil(self.registration.showNotification(title,options));
});

self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const target=new URL(event.notification.data?.url||'./?hub=rider',self.location.href).href;
  event.waitUntil((async()=>{
    const list=await clients.matchAll({type:'window',includeUncontrolled:true});
    for(const c of list){
      if('focus' in c){
        try{await c.navigate(target)}catch{}
        return c.focus();
      }
    }
    return clients.openWindow(target);
  })());
});

self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  const u=new URL(e.request.url);
  if(u.pathname.startsWith('/api/'))return;
  if(u.origin!==self.location.origin)return;
  e.respondWith(
    fetch(e.request)
      .then(r=>{
        const copy=r.clone();
        caches.open(CACHE).then(c=>c.put(e.request,copy));
        return r;
      })
      .catch(()=>caches.match(e.request).then(r=>r||caches.match('./index.html')))
  );
});
