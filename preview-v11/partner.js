(()=>{
  'use strict';
  const $=id=>document.getElementById(id);
  const key=new URLSearchParams(location.hash.slice(1)).get('key')||'';
  const api=String(window.SOS_RIDER_CONFIG?.apiBase||'').replace(/\/+$/,'');
  const valid=/^[a-f0-9]{36}$/i.test(key);
  let partner=null,inFlight=false;
  const time=t=>{const d=new Date(t);return Number.isNaN(d.getTime())?'—':d.toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'});};
  const range=v=>v?time(v.windowStart||v.at)+' – '+time(v.windowEnd||v.at):'—';
  function message(v,error){$('message').textContent=v;$('message').className='message'+(error?' error':'');}
  function render(d){
    partner=d.partner;
    const a=d.availability||{};
    $('greeting').textContent='Ciao, '+partner.name+'!';
    $('pickupAddress').textContent='Disponibilità per '+partner.pickupAddress;
    $('activeOrders').textContent=String(a.active||0);
    let eta='—',state=a.title||'Disponibilità da verificare',detail=a.text||'';
    if(a.mode==='offline'){state='RIDER OFFLINE';detail='Marcello non è in servizio al momento. Puoi comunque scrivere per concordare un altro orario.';}
    else if(a.mode==='full'){state='RIDER AL COMPLETO';eta=range(a.tentativePickupEta);detail='Stima prudente dopo la coda attuale; non è un orario prenotato. Concorda eventuali nuovi ordini con Marcello.';}
    else if(a.pickupEta){eta=range(a.pickupEta);if(!a.locationFresh)detail+=' · GPS non recente: stima indicativa.';}
    $('statusPill').textContent=state.toUpperCase();
    $('etaTime').textContent=eta;
    $('etaDescription').textContent=detail;
    $('lastUpdated').textContent='Ultimo aggiornamento: '+new Date().toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
    const msg='Ciao Marcello, sono '+partner.name+'. Avrei bisogno di una consegna SOS.\nDestinazione: \nOrario pronto: \nMezzo: '+$('service').selectedOptions[0].textContent+'\nImporto da incassare: \nNote: ';
    $('whatsapp').href='https://wa.me/393495153092?text='+encodeURIComponent(msg);
  }
  async function refresh(){
    if(inFlight||!valid)return;
    inFlight=true;
    try{
      const response=await fetch(api+'/api/partner/'+key+'?service='+encodeURIComponent($('service').value),{cache:'no-store',referrerPolicy:'no-referrer',headers:{Accept:'application/json'}});
      const d=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(d.error||'Link partner non disponibile');
      render(d);$('message').classList.add('hidden');
    }catch(e){message('Impossibile aggiornare lo stato: '+e.message,true);}
    finally{inFlight=false;}
  }
  $('reload').addEventListener('click',refresh);
  $('service').addEventListener('change',refresh);
  if(!api||!valid){message('Il link del locale non è valido. Chiedi a Marcello quello corretto.',true);return;}
  refresh();setInterval(()=>{if(document.visibilityState==='visible')refresh();},15000);
})();
