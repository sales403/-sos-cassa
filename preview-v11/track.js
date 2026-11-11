(()=>{
  'use strict';
  const $=id=>document.getElementById(id);
  const params=new URLSearchParams(location.hash.slice(1));
  const code=params.get('code')||'';
  const key=params.get('key')||'';
  const api=String(window.SOS_RIDER_CONFIG?.apiBase||'').replace(/\/+$/,'');
  const valid=/^[a-z0-9-]{5,50}$/i.test(code)&&/^[a-f0-9]{36}$/i.test(key);
  const terminal=new Set(['delivered','rejected','cancelled']);
  const labels={new:'Richiesta registrata',accepted:'Rider in arrivo al ritiro',picked:'Ordine ritirato',arrived:'Rider arrivato a destinazione',delivered:'Consegna completata',rejected:'Richiesta rifiutata',cancelled:'Richiesta annullata'};
  let inFlight=false,finished=false,lastMap='';
  const time=t=>{const d=new Date(t);return Number.isNaN(d.getTime())?'—':d.toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'});};
  const range=v=>v?time(v.windowStart||v.at)+' – '+time(v.windowEnd||v.at):'—';
  const showMessage=(msg,error=false)=>{$('message').textContent=msg;$('message').className='message'+(error?' error':'');};
  async function json(url){const r=await fetch(url,{cache:'no-store',headers:{Accept:'application/json'},referrerPolicy:'no-referrer'});const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data.error||'Servizio non disponibile');return data;}
  function renderOrder(request,events){
    const status=request.status;
    $('statusPill').textContent=(labels[status]||'In aggiornamento').toUpperCase();
    $('orderName').textContent='Ordine '+code+' · '+(request.pickupAddress||'SOS Rider');
    const eta=request.eta||{};
    const target=['new','accepted'].includes(status)?eta.pickup||eta.previewPickup:eta.delivery;
    $('etaTitle').textContent=['new','accepted'].includes(status)?'RITIRO PREVISTO':'CONSEGNA PREVISTA';
    $('etaTime').textContent=terminal.has(status)?'—':range(target);
    $('etaDescription').textContent=terminal.has(status)?labels[status]:(eta.queuePosition>1?String(eta.queuePosition-1)+' consegne prima della tua · orari indicativi':'Stima aggiornata in base alla posizione e alla coda');
    $('lastUpdated').textContent='Ultimo controllo: '+new Date().toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
    const list=$('timeline');list.replaceChildren();
    const clean=(events||[]).filter(e=>labels[e.status]);if(!clean.length)clean.push({status,createdAt:request.createdAt});
    for(const e of clean){const div=document.createElement('div');div.className='step'+(e.status===status||terminal.has(status)?' done':'');const dot=document.createElement('span');dot.className='dot';const content=document.createElement('div');const title=document.createElement('b');title.textContent=labels[e.status];const note=document.createElement('small');note.textContent=e.createdAt?time(e.createdAt):'';content.append(title,note);div.append(dot,content);list.append(div);}
    if(!clean.some(e=>e.status===status)){const div=document.createElement('div');div.className='step done';const dot=document.createElement('span');dot.className='dot';const title=document.createElement('b');title.textContent=labels[status]||'Aggiornamento in corso';div.append(dot,title);list.append(div);}
    $('mapPanel').classList.toggle('hidden',!['accepted','picked','arrived'].includes(status));
    finished=terminal.has(status);
  }
  async function renderMap(){
    const d=await json(api+'/api/track/'+encodeURIComponent(code)+'?token='+encodeURIComponent(key));
    if(!d.sharing||!d.fresh){$('map').classList.add('hidden');$('gpsNotice').textContent='GPS momentaneamente non disponibile. Lo stato della consegna rimane aggiornato.';return;}
    const lat=Number(d.lat),lon=Number(d.lon);
    if(!Number.isFinite(lat)||!Number.isFinite(lon))return;
    const coord=lat.toFixed(4)+','+lon.toFixed(4);
    $('gpsNotice').textContent='Posizione rilevata alle '+time(d.updatedAt)+'.';
    if(coord!==lastMap){const u=new URL('https://www.openstreetmap.org/export/embed.html');u.searchParams.set('bbox',[lon-.007,lat-.005,lon+.007,lat+.005].join(','));u.searchParams.set('layer','mapnik');u.searchParams.set('marker',lat+','+lon);$('map').src=u.href;lastMap=coord;}
    $('map').classList.remove('hidden');
  }
  async function refresh(){
    if(inFlight||finished||!valid)return;
    inFlight=true;
    try{
      const d=await json(api+'/api/requests/'+encodeURIComponent(code)+'?token='+encodeURIComponent(key));
      renderOrder(d.request,d.events);
      if(!finished&&['accepted','picked','arrived'].includes(d.request.status))await renderMap().catch(()=>{$('gpsNotice').textContent='Posizione temporaneamente non disponibile.';});
      $('message').classList.add('hidden');
    }catch(e){showMessage('Aggiornamento non disponibile: '+e.message,true);}
    finally{inFlight=false;}
  }
  $('reload').addEventListener('click',()=>{finished=false;refresh();});
  if(!api||!valid){showMessage('Questo link non è valido. Chiedi a Marcello il link corretto.',true);$('etaDescription').textContent='Nessun ordine visibile.';return;}
  refresh();setInterval(()=>{if(document.visibilityState==='visible')refresh();},12000);
})();
