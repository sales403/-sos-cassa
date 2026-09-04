(() => {
'use strict';

const APP_VERSION = '10.0.4';
const KEY = 'sosRiderUnifiedV10';
const V9_KEY = 'sosRiderUnifiedV9';
const OLD_KEY = 'sosRiderGestV7';
const CLIENT_DRAFT_KEY = 'sosRiderClientDraftV10';
const CLIENT_ACTIVE_KEY = 'sosRiderClientActiveV10';
const CLIENT_HISTORY_KEY = 'sosRiderClientHistoryV10';
const PUBLIC_CONFIG = window.SOS_RIDER_CONFIG || {};
const DEFAULT_API = PUBLIC_CONFIG.apiBase || 'https://sosrider.sales-3c8.workers.dev';
const SOS_WHATSAPP = '393495153092';

const $ = id => document.getElementById(id);
const money = n => new Intl.NumberFormat('it-IT', {style:'currency', currency:'EUR'}).format(Number(n)||0);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const digits = s => String(s || '').replace(/\D/g, '');
const num = v => { const n = Number(String(v ?? '').replace(',','.')); return Number.isFinite(n) && n >= 0 ? n : 0; };
const nowIso = () => new Date().toISOString();
const uid = p => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
const fmtDateTime = iso => iso ? new Date(iso).toLocaleString('it-IT',{dateStyle:'short',timeStyle:'short'}) : '—';
const roundHalf = n => Math.round(Number(n||0)*2)/2;
const clampText = (s,max=220) => String(s||'').trim().slice(0,max);

let state = defaultState();
let deferredInstall = null;
let clientVehicle = 'ebike';
let clientPickup = null;
let clientDelivery = null;
let clientQuote = null;
let clientSubmissionId = null;
let clientPolling = null;
let riderPolling = null;
let remoteRequests = [];
let analyticsPeriod = 'today';
let supabaseClient = null;
let authSession = null;
let authUser = null;
let authProfile = null;
let currentAvailability = null;
let availabilityPolling = null;
let recentClientItems = [];
let lastClientStatus = null;
let clientAudioCtx = null;
let alarmAudioCtx = null;
let alarmTimer = null;
let alarmActiveCode = null;
let alarmEnabled = localStorage.getItem('sosRiderAlarmEnabledV10') === '1';
let lastRemoteNewCodes = new Set();
let cashStacks = {};
const searchSlots = new Map();

function defaultState(){
  return {
    version: 10,
    settings: {
      apiBase: DEFAULT_API,
      restaurantAddresses: {},
      clientProfile: {}
    },
    currentShiftId: null,
    shifts: [],
    orders: []
  };
}

function saveState(){ localStorage.setItem(KEY, JSON.stringify(state)); }

function migrateAndLoad(){
  try{
    const current = JSON.parse(localStorage.getItem(KEY) || 'null');
    if(current && Array.isArray(current.orders) && Array.isArray(current.shifts)){
      state = {...defaultState(), ...current, settings:{...defaultState().settings, ...(current.settings||{})}};
      return;
    }
    const v9 = JSON.parse(localStorage.getItem(V9_KEY) || 'null');
    if(v9 && Array.isArray(v9.orders) && Array.isArray(v9.shifts)){
      state = {...defaultState(), ...v9, version:10, settings:{...defaultState().settings, ...(v9.settings||{})}};
      delete state.settings.riderPin;
      saveState();
      return;
    }
    const old = JSON.parse(localStorage.getItem(OLD_KEY) || 'null');
    if(old && Array.isArray(old.orders) && Array.isArray(old.shifts)){
      state = defaultState();
      state.currentShiftId = old.currentShiftId || null;
      state.shifts = old.shifts || [];
      state.orders = (old.orders || []).map(o => ({...o, readyTime:o.readyTime||'', remoteCode:o.remoteCode||null}));
      state.settings.restaurantAddresses = old.settings?.restaurantAddresses || {};
      state.settings.apiBase = old.settings?.proxyUrl || DEFAULT_API;
      saveState();
    }
  }catch(e){ console.warn('Migrazione dati non riuscita', e); }
}

function apiBase(){ return String(state.settings.apiBase || DEFAULT_API).replace(/\/+$/,''); }
function authHeaders(extra={}){ const h={'Accept':'application/json','Content-Type':'application/json',...extra}; if(authSession?.access_token) h.Authorization='Bearer '+authSession.access_token; return h; }
function riderHeaders(){ return authHeaders(); }

async function fetchJson(url, options={}, timeoutMs=9000){
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try{
    const res = await fetch(url, {...options, signal:controller.signal, cache:'no-store'});
    let body = null;
    try{ body = await res.json(); }catch{ body = null; }
    if(!res.ok){
      const err = new Error(body?.error || `HTTP ${res.status}`);
      err.status = res.status; err.body = body;
      throw err;
    }
    return body;
  } finally { clearTimeout(timer); }
}

function vehicleLabel(v){ return v==='moto' ? 'Moto Express' : v==='auto' ? 'Auto Cargo' : 'Economy E-bike'; }
function vehicleIcon(v){ return v==='moto' ? '🏍️' : v==='auto' ? '🚗' : '🚲'; }
function paymentLabel(v){ return v==='cash' ? 'Contanti da incassare' : v==='pos' ? 'POS del locale' : 'Ordine già pagato'; }
function isLateTime(t){
  if(!/^\d{2}:\d{2}$/.test(String(t||''))) return false;
  const [h,m] = t.split(':').map(Number);
  return h*60+m >= 22*60+30;
}
function tariffFor(km, vehicle, readyTime){
  km = Math.max(0, Number(km)||0);
  let base, micro=false;
  if(vehicle==='moto') base = km<=5 ? 9 : 9 + (km-5)*1.20;
  else if(vehicle==='auto') base = km<=5 ? 12 : 12 + (km-5)*1.50;
  else if(km<=1){ base=2.50; micro=true; }
  else base = km<=3 ? 6.50 : 6.50 + (km-3)*1.00;
  base = roundHalf(base);
  const lateFee = isLateTime(readyTime) ? 2 : 0;
  return {base, lateFee, total:roundHalf(base+lateFee), micro};
}

async function routeBetween(a,b,vehicle){
  if(!a?.lat || !a?.lon || !b?.lat || !b?.lon) throw new Error('Seleziona entrambi gli indirizzi dai suggerimenti.');
  const u = new URL(apiBase()+'/api/route');
  u.searchParams.set('from', `${a.lon},${a.lat}`);
  u.searchParams.set('to', `${b.lon},${b.lat}`);
  u.searchParams.set('mode', vehicle);
  const d = await fetchJson(u.toString(), {headers:{Accept:'application/json'}}, 8000);
  if(!Number.isFinite(Number(d?.distanceKm)) || Number(d.distanceKm)<=0) throw new Error('Percorso automatico non disponibile. Riprova o usa WhatsApp.');
  return {distanceKm:Number(d.distanceKm), durationMin:Number(d.durationMin)||0, source:d.source||'server'};
}

function mapsSearch(value){ return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(value||'')}`; }
function mapsPoint(a){ return a?.lat && a?.lon ? `${a.lat},${a.lon}` : (a?.label||a||''); }
function mapsRoute(origin,destination,vehicle){
  const mode = vehicle==='ebike' ? 'bicycling' : 'driving';
  return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(mapsPoint(origin))}&destination=${encodeURIComponent(mapsPoint(destination))}&travelmode=${mode}`;
}
function mapsNavigate(destination,vehicle){
  const mode = vehicle==='ebike' ? 'bicycling' : 'driving';
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(mapsPoint(destination))}&travelmode=${mode}&dir_action=navigate`;
}
function waLink(text){ return `https://wa.me/${SOS_WHATSAPP}?text=${encodeURIComponent(text)}`; }

function showOnly(view){
  ['hubHome','authHub','clientHub','riderLogin','riderHub'].forEach(id => $(id).classList.toggle('hidden', id!==view));
  window.scrollTo({top:0,behavior:'instant'});
}
function openHome(){
  stopClientPolling(); stopRiderPolling(); stopAvailabilityPolling(); stopAlarm();
  history.replaceState(null,'',location.pathname);
  showOnly('hubHome');
  refreshAvailability(); startAvailabilityPolling();
}
function openLogin(){
  stopClientPolling(); stopRiderPolling(); stopAlarm();
  history.replaceState(null,'',`${location.pathname}?hub=login`);
  showOnly('authHub');
  $('authStatus').textContent=''; $('signupStatus').textContent='';
  if(authUser?.email) $('authEmail').value=authUser.email;
}
async function openClient(){
  stopRiderPolling(); stopAlarm();
  if(authProfile?.role==='rider'){
    alert('L’account Rider non può entrare nel portale cliente. Esci dall’account se devi simulare una richiesta ospite.');
    return openRider();
  }
  history.replaceState(null,'',`${location.pathname}?hub=client`);
  showOnly('clientHub');
  updateClientAccountUI();
  restoreClientDraft();
  await loadClientRecent();
  restoreActiveClientRequest();
  refreshAvailability(); startAvailabilityPolling();
}
async function openRider(){
  stopClientPolling();
  history.replaceState(null,'',`${location.pathname}?hub=rider`);
  if(!authUser || !authProfile){ showOnly('riderLogin'); return; }
  if(authProfile.role!=='rider'){
    $('riderLoginStatus').className='status-line error';
    $('riderLoginStatus').textContent='Questo account è Cliente e non ha accesso all’Area Rider.';
    showOnly('riderLogin'); return;
  }
  showRider();
}
function showRider(){
  showOnly('riderHub');
  switchRiderPage('requests');
  renderRiderAll();
  refreshAvailability();
  refreshRemoteRequests();
  startRiderPolling(); startAvailabilityPolling();
  updateAlarmUI();
}

// ---------- Tema DAY / NIGHT ----------
const THEME_KEY='sosRiderThemeModeV10';
function autoTheme(){
  const d=new Date(),m=d.getHours()*60+d.getMinutes();
  const start=Number(PUBLIC_CONFIG.dayStartMinutes ?? 420),night=Number(PUBLIC_CONFIG.nightStartMinutes ?? 1110);
  return m>=start && m<night ? 'day':'night';
}
function themeMode(){return localStorage.getItem(THEME_KEY)||'auto'}
function applyTheme(){
  const mode=themeMode(),theme=mode==='auto'?autoTheme():mode;
  document.documentElement.dataset.theme=theme;
  const meta=$('themeColorMeta'); if(meta) meta.content=theme==='day'?'#f4f5f6':'#070707';
  document.querySelectorAll('[data-theme-toggle]').forEach(b=>{b.textContent=mode==='auto'?'A◐':theme==='day'?'☀':'☾';b.title=`Tema: ${mode==='auto'?'automatico':theme}. Tocca per cambiare`;});
}
function cycleTheme(){const mode=themeMode(),next=mode==='auto'?'day':mode==='day'?'night':'auto';localStorage.setItem(THEME_KEY,next);applyTheme();if(clientQuote)generateClientQuoteImage();}

// ---------- Supabase Auth / ruoli ----------
function authConfigured(){return /^https:\/\/.+\.supabase\.co$/i.test(String(PUBLIC_CONFIG.supabaseUrl||'')) && String(PUBLIC_CONFIG.supabaseAnonKey||'').length>20 && !String(PUBLIC_CONFIG.supabaseAnonKey).includes('INSERISCI')}
async function getSupabase(){
  if(!authConfigured()) throw new Error('Login non configurato: inserisci URL e chiave pubblica Supabase in config.js.');
  if(supabaseClient) return supabaseClient;
  const mod=await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.105.0/+esm');
  supabaseClient=mod.createClient(PUBLIC_CONFIG.supabaseUrl,PUBLIC_CONFIG.supabaseAnonKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,experimental:{passkey:!!PUBLIC_CONFIG.enablePasskeys}}});
  supabaseClient.auth.onAuthStateChange((event,session)=>{authSession=session||null;authUser=session?.user||null;if(!session){authProfile=null;updateClientAccountUI();}if(event==='PASSWORD_RECOVERY')setTimeout(showRecoveryPasswordModal,100);});
  return supabaseClient;
}
async function syncAuthState(){
  if(!authConfigured()) return;
  try{
    const sb=await getSupabase(); const {data}=await sb.auth.getSession(); authSession=data.session||null;authUser=authSession?.user||null;
    if(authSession) await loadMyProfile();
  }catch(e){console.warn('Auth init non disponibile',e)}
}
async function loadMyProfile(){
  if(!authSession) {authProfile=null;return null;}
  const d=await fetchJson(apiBase()+'/api/me',{headers:authHeaders()},8000);authProfile=d.profile||null;updateClientAccountUI();return authProfile;
}
function showRecoveryPasswordModal(){
  openModal('Nuova password',`<p class="muted">Imposta una nuova password per il tuo account.</p><label>Nuova password<input id="recoveryPassword" type="password" autocomplete="new-password" placeholder="Almeno 8 caratteri"></label><div id="recoveryStatus" class="status-line"></div>`,[{label:'ANNULLA',cls:'ghost',fn:closeModal,keep:true},{label:'SALVA PASSWORD',cls:'primary',keep:true,fn:async()=>{const st=$('recoveryStatus');try{const pwd=$('recoveryPassword').value;if(pwd.length<8)throw new Error('Usa almeno 8 caratteri.');const sb=await getSupabase();const {error}=await sb.auth.updateUser({password:pwd});if(error)throw error;st.className='status-line ok';st.textContent='✓ Password aggiornata.';setTimeout(()=>{closeModal();openLogin()},700)}catch(e){st.className='status-line error';st.textContent='⚠ '+e.message}}}]);
}
async function loginEmail(){
  const st=$('authStatus');st.className='status-line';st.textContent='Accesso…';
  try{const sb=await getSupabase();const email=$('authEmail').value.trim(),password=$('authPassword').value;if(!email||!password)throw new Error('Inserisci email e password.');const {data,error}=await sb.auth.signInWithPassword({email,password});if(error)throw error;authSession=data.session;authUser=data.user;await loadMyProfile();st.className='status-line ok';st.textContent='✓ Accesso eseguito.';setTimeout(()=>authProfile?.role==='rider'?openRider():openClient(),150);}catch(e){st.className='status-line error';st.textContent='⚠ '+(e.message||e)}
}
async function signupClient(){
  const st=$('signupStatus');st.className='status-line';st.textContent='Creazione account…';
  try{const sb=await getSupabase();const email=$('signupEmail').value.trim(),password=$('signupPassword').value,name=clampText($('signupName').value,80),phone=digits($('signupPhone').value);if(!name)throw new Error('Inserisci nome locale/richiedente.');if(phone.length<9)throw new Error('Inserisci un telefono valido.');if(!email||password.length<8)throw new Error('Email valida e password di almeno 8 caratteri.');const {data,error}=await sb.auth.signUp({email,password,options:{emailRedirectTo:location.origin+location.pathname+'?hub=login',data:{display_name:name,phone}}});if(error)throw error;if(data.session){authSession=data.session;authUser=data.user;await loadMyProfile();await updateMyProfile({displayName:name,phone});st.className='status-line ok';st.textContent='✓ Account creato.';setTimeout(openClient,150);}else{st.className='status-line ok';st.textContent='✓ Account creato. Controlla la tua email per confermarlo, poi accedi.';}}
  catch(e){st.className='status-line error';st.textContent='⚠ '+(e.message||e)}
}
async function forgotPassword(){
  const email=$('authEmail').value.trim();if(!email){$('authStatus').className='status-line error';$('authStatus').textContent='Inserisci prima la tua email.';return;}
  try{const sb=await getSupabase();const {error}=await sb.auth.resetPasswordForEmail(email,{redirectTo:location.origin+location.pathname+'?hub=login'});if(error)throw error;$('authStatus').className='status-line ok';$('authStatus').textContent='✓ Email di recupero inviata.';}catch(e){$('authStatus').className='status-line error';$('authStatus').textContent='⚠ '+e.message}
}
async function loginPasskey(){
  const st=$('authStatus');st.className='status-line';st.textContent='Apro la passkey…';
  try{if(!PUBLIC_CONFIG.enablePasskeys)throw new Error('Passkey disattivata in config.js.');const sb=await getSupabase();if(!window.PublicKeyCredential)throw new Error('Questo browser non supporta WebAuthn/passkey.');const {data,error}=await sb.auth.signInWithPasskey();if(error)throw error;authSession=data.session;authUser=data.user;await loadMyProfile();st.className='status-line ok';st.textContent='✓ Accesso con passkey.';setTimeout(()=>authProfile?.role==='rider'?openRider():openClient(),150);}catch(e){st.className='status-line error';st.textContent='⚠ '+(e.message||e)}
}
async function registerPasskey(){
  try{if(!authSession)throw new Error('Accedi prima al tuo account.');if(!PUBLIC_CONFIG.enablePasskeys)throw new Error('Passkey disattivata.');const sb=await getSupabase();const {error}=await sb.auth.registerPasskey();if(error)throw error;alert('Passkey registrata su questo account. Puoi usarla dal login.');}catch(e){alert('Passkey non registrata: '+(e.message||e))}
}
async function logoutAccount(){try{const sb=await getSupabase();await sb.auth.signOut()}catch{}authSession=null;authUser=null;authProfile=null;stopAlarm();openHome();}
async function updateMyProfile(body){if(!authSession)return;const d=await fetchJson(apiBase()+'/api/me',{method:'PATCH',headers:authHeaders(),body:JSON.stringify(body)},8000);authProfile=d.profile||authProfile;updateClientAccountUI();}
function updateClientAccountUI(){
  const signed=authProfile?.role==='client';$('clientAccountCard')?.classList.toggle('hidden',!signed);$('clientGuestCard')?.classList.toggle('hidden',signed);
  if(signed){$('clientAccountName').textContent=authProfile.displayName||authUser?.email||'Cliente';$('clientAccountEmail').textContent=authUser?.email||'';if(!$('cRequester').value&&authProfile.displayName)$('cRequester').value=authProfile.displayName;if(!$('cRequesterPhone').value&&authProfile.phone)$('cRequesterPhone').value=authProfile.phone;if(!$('cPickup').value&&authProfile.pickupAddress){$('cPickup').value=authProfile.pickupAddress;clientPickup={label:authProfile.pickupAddress,lat:Number(authProfile.pickupLat),lon:Number(authProfile.pickupLon)};if(Number.isFinite(clientPickup.lat)&&Number.isFinite(clientPickup.lon))$('cPickupStatus').textContent='✓ Indirizzo salvato nel profilo';else clientPickup=null;}}
}

// ---------- Disponibilità pubblica ----------
async function refreshAvailability(){
  try{const d=await fetchJson(apiBase()+'/api/availability',{headers:{Accept:'application/json'}},6000);currentAvailability=d.availability||d;renderAvailability();return currentAvailability}catch(e){currentAvailability=null;renderAvailability(e);return null}
}
function availabilityCopy(a){if(!a)return{mode:'loading',title:'Stato rider non disponibile',text:'Riprova tra poco o usa WhatsApp.'};if(a.mode==='available')return{mode:'available',title:'🟢 Rider disponibile',text:`Partenza indicativa ${a.availableEtaMin||10}-${a.availableEtaMax||15} min`};if(a.mode==='busy')return{mode:'busy',title:'🟡 Rider in consegna / richieste in coda',text:`Nuova partenza stimata ~${a.etaMin||25} min`};return{mode:'offline',title:'🔴 Rider non disponibile',text:'Puoi fare il preventivo, ma l’invio automatico è temporaneamente sospeso.'}}
function renderAvailability(){
  const c=availabilityCopy(currentAvailability);['homeAvailability','clientAvailability'].forEach(id=>{const el=$(id);if(!el)return;el.className='availability-card '+c.mode;el.querySelector('b').textContent=c.title;el.querySelector('small').textContent=c.text;});
  if($('riderAvailabilityTitle')){const dot=$('riderAvailabilityDot');dot.className='availability-dot '+c.mode;$('riderAvailabilityTitle').textContent=c.title;$('riderAvailabilityText').textContent=c.text;if(currentAvailability?.etaPerJob)$('riderEtaSelect').value=String(currentAvailability.etaPerJob);}
}
function startAvailabilityPolling(){stopAvailabilityPolling();availabilityPolling=setInterval(refreshAvailability,8000)}
function stopAvailabilityPolling(){if(availabilityPolling){clearInterval(availabilityPolling);availabilityPolling=null}}
async function setRiderAvailability(enabled){try{const eta=Number($('riderEtaSelect').value)||25;const d=await fetchJson(apiBase()+'/api/rider/availability',{method:'PATCH',headers:riderHeaders(),body:JSON.stringify({enabled,etaPerJob:eta})},8000);currentAvailability=d.availability;renderAvailability()}catch(e){alert('Stato rider non aggiornato: '+e.message)}}

// ---------- Audio / feedback ----------
function getAudioCtx(kind='client'){const C=window.AudioContext||window.webkitAudioContext;if(!C)return null;if(kind==='alarm'){if(!alarmAudioCtx)alarmAudioCtx=new C();return alarmAudioCtx}if(!clientAudioCtx)clientAudioCtx=new C();return clientAudioCtx}
function tone(ctx,freq,duration=.14,volume=.18,delay=0){if(!ctx)return;const o=ctx.createOscillator(),g=ctx.createGain();o.frequency.value=freq;o.type='sine';g.gain.setValueAtTime(0.0001,ctx.currentTime+delay);g.gain.exponentialRampToValueAtTime(volume,ctx.currentTime+delay+.01);g.gain.exponentialRampToValueAtTime(.0001,ctx.currentTime+delay+duration);o.connect(g).connect(ctx.destination);o.start(ctx.currentTime+delay);o.stop(ctx.currentTime+delay+duration+.02)}
function playDing(){const c=getAudioCtx('client');if(!c)return;c.resume?.();tone(c,880,.12,.13);tone(c,1320,.16,.10,.11)}
function alarmBurst(){const c=getAudioCtx('alarm');if(c){c.resume?.();tone(c,740,.22,.38);tone(c,980,.22,.38,.28);tone(c,740,.22,.38,.56)}if(navigator.vibrate)navigator.vibrate([420,140,420,140,650]);}
function updateAlarmUI(){if(!$('riderAlarmCard'))return;$('riderAlarmCard').classList.toggle('active',alarmEnabled);$('riderAlarmState').textContent=alarmEnabled?'Attivo su questo dispositivo':'Da attivare su questo dispositivo';$('enableRiderAlarm').textContent=alarmEnabled?'🔔 ATTIVO':'🔔 ATTIVA';}
async function enableAlarm(){alarmEnabled=true;localStorage.setItem('sosRiderAlarmEnabledV10','1');const c=getAudioCtx('alarm');await c?.resume?.();alarmBurst();setTimeout(()=>navigator.vibrate?.(0),900);if('Notification'in window&&Notification.permission==='default')Notification.requestPermission().catch(()=>{});updateAlarmUI();}
function startAlarm(code){if(!alarmEnabled||alarmActiveCode===code||$('riderHub')?.classList.contains('hidden'))return;stopAlarm();alarmActiveCode=code;alarmBurst();alarmTimer=setInterval(alarmBurst,1400);let ov=document.getElementById('alarmOverlay');if(!ov){ov=document.createElement('div');ov.id='alarmOverlay';ov.className='alarm-overlay';ov.innerHTML='<div>⚡ NUOVA RICHIESTA SOS RIDER</div>';document.body.appendChild(ov)}ov.classList.remove('hidden');if('Notification'in window&&Notification.permission==='granted'){try{new Notification('SOS Rider · Nuova richiesta',{body:code,icon:'icon-192.png',tag:code})}catch{}}}
function stopAlarm(code){if(code&&alarmActiveCode&&code!==alarmActiveCode)return;if(alarmTimer)clearInterval(alarmTimer);alarmTimer=null;alarmActiveCode=null;navigator.vibrate?.(0);document.getElementById('alarmOverlay')?.classList.add('hidden')}

// ---------- Autocomplete indirizzi ----------
function featureLabel(f){
  const p=f?.properties||{}, street=p.street||(p.osm_key==='highway'?p.name:''), house=p.housenumber||'', town=p.city||p.locality||p.district||p.county||'';
  const parts=[];
  if(street) parts.push(street+(house?' '+house:'')); else if(p.name) parts.push(p.name);
  if(town&&!parts.includes(town)) parts.push(town);
  if(p.postcode) parts.push(p.postcode);
  if(p.state && p.state!==town) parts.push(p.state);
  return parts.filter(Boolean).join(', ');
}
let lastNominatimAt=0;
function normalizeNominatimFeature(f){
  const p=f?.properties||{}, a=p.address||{};
  return {
    type:'Feature',
    geometry:f.geometry,
    properties:{
      name:p.name||a.road||a.pedestrian||a.village||a.town||a.city||'',
      street:a.road||a.pedestrian||a.residential||'',
      housenumber:a.house_number||'',
      city:a.city||a.town||a.village||a.municipality||'',
      locality:a.suburb||a.hamlet||'',
      district:a.city_district||a.county||'',
      county:a.county||'',
      postcode:a.postcode||'',
      state:a.state||'',
      countrycode:String(a.country_code||'it').toUpperCase()
    }
  };
}
async function directPhoton(query,controller){
  const u=new URL('https://photon.komoot.io/api/');
  u.searchParams.set('q',query);
  u.searchParams.set('limit','7');
  u.searchParams.set('lang','it');
  u.searchParams.set('lat','44.783');
  u.searchParams.set('lon','10.884');
  const r=await fetch(u.toString(),{signal:controller.signal,cache:'no-store',headers:{Accept:'application/json'}});
  if(!r.ok)throw new Error('Photon non disponibile');
  const d=await r.json();
  return d.features||[];
}
async function directNominatim(query,controller){
  const wait=Math.max(0,1100-(Date.now()-lastNominatimAt));
  if(wait)await new Promise((resolve,reject)=>{
    const t=setTimeout(resolve,wait);
    controller.signal.addEventListener('abort',()=>{clearTimeout(t);reject(new DOMException('Aborted','AbortError'))},{once:true});
  });
  lastNominatimAt=Date.now();
  const u=new URL('https://nominatim.openstreetmap.org/search');
  u.searchParams.set('q',query);
  u.searchParams.set('format','geojson');
  u.searchParams.set('addressdetails','1');
  u.searchParams.set('countrycodes','it');
  u.searchParams.set('limit','7');
  u.searchParams.set('accept-language','it');
  u.searchParams.set('viewbox','10.45,45.05,11.15,44.45');
  const r=await fetch(u.toString(),{signal:controller.signal,cache:'no-store',headers:{Accept:'application/geo+json,application/json'}});
  if(!r.ok)throw new Error('Nominatim non disponibile');
  const d=await r.json();
  return (d.features||[]).map(normalizeNominatimFeature);
}
async function searchAddresses(query, slotKey){
  const existing = searchSlots.get(slotKey);
  existing?.controller?.abort();
  const controller = new AbortController();
  searchSlots.set(slotKey, {...existing, controller});

  // 1) Worker SOS Rider
  try{
    const u = new URL(apiBase()+'/api/address');
    u.searchParams.set('q', query);
    const res = await fetch(u.toString(), {signal:controller.signal, cache:'no-store', headers:{Accept:'application/json'}});
    if(res.ok){
      const d=await res.json();
      if(Array.isArray(d.features) && d.features.length) return d.features;
    }
  }catch(e){ if(e.name==='AbortError') throw e; }

  // 2) Fallback diretto Photon
  try{
    const f=await directPhoton(query,controller);
    if(f.length)return f;
  }catch(e){ if(e.name==='AbortError') throw e; }

  // 3) Fallback OpenStreetMap/Nominatim
  const n=await directNominatim(query,controller);
  if(n.length)return n;

  return [];
}
function wireAutocomplete({inputId,boxId,statusId,mapsId,slotKey,onSelect}){
  const input=$(inputId), box=$(boxId), status=$(statusId);
  let timer=null, features=[];
  const close=()=>box.classList.add('hidden');
  input.addEventListener('input',()=>{
    onSelect(null); clientQuote=null; hideClientQuote();
    clearTimeout(timer);
    const q=input.value.trim();
    if(q.length<3){close();status.textContent='Scrivi almeno 3 caratteri e seleziona un risultato.';return;}
    status.textContent='Cerco indirizzi reali…';
    timer=setTimeout(async()=>{
      try{
        features=await searchAddresses(q,slotKey);
        if(!features.length){ box.innerHTML='<div class="suggestion"><strong>Nessun risultato</strong><span>Controlla via, civico e località.</span></div>'; box.classList.remove('hidden'); status.textContent='Nessun indirizzo trovato.'; return; }
        box.innerHTML=features.slice(0,7).map((f,i)=>`<button class="suggestion" type="button" data-i="${i}"><strong>${esc(featureLabel(f)||f.properties?.name||'Indirizzo')}</strong><span>${esc([f.properties?.postcode,f.properties?.city||f.properties?.locality||f.properties?.district,f.properties?.state].filter(Boolean).join(' · '))}</span></button>`).join('');
        box.classList.remove('hidden'); status.textContent='Seleziona l’indirizzo corretto.';
      }catch(e){ if(e.name!=='AbortError'){close();status.textContent='⚠ Autocomplete non disponibile. Riprova tra poco.';} }
    },280);
  });
  box.addEventListener('click',e=>{
    const b=e.target.closest('[data-i]'); if(!b) return;
    const f=features[Number(b.dataset.i)], c=f?.geometry?.coordinates||[];
    const chosen={label:featureLabel(f)||input.value.trim(), lon:c[0]??null, lat:c[1]??null};
    input.value=chosen.label; onSelect(chosen); close(); status.textContent='✓ Indirizzo verificato'; saveClientDraft();
  });
  $(mapsId).addEventListener('click',()=>{ const q=input.value.trim(); if(q) window.open(mapsSearch(q),'_blank','noopener'); });
  document.addEventListener('click',e=>{ if(!box.contains(e.target) && e.target!==input) close(); });
}

// ---------- Client hub ----------
function setDefaultReadyTime(){
  if($('cReadyTime').value) return;
  const d=new Date(Date.now()+30*60000); d.setMinutes(Math.ceil(d.getMinutes()/5)*5,0,0);
  $('cReadyTime').value=`${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  updateLateHint();
}
function updateLateHint(){
  const late=isLateTime($('cReadyTime').value);
  $('cLateHint').innerHTML=late ? '<b class="late-active">+2,00 € serale applicati automaticamente.</b>' : 'Il supplemento serale si applica automaticamente dopo le 22:30.';
}
function clientFormData(){
  return {
    requesterName:clampText($('cRequester').value,80), requesterPhone:digits($('cRequesterPhone').value),
    pickupAddress:clampText($('cPickup').value,180), pickupLat:clientPickup?.lat??null, pickupLon:clientPickup?.lon??null,
    readyTime:$('cReadyTime').value,
    recipientName:clampText($('cRecipient').value,80), recipientPhone:digits($('cRecipientPhone').value),
    deliveryAddress:clampText($('cDelivery').value,180), deliveryLat:clientDelivery?.lat??null, deliveryLon:clientDelivery?.lon??null,
    service:clientVehicle, payment:$('cPayment').value, orderTotal:$('cPayment').value==='cash'?num($('cOrderTotal').value):0,
    notes:clampText($('cNotes').value,400)
  };
}
function validateClientForm(forQuote=true){
  const d=clientFormData(), missing=[];
  if(!d.requesterName) missing.push('nome locale/richiedente');
  if(d.requesterPhone.length<9) missing.push('telefono referente');
  if(!d.pickupAddress || !clientPickup) missing.push('indirizzo ritiro selezionato');
  if(!d.readyTime) missing.push('orario ordine pronto');
  if(!d.recipientName) missing.push('destinatario');
  if(d.recipientPhone.length<9) missing.push('telefono destinatario');
  if(!d.deliveryAddress || !clientDelivery) missing.push('indirizzo consegna selezionato');
  if(d.payment==='cash' && d.orderTotal<=0) missing.push('importo ordine da incassare');
  if(missing.length){ throw new Error('Completa: '+missing.join(', ')+'.'); }
  if(forQuote && (!clientPickup?.lat || !clientDelivery?.lat)) throw new Error('Seleziona gli indirizzi dai suggerimenti reali.');
  return d;
}
function hideClientQuote(){ $('clientQuoteSection').classList.add('hidden'); }
function invalidateClientQuote(){ clientQuote=null; clientSubmissionId=null; hideClientQuote(); }
async function calculateClientQuote(){
  const status=$('clientFormStatus'); status.className='status-line'; status.textContent='Calcolo percorso e tariffa sul server…';
  try{
    const d=validateClientForm(true);
    const res=await fetchJson(apiBase()+'/api/quote',{method:'POST',headers:{'Accept':'application/json','Content-Type':'application/json'},body:JSON.stringify({pickupLat:d.pickupLat,pickupLon:d.pickupLon,deliveryLat:d.deliveryLat,deliveryLon:d.deliveryLon,service:d.service,readyTime:d.readyTime})},10000);
    const q=res.quote;if(!q||!Number.isFinite(Number(q.totalFee)))throw new Error('Preventivo server non disponibile.');
    clientQuote={distanceKm:Number(q.distanceKm),durationMin:Number(q.durationMin)||0,source:q.routeSource||'server',base:Number(q.baseFee),lateFee:Number(q.lateFee)||0,total:Number(q.totalFee),micro:!!q.microDelivery,service:d.service,readyTime:d.readyTime,createdAt:Date.now()};
    clientSubmissionId=null;
    currentAvailability=res.availability||currentAvailability;renderAvailability();renderClientQuote();await generateClientQuoteImage();
    $('clientQuoteSection').classList.remove('hidden');$('clientQuoteSection').scrollIntoView({behavior:'smooth',block:'start'});
    status.className='status-line ok';status.textContent='✓ Preventivo pronto e verificato dal server. Puoi modificarlo oppure inviare la richiesta.';
    if(clientQuote.distanceKm>8&&clientVehicle==='ebike'){$('serviceSuggestion').classList.remove('hidden');$('serviceSuggestion').textContent='💡 Per questa distanza la Moto Express può essere più adatta. Puoi comunque mantenere Economy.';}else if(clientQuote.micro){$('serviceSuggestion').classList.remove('hidden');$('serviceSuggestion').textContent='⚡ MICRO E-BIKE applicata automaticamente: tratta entro 1 km · €2,50.';}else $('serviceSuggestion').classList.add('hidden');
  }catch(e){status.className='status-line error';status.textContent='⚠ '+e.message;}
}

function renderClientQuote(){
  if(!clientQuote) return;
  $('cqService').textContent=clientQuote.micro?'Micro E-bike':vehicleLabel(clientQuote.service);
  $('cqTotal').textContent=money(clientQuote.total);
  $('cqDistance').textContent=`${clientQuote.distanceKm.toFixed(1)} km`;
  $('cqBase').textContent=money(clientQuote.base);
  $('cqMicroRow').classList.toggle('hidden',!clientQuote.micro);
  $('cqLateRow').classList.toggle('hidden', !clientQuote.lateFee);
  $('cqLateNotice').classList.toggle('hidden', !clientQuote.lateFee);
  $('clientQuoteRouteBadge').textContent='PERCORSO CALCOLATO';
}

function wrapText(ctx,text,x,y,maxWidth,lineHeight,maxLines=3){
  const words=String(text||'').split(/\s+/); let line='', lines=0;
  for(let i=0;i<words.length;i++){
    const test=line?line+' '+words[i]:words[i];
    if(ctx.measureText(test).width>maxWidth && line){ ctx.fillText(line,x,y); y+=lineHeight; lines++; line=words[i]; if(lines>=maxLines-1) break; }
    else line=test;
  }
  if(line && lines<maxLines){ ctx.fillText(line,x,y); y+=lineHeight; }
  return y;
}
async function generateClientQuoteImage(){
  if(!clientQuote) return;
  const d=clientFormData(), c=document.createElement('canvas'); c.width=1080; c.height=1350; const x=c.getContext('2d');
  const day=document.documentElement.dataset.theme==='day';const bg=day?'#f4f5f6':'#070707',panel=day?'#ffffff':'#141414',text=day?'#17191c':'#ffffff',muted=day?'#666b73':'#aaaaaa',line=day?'#d7d9dd':'#665700',accent='#ffd000',soft=day?'#fff4b8':'#211c00';
  x.fillStyle=bg;x.fillRect(0,0,c.width,c.height);x.fillStyle=accent;x.fillRect(0,0,20,c.height);x.fillStyle=panel;x.fillRect(66,60,950,1230);x.strokeStyle=accent;x.lineWidth=3;x.strokeRect(66,60,950,1230);
  const logo=new Image();logo.src='logo-sos-rider.png';await logo.decode().catch(()=>{});try{x.drawImage(logo,100,85,210,210)}catch{}
  x.fillStyle=day?'#8b6a00':accent;x.font='900 38px Arial';x.fillText('PREVENTIVO CONSEGNA',340,132);x.fillStyle=text;x.font='900 30px Arial';x.fillText('SOS RIDER CARPI-SOLIERA',340,180);x.fillStyle=muted;x.font='22px Arial';x.fillText('Il tuo rider di emergenza',340,220);
  x.strokeStyle=accent;x.lineWidth=4;x.beginPath();x.moveTo(105,320);x.lineTo(975,320);x.stroke();let y=370;
  const field=(label,value)=>{x.fillStyle=muted;x.font='700 18px Arial';x.fillText(label.toUpperCase(),110,y);y+=34;x.fillStyle=text;x.font='800 28px Arial';y=wrapText(x,value||'—',110,y,850,34,2);y+=28;};
  field('Locale / richiedente',d.requesterName);field('Ritiro',d.pickupAddress);field('Consegna',d.deliveryAddress);field('Ordine pronto',d.readyTime+(clientQuote.lateFee?' · supplemento serale +2 €':''));field('Servizio',clientQuote.micro?'MICRO E-BIKE · entro 1 km':vehicleLabel(clientQuote.service));field('Distanza calcolata',`${clientQuote.distanceKm.toFixed(1)} km`);
  x.fillStyle=soft;x.fillRect(100,y-5,880,150);x.strokeStyle=line;x.strokeRect(100,y-5,880,150);x.fillStyle=muted;x.font='700 19px Arial';x.fillText('TOTALE CONSEGNA',125,y+35);x.fillStyle=day?'#8a6b00':accent;x.font='900 62px Arial';x.fillText(money(clientQuote.total),125,y+104);y+=180;
  x.fillStyle=muted;x.font='20px Arial';x.fillText(`${clientQuote.micro?'Micro E-bike':'Tariffa base'} ${money(clientQuote.base)}${clientQuote.lateFee?'  +  serale €2,00':''}`,110,y);y+=38;x.fillStyle=text;x.font='700 20px Arial';x.fillText('Tariffa verificata dal server · richiesta soggetta a disponibilità rider.',110,y);y+=45;x.fillStyle=muted;x.font='20px Arial';x.fillText('WhatsApp Marcello · 349 515 3092',110,1240);$('clientQuoteImage').src=c.toDataURL('image/png');
}

function clientHistory(){try{return JSON.parse(localStorage.getItem(CLIENT_HISTORY_KEY)||'[]')}catch{return[]}}
function addClientHistory(code){
  const d=clientFormData();const item={code,at:nowIso(),...d,pickupGeo:clientPickup,deliveryGeo:clientDelivery,quote:clientQuote};
  const arr=clientHistory().filter(x=>x.code!==code);arr.unshift(item);localStorage.setItem(CLIENT_HISTORY_KEY,JSON.stringify(arr.slice(0,8)));if(!authSession){recentClientItems=arr.slice(0,8);renderClientRecent();}
}
async function loadClientRecent(){
  if(authProfile?.role==='client'&&authSession){
    try{const d=await fetchJson(apiBase()+'/api/client/requests?limit=8',{headers:authHeaders()},8000);recentClientItems=(d.requests||[]).map(r=>({code:r.code,at:r.createdAt,requesterName:r.requesterName,requesterPhone:r.requesterPhone,pickupAddress:r.pickupAddress,pickupGeo:{label:r.pickupAddress,lat:Number(r.pickupLat),lon:Number(r.pickupLon)},readyTime:r.readyTime,recipientName:r.recipientName,recipientPhone:r.recipientPhone,deliveryAddress:r.deliveryAddress,deliveryGeo:{label:r.deliveryAddress,lat:Number(r.deliveryLat),lon:Number(r.deliveryLon)},service:r.service,payment:r.payment,orderTotal:Number(r.orderTotal)||0,notes:r.notes||'',quote:{total:Number(r.totalFee)||0,distanceKm:Number(r.distanceKm)||0}}));renderClientRecent();return;}catch(e){console.warn('Storico online cliente non disponibile',e)}
  }
  recentClientItems=clientHistory();renderClientRecent();
}
function renderClientRecent(){
  const arr=recentClientItems||[];const sec=$('clientRecentSection');if(!sec)return;sec.classList.toggle('hidden',!arr.length);if(!arr.length){$('clientRecentList').innerHTML='';return;}
  $('clientRecentList').innerHTML=arr.slice(0,4).map((x,i)=>`<div class="client-recent"><div><b>${esc(x.requesterName||'Richiesta')} → ${esc(x.recipientName||'Cliente')}</b><small>${esc(x.deliveryAddress||'')} · ${vehicleLabel(x.service)}${x.quote?.total?' · '+money(x.quote.total):''}</small></div><button class="btn ghost small" type="button" data-repeat-client="${i}">RIPETI</button></div>`).join('');
}
function repeatClientRequest(index){
  const x=recentClientItems[Number(index)];if(!x)return;
  $('cRequester').value=x.requesterName||'';$('cRequesterPhone').value=x.requesterPhone||'';$('cPickup').value=x.pickupAddress||'';clientPickup=x.pickupGeo||null;$('cReadyTime').value=x.readyTime||$('cReadyTime').value;$('cRecipient').value=x.recipientName||'';$('cRecipientPhone').value=x.recipientPhone||'';$('cDelivery').value=x.deliveryAddress||'';clientDelivery=x.deliveryGeo||null;$('cPayment').value=x.payment||'paid';$('cOrderTotal').value=x.orderTotal||'';$('cNotes').value=x.notes||'';setClientVehicle(x.service||'ebike',false);toggleOrderTotal();updateLateHint();clientQuote=null;clientSubmissionId=null;hideClientQuote();$('clientRequestStatus').classList.add('hidden');$('clientFormCard').classList.remove('hidden');if(clientPickup)$('cPickupStatus').textContent='✓ Indirizzo verificato';if(clientDelivery)$('cDeliveryStatus').textContent='✓ Indirizzo verificato';saveClientDraft();$('clientFormCard').scrollIntoView({behavior:'smooth',block:'start'});
}

function saveClientDraft(){
  const d={...clientFormData(), pickupGeo:clientPickup, deliveryGeo:clientDelivery, remember:$('cRemember').checked};
  localStorage.setItem(CLIENT_DRAFT_KEY,JSON.stringify(d)); $('clientDraftPill').classList.remove('hidden');
  if($('cRemember').checked){ state.settings.clientProfile={requesterName:d.requesterName,requesterPhone:d.requesterPhone,pickupAddress:d.pickupAddress,pickupGeo:d.pickupGeo}; saveState(); }
}
function restoreClientDraft(){
  setDefaultReadyTime();
  try{
    const localProfile=state.settings.clientProfile||{};
    const serverProfile=authProfile?.role==='client'?{requesterName:authProfile.displayName||'',requesterPhone:authProfile.phone||'',pickupAddress:authProfile.pickupAddress||'',pickupGeo:authProfile.pickupAddress&&Number.isFinite(Number(authProfile.pickupLat))&&Number.isFinite(Number(authProfile.pickupLon))?{label:authProfile.pickupAddress,lat:Number(authProfile.pickupLat),lon:Number(authProfile.pickupLon)}:null}:null;
    const d=JSON.parse(localStorage.getItem(CLIENT_DRAFT_KEY)||'null')||serverProfile||localProfile;
    if(d){
      $('cRequester').value=d.requesterName||'';$('cRequesterPhone').value=d.requesterPhone||'';$('cPickup').value=d.pickupAddress||'';clientPickup=d.pickupGeo||null;
      if(d.readyTime)$('cReadyTime').value=d.readyTime;if(d.recipientName)$('cRecipient').value=d.recipientName;if(d.recipientPhone)$('cRecipientPhone').value=d.recipientPhone;
      if(d.deliveryAddress)$('cDelivery').value=d.deliveryAddress;clientDelivery=d.deliveryGeo||null;if(d.payment)$('cPayment').value=d.payment;if(d.orderTotal)$('cOrderTotal').value=d.orderTotal;if(d.notes)$('cNotes').value=d.notes;
      if(d.service){clientVehicle=d.service;setClientVehicle(d.service,false)}
      if(clientPickup)$('cPickupStatus').textContent='✓ Indirizzo verificato';if(clientDelivery)$('cDeliveryStatus').textContent='✓ Indirizzo verificato';
      $('clientDraftPill').classList.remove('hidden');
    }
  }catch{}
  updateLateHint(); toggleOrderTotal();
}
function clearClientDeliveryFields(){
  $('cRecipient').value='';$('cRecipientPhone').value='';$('cDelivery').value='';$('cNotes').value='';$('cOrderTotal').value='';clientDelivery=null;clientQuote=null;clientSubmissionId=null;hideClientQuote();$('cDeliveryStatus').textContent='Scrivi almeno 3 caratteri e seleziona un risultato.';saveClientDraft();
}
function setClientVehicle(v,invalidate=true){
  clientVehicle=v;document.querySelectorAll('[data-client-vehicle]').forEach(b=>b.classList.toggle('active',b.dataset.clientVehicle===v));if(invalidate)invalidateClientQuote();saveClientDraft();
}
function toggleOrderTotal(){ $('cOrderTotalWrap').classList.toggle('hidden',$('cPayment').value!=='cash'); if($('cPayment').value!=='cash')$('cOrderTotal').value=''; }
function clientStructuredWhatsApp(d=clientFormData(), q=clientQuote){
  return `Ciao Marcello, avrei bisogno di una consegna SOS.\n\n*Locale:* ${d.requesterName||'—'}\n*Ritiro:* ${d.pickupAddress||'—'}\n*Ordine pronto:* ${d.readyTime||'—'}\n*Destinatario:* ${d.recipientName||'—'}\n*Telefono:* ${d.recipientPhone||'—'}\n*Consegna:* ${d.deliveryAddress||'—'}\n*Servizio:* ${vehicleLabel(d.service)}\n*Pagamento:* ${paymentLabel(d.payment)}${d.payment==='cash'?`\n*Importo ordine:* ${money(d.orderTotal)}`:''}${q?`\n*Tariffa SOS:* ${money(q.total)}${q.lateFee?' (include +€2 serale)':''}`:''}${d.notes?`\n*Note:* ${d.notes}`:''}`;
}
async function submitClientRequest(){
  const status=$('clientSendStatus'),sendBtn=$('clientSendRequest');
  if(sendBtn.disabled)return;
  sendBtn.disabled=true;status.className='status-line';status.textContent='Verifico disponibilità e dati…';
  try{
    const d=validateClientForm(true);if(!clientQuote)throw new Error('Ricalcola prima la tariffa.');
    if(!clientSubmissionId)clientSubmissionId=(crypto.randomUUID?.()||uid('SUB'));
    getAudioCtx('client')?.resume?.();
    const av=await refreshAvailability();if(av?.mode==='offline')throw new Error('Il rider è segnato come non disponibile. Puoi contattarlo su WhatsApp.');
    if(av?.mode==='busy'&&!confirm(`Il rider è attualmente occupato. Nuova partenza stimata ~${av.etaMin||25} min. Vuoi comunque inviare la richiesta?`))return;
    status.textContent='Invio automatico all’Area Rider…';
    const payload={...d,submissionId:clientSubmissionId,clientQuote:{distanceKm:clientQuote.distanceKm,total:clientQuote.total},formStartedAt:Number(sessionStorage.getItem('sosClientStartedAt')||Date.now()),website:'sos-rider-v10'};
    const headers=authSession&&authProfile?.role==='client'?authHeaders():{'Accept':'application/json','Content-Type':'application/json'};
    const res=await fetchJson(apiBase()+'/api/requests',{method:'POST',headers,body:JSON.stringify(payload)},12000);
    if(!res?.request?.code||!res?.clientToken)throw new Error('Risposta server incompleta.');
    const r=res.request;clientQuote={service:r.service,distanceKm:Number(r.distanceKm),durationMin:Number(r.durationMin)||0,source:r.routeSource||'server',base:Number(r.baseFee),lateFee:Number(r.lateFee),total:Number(r.totalFee),micro:!!r.microDelivery,readyTime:r.readyTime};renderClientQuote();await generateClientQuoteImage();
    localStorage.setItem(CLIENT_ACTIVE_KEY,JSON.stringify({code:r.code,token:res.clientToken,owned:!!(authSession&&authProfile?.role==='client')}));addClientHistory(r.code);saveClientDraft();
    if(authProfile?.role==='client')updateMyProfile({displayName:d.requesterName,phone:d.requesterPhone,pickupAddress:d.pickupAddress,pickupLat:d.pickupLat,pickupLon:d.pickupLon}).catch(()=>{});
    clientSubmissionId=null;
    showClientRequestStatus(r,res.clientToken,!!(authSession&&authProfile?.role==='client'));status.className='status-line ok';status.textContent='✓ Richiesta inviata automaticamente.';currentAvailability=res.availability||currentAvailability;renderAvailability();loadClientRecent();
  }catch(e){status.className='status-line error';status.innerHTML=`⚠ Invio automatico non riuscito: ${esc(e.message)}<br><a class="btn whatsapp-btn full" style="margin-top:8px" href="${waLink(clientStructuredWhatsApp())}" target="_blank" rel="noopener">INVIA I DATI SU WHATSAPP</a>`;}finally{sendBtn.disabled=false;}
}
function showClientRequestStatus(r,token,owned=false){
  $('clientFormCard').classList.add('hidden');$('clientQuoteSection').classList.add('hidden');$('clientRequestStatus').classList.remove('hidden');$('clientRequestCode').textContent=r.code;$('clientStatusWhatsapp').href=waLink(`Ciao Marcello, ho inviato la richiesta SOS Rider ${r.code}.`);lastClientStatus=null;updateClientStatusUI(r);startClientPolling(r.code,token,owned);$('clientRequestStatus').scrollIntoView({behavior:'smooth',block:'start'});
}
function updateClientStatusUI(r){
  const s=r.status||'new',badge=$('clientStatusBadge');if(lastClientStatus&&lastClientStatus!==s)playDing();lastClientStatus=s;badge.className='request-state';const price=Number(r.totalFee||r.total_fee||0);$('clientConfirmedPrice').textContent=price?`Tariffa consegna: ${money(price)}`:'';
  if(s==='new'){badge.classList.add('waiting');badge.textContent='IN ATTESA DEL RIDER';$('clientStatusText').textContent='La richiesta è arrivata nell’Area Rider. Attendi la conferma.';$('clientStatusIcon').textContent='…';}
  else if(s==='accepted'){badge.classList.add('accepted');badge.textContent='ACCETTATA · RIDER IN ARRIVO AL LOCALE';$('clientStatusText').textContent='Marcello ha accettato la consegna e si sta organizzando per il ritiro.';$('clientStatusIcon').textContent='✓';}
  else if(s==='picked'){badge.classList.add('progress');badge.textContent='IN CONSEGNA';$('clientStatusText').textContent='Ordine ritirato: il rider è diretto al destinatario.';$('clientStatusIcon').textContent='⚡';}
  else if(s==='arrived'){badge.classList.add('progress');badge.textContent='RIDER ARRIVATO';$('clientStatusText').textContent='Il rider è arrivato al punto di consegna.';$('clientStatusIcon').textContent='📍';}
  else if(s==='delivered'){badge.classList.add('accepted');badge.textContent='COMPLETATO';$('clientStatusText').textContent='Consegna completata. Grazie per aver usato SOS Rider.';$('clientStatusIcon').textContent='✓';stopClientPolling();}
  else if(s==='rejected'||s==='cancelled'){badge.classList.add('rejected');badge.textContent=s==='rejected'?'RICHIESTA NON ACCETTATA':'RICHIESTA ANNULLATA';$('clientStatusText').textContent=r.rejectionReason||'In questo momento la consegna non è disponibile.';$('clientStatusIcon').textContent='×';stopClientPolling();}
}
function restoreActiveClientRequest(){
  try{const x=JSON.parse(localStorage.getItem(CLIENT_ACTIVE_KEY)||'null');if(x?.code&&x?.token){$('clientRequestCode').textContent=x.code;$('clientFormCard').classList.add('hidden');$('clientQuoteSection').classList.add('hidden');$('clientRequestStatus').classList.remove('hidden');startClientPolling(x.code,x.token,!!x.owned,true)}}catch{}
}
function startClientPolling(code,token,owned=false,immediate=false){
  stopClientPolling();const go=async()=>{try{let url,headers;if(owned&&authSession&&authProfile?.role==='client'){url=apiBase()+`/api/client/requests/${encodeURIComponent(code)}`;headers=authHeaders()}else{const u=new URL(apiBase()+`/api/requests/${encodeURIComponent(code)}`);u.searchParams.set('token',token);url=u.toString();headers={Accept:'application/json'}}const d=await fetchJson(url,{headers},7000);if(d?.request)updateClientStatusUI(d.request)}catch(e){console.warn('Status client non disponibile',e)}};if(immediate)go();clientPolling=setInterval(go,4000);
}
function stopClientPolling(){if(clientPolling){clearInterval(clientPolling);clientPolling=null;}}

// ---------- Rider auth / sync ----------
async function refreshRemoteRequests(){
  if(!$('riderHub') || $('riderHub').classList.contains('hidden')) return;
  if(authProfile?.role!=='rider'||!authSession){$('syncDot').className='sync-dot offline';$('syncTitle').textContent='Accesso Rider richiesto';$('syncText').textContent='Sessione non valida.';return;}
  try{
    const u=new URL(apiBase()+'/api/rider/requests');u.searchParams.set('limit','100');
    const d=await fetchJson(u.toString(),{headers:riderHeaders()},8000);remoteRequests=d.requests||[];
    $('syncDot').className='sync-dot online';$('syncTitle').textContent='Richieste online';$('syncText').textContent=`Sincronizzato ${new Date().toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}`;$('riderSyncSmall').textContent=`${authUser?.email||'Rider'} · online`;renderRemoteRequests();
    const newCodes=new Set(remoteRequests.filter(r=>r.status==='new').map(r=>r.code));
    const first=[...newCodes][0];if(first&&(!lastRemoteNewCodes.has(first)||!alarmActiveCode))startAlarm(first);lastRemoteNewCodes=newCodes;
    refreshAvailability();
  }catch(e){
    $('syncDot').className='sync-dot offline';$('syncTitle').textContent='Sync non disponibile';$('syncText').textContent=e.status===401||e.status===403?'Sessione o ruolo non valido. Accedi di nuovo.':'Controlla Worker/API e connessione.';$('riderSyncSmall').textContent='Offline · dati locali disponibili';
  }
}
async function manualRiderRefresh(){
  const b=$('riderRefresh');
  if(!b||b.disabled)return;
  const oldTitle=b.title;
  b.disabled=true;
  b.classList.add('refreshing');
  b.setAttribute('aria-busy','true');
  b.title='Aggiornamento in corso';
  if($('syncTitle'))$('syncTitle').textContent='Aggiornamento…';
  if($('syncText'))$('syncText').textContent='Controllo nuove richieste e stato rider.';
  const started=Date.now();
  try{
    await Promise.all([refreshRemoteRequests(),refreshAvailability()]);
  }finally{
    const wait=Math.max(0,550-(Date.now()-started));
    setTimeout(()=>{
      b.classList.remove('refreshing');
      b.disabled=false;
      b.removeAttribute('aria-busy');
      b.title=oldTitle||'Aggiorna';
    },wait);
  }
}
function startRiderPolling(){stopRiderPolling();riderPolling=setInterval(refreshRemoteRequests,4000)}
function stopRiderPolling(){if(riderPolling){clearInterval(riderPolling);riderPolling=null;}}
function remoteStatusLabel(s){return s==='new'?'NUOVA':s==='accepted'?'ACCETTATA':s==='picked'?'IN CONSEGNA':s==='arrived'?'ARRIVATO':s==='delivered'?'COMPLETATA':s==='rejected'?'RIFIUTATA':s==='cancelled'?'ANNULLATA':String(s||'').toUpperCase();}
function renderRemoteRequests(){
  const visible=remoteRequests.filter(r=>['new','accepted'].includes(r.status));const newOnes=visible.filter(r=>r.status==='new');$('newRequestCount').textContent=newOnes.length;
  if(!visible.length){$('remoteRequestsList').innerHTML='<section class="card"><div class="eyebrow">TUTTO TRANQUILLO</div><h2>Nessuna richiesta in attesa</h2><p class="muted">Le nuove richieste guidate compariranno qui automaticamente.</p></section>';return;}
  $('remoteRequestsList').innerHTML=visible.map(r=>{const exists=state.orders.some(o=>o.remoteCode===r.code);return `<article class="request-card ${r.status==='new'?'new':'accepted'}" data-remote-code="${esc(r.code)}"><div class="request-top"><div><div class="code">${esc(r.code)}</div><div class="tiny">${fmtDateTime(r.createdAt||r.created_at)}</div></div><span class="pill ${r.status==='new'?'yellow':'green'}">${remoteStatusLabel(r.status)}</span></div><div class="request-grid"><div class="kv"><small>RICHIEDENTE</small><b>${esc(r.requesterName||r.requester_name)}</b></div><div class="kv"><small>PRONTO</small><b>${esc(r.readyTime||r.ready_time||'—')}</b></div><div class="kv"><small>SERVIZIO</small><b>${vehicleIcon(r.service)} ${esc(r.microDelivery?'Micro E-bike':vehicleLabel(r.service))}</b></div><div class="kv"><small>TARIFFA SOS</small><b>${money(r.totalFee||r.total_fee)}</b></div></div><div class="route-box"><b>📍 Ritiro</b> ${esc(r.pickupAddress||r.pickup_address)}<br><b>🏁 Consegna</b> ${esc(r.deliveryAddress||r.delivery_address)}<br><b>👤</b> ${esc(r.recipientName||r.recipient_name)} · ${esc(r.recipientPhone||r.recipient_phone)}</div><div class="request-actions">${r.status==='new'?`<button class="btn ghost" data-reject="${esc(r.code)}">RIFIUTA</button><button class="btn primary" data-accept="${esc(r.code)}">⚡ ACCETTA ORDINE</button>`:`<button class="btn ghost" data-map-remote="${esc(r.code)}">PERCORSO</button><button class="btn primary" data-open-delivery="${esc(r.code)}">${exists?'APRI CONSEGNA':'IMPORTA CONSEGNA'}</button>`}</div></article>`}).join('');
}
async function patchRemote(code,body){return fetchJson(apiBase()+`/api/rider/requests/${encodeURIComponent(code)}`,{method:'PATCH',headers:riderHeaders(),body:JSON.stringify(body)},8000)}
function findRemote(code){return remoteRequests.find(r=>r.code===code)}
function currentShift(){return state.shifts.find(s=>s.id===state.currentShiftId && s.status!=='closed')||null}
function startShift(name,fund){const s={id:uid('SHIFT'),name:name||`${new Date().toLocaleDateString('it-IT')} sera`,startAt:nowIso(),endAt:null,fundStart:num(fund),status:'open'};state.shifts.push(s);state.currentShiftId=s.id;saveState();renderDeliveries();return s;}
function ensureShiftThen(done){if(currentShift()){done();return;}openModal('Apri turno per accettare',`<p class="muted">La richiesta può essere accettata appena apri il turno.</p><label>Nome turno<input id="mShiftName" value="${esc(new Date().toLocaleDateString('it-IT',{weekday:'long',day:'2-digit',month:'2-digit'})+' sera')}"></label><label style="margin-top:8px">Fondo resto<input id="mFund" type="number" min="0" value="100"></label>`,[{label:'ANNULLA',cls:'ghost'},{label:'APRI TURNO E CONTINUA',cls:'primary',fn:()=>{startShift($('mShiftName').value.trim(),num($('mFund').value));closeModal();done();}}]);}
function normalizeRemote(r){return{code:r.code,requesterName:r.requesterName||r.requester_name,requesterPhone:r.requesterPhone||r.requester_phone,pickupAddress:r.pickupAddress||r.pickup_address,pickupLat:Number(r.pickupLat??r.pickup_lat),pickupLon:Number(r.pickupLon??r.pickup_lon),readyTime:r.readyTime||r.ready_time,recipientName:r.recipientName||r.recipient_name,recipientPhone:r.recipientPhone||r.recipient_phone,deliveryAddress:r.deliveryAddress||r.delivery_address,deliveryLat:Number(r.deliveryLat??r.delivery_lat),deliveryLon:Number(r.deliveryLon??r.delivery_lon),service:r.service,payment:r.payment,orderTotal:Number(r.orderTotal??r.order_total)||0,notes:r.notes||'',distanceKm:Number(r.distanceKm??r.distance_km)||0,durationMin:Number(r.durationMin??r.duration_min)||0,baseFee:Number(r.baseFee??r.base_fee)||0,lateFee:Number(r.lateFee??r.late_fee)||0,totalFee:Number(r.totalFee??r.total_fee)||0,microDelivery:!!(r.microDelivery??r.micro_delivery),createdAt:r.createdAt||r.created_at||nowIso(),status:r.status};}
function createLocalOrderFromRemote(raw){const r=normalizeRemote(raw);let o=state.orders.find(o=>o.remoteCode===r.code);if(o)return o;const s=currentShift();o={id:uid('ORD'),remoteCode:r.code,shiftId:s?.id||null,code:r.code,restaurant:r.requesterName,pickupAddress:r.pickupAddress,readyTime:r.readyTime,customer:r.recipientName,phone:r.recipientPhone,address:r.deliveryAddress,total:r.orderTotal,fee:r.totalFee,payment:r.payment,vehicle:r.service,distanceKm:r.distanceKm,durationMin:r.durationMin,baseFee:r.baseFee,lateFee:r.lateFee,microDelivery:r.microDelivery,pickupLat:r.pickupLat,pickupLon:r.pickupLon,lat:r.deliveryLat,lon:r.deliveryLon,received:0,change:0,status:'to_pickup',outcome:null,problemNote:'',cashSorted:false,restaurantSettled:false,createdAt:r.createdAt,pickedAt:null,arrivedAt:null,deliveredAt:null,notes:r.notes||''};state.orders.push(o);state.settings.restaurantAddresses[o.restaurant]={label:o.pickupAddress,lat:o.pickupLat,lon:o.pickupLon};saveState();renderRiderAll();return o;}
async function acceptRemote(code){const r=findRemote(code);if(!r)return;stopAlarm(code);ensureShiftThen(async()=>{try{const d=await patchRemote(code,{status:'accepted'});createLocalOrderFromRemote(d.request||r);await refreshRemoteRequests();switchRiderPage('deliveries');}catch(e){alert('Non sono riuscito ad accettare la richiesta: '+e.message)}});}
async function rejectRemote(code){if(!confirm(`Rifiutare ${code}? Il cliente vedrà che la richiesta non è disponibile.`))return;stopAlarm(code);try{await patchRemote(code,{status:'rejected'});await refreshRemoteRequests();}catch(e){alert('Errore: '+e.message)}}

// ---------- Operatività rider ----------
function cashTotals(shiftId){
  const arr=state.orders.filter(o=>o.shiftId===shiftId&&o.status==='delivered'&&o.payment==='cash'&&o.outcome!=='cancelled');
  const unsorted=arr.filter(o=>!o.cashSorted), unsettled=arr.filter(o=>!o.restaurantSettled);
  return {change:unsorted.reduce((a,o)=>a+num(o.change),0),unsorted:unsorted.reduce((a,o)=>a+num(o.received),0),due:unsettled.reduce((a,o)=>a+num(o.total),0)};
}
function currentFundAvailable(){
  const s=currentShift();
  if(!s)return 0;
  const cash=cashTotals(s.id);
  return Math.max(0,num(s.fundStart)-num(cash.change));
}
function editCurrentFund(){
  const s=currentShift();if(!s)return;
  const cash=cashTotals(s.id);
  const available=currentFundAvailable();
  openModal('Modifica fondo resto',`<p class="muted">Imposta quanto contante hai davvero disponibile adesso per dare il resto.</p><label>Fondo resto disponibile<input id="mAvailableFund" type="number" min="0" step="0.01" value="${available.toFixed(2)}"></label><div class="notice yellow" style="margin-top:8px">Il sistema aggiornerà il fondo iniziale in modo da mantenere corretti i resti già anticipati nel turno.</div>`,[
    {label:'ANNULLA',cls:'ghost'},
    {label:'SALVA FONDO',cls:'primary',keep:true,fn:()=>{const desired=num($('mAvailableFund').value);s.fundStart=roundHalf(desired+num(cash.change));saveState();closeModal();renderDeliveries();}}
  ]);
}
function renderDeliveries(){
  const s=currentShift(), has=!!s;$('noShiftCard').classList.toggle('hidden',has);$('shiftWork').classList.toggle('hidden',!has);if(!has)return;
  const orders=state.orders.filter(o=>o.shiftId===s.id), cash=cashTotals(s.id), delivered=orders.filter(o=>o.status==='delivered'&&o.outcome!=='cancelled');
  $('statFund').textContent=money(s.fundStart);$('statAvailable').textContent=money(Math.max(0,s.fundStart-cash.change));$('statUnsorted').textContent=money(cash.unsorted);$('statDue').textContent=money(cash.due);$('statFees').textContent=money(delivered.reduce((a,o)=>a+num(o.fee),0));$('shiftName').textContent=s.name;$('shiftMeta').textContent=`Iniziato ${fmtDateTime(s.startAt)} · ${orders.length} consegne registrate`;
  const active=orders.filter(o=>!['delivered','cancelled'].includes(o.status)&&o.outcome!=='cancelled');$('activeCount').textContent=active.length;$('activeOrders').innerHTML=active.length?active.slice().reverse().map(orderCard).join(''):'<p class="muted">Nessuna consegna attiva.</p>';renderRestaurantCash(s.id);
}
function cashPanel(o){
  const rec=num(o.received);
  const missing=Math.max(0,roundHalf(num(o.total)-rec));
  const change=rec>=o.total?roundHalf(rec-o.total):0;
  const fund=currentFundAvailable();
  const fundAfter=Math.max(0,roundHalf(fund-change));
  const stack=cashStacks[o.id]||[];
  const counts={}; stack.forEach(v=>counts[v]=(counts[v]||0)+1);
  const stackText=Object.entries(counts).map(([v,n])=>`€${v} × ${n}`).join(' · ');
  const deltaBox=missing>0
    ? `<div class="change-box cash-change missing"><small>MANCANO AL PAGAMENTO</small><b>${money(missing)}</b></div>`
    : `<div class="change-box cash-change"><small>RESTO DA DARE</small><b>${money(change)}</b></div>`;
  const fundWarning=change>fund
    ? `<div class="cash-warning">⚠ Fondo resto insufficiente di <b>${money(change-fund)}</b></div>`
    : change>0
      ? `<div class="cash-after">Dopo il resto ti rimangono <b>${money(fundAfter)}</b> nel fondo.</div>`
      : `<div class="cash-after">Fondo disponibile per eventuale resto.</div>`;
  return `<div class="cash-panel">
    <div class="cash-note"><b>💶 CASSA ALLA PORTA</b><br>Tocca le banconote che il cliente ti dà oppure inserisci l'importo manualmente.</div>

    <button type="button" class="fund-rest-box" data-cash-action="editfund" data-order-id="${o.id}">
      <small>FONDO RESTO DISPONIBILE · TOCCA PER MODIFICARE</small>
      <b>${money(fund)}</b>
      ${fundWarning}
    </button>

    <div class="cash-total-box"><small>CLIENTE TI DÀ</small><b>${money(rec)}</b><div class="cash-stack">${stackText||'Nessuna banconota selezionata'}</div></div>
    ${deltaBox}

    <div class="quick-cash">
      <button class="btn ghost cash-exact" data-cash-action="exact" data-order-id="${o.id}">PRECISO ${money(o.total)}</button>
      <button class="btn ghost" data-cash-action="add" data-value="5" data-order-id="${o.id}">+ €5</button>
      <button class="btn ghost" data-cash-action="add" data-value="10" data-order-id="${o.id}">+ €10</button>
      <button class="btn ghost" data-cash-action="add" data-value="20" data-order-id="${o.id}">+ €20</button>
      <button class="btn ghost" data-cash-action="add" data-value="50" data-order-id="${o.id}">+ €50</button>
      <button class="btn ghost" data-cash-action="add" data-value="100" data-order-id="${o.id}">+ €100</button>
      <button class="btn ghost" data-cash-action="undo" data-order-id="${o.id}">↶ ULTIMA</button>
      <button class="btn ghost" data-cash-action="reset" data-order-id="${o.id}">AZZERA</button>
    </div>

    <label class="cash-manual">Oppure importo ricevuto manuale
      <input data-received="${o.id}" type="number" inputmode="decimal" min="0" step="0.01" value="${rec||''}" placeholder="Importo ricevuto">
    </label>
  </div>`;
}
function orderCard(o){
  const pickup={label:o.pickupAddress,lat:o.pickupLat,lon:o.pickupLon},del={label:o.address,lat:o.lat,lon:o.lon};
  let actions='';
  if(o.status==='to_pickup') actions=`<a class="btn ghost" href="${mapsNavigate(pickup,o.vehicle)}" target="_blank" rel="noopener">📍 VAI AL RITIRO</a><button class="btn primary" data-order-action="picked" data-order-id="${o.id}">✓ RITIRATO</button>`;
  else if(o.status==='picked') actions=`<a class="btn ghost" href="${mapsNavigate(del,o.vehicle)}" target="_blank" rel="noopener">🏁 NAVIGA CLIENTE</a><button class="btn primary" data-order-action="arrived" data-order-id="${o.id}">📍 ARRIVATO</button>`;
  else if(o.status==='arrived') actions=`<button class="btn ghost" data-order-action="cancel" data-order-id="${o.id}">ANNULLA</button><button class="btn primary" data-order-action="delivered" data-order-id="${o.id}">✓ CONSEGNATO</button>`;
  const cash=o.payment==='cash'&&o.status==='arrived'?cashPanel(o):'';
  return `<article class="order-card" data-order-id="${o.id}"><div class="order-top"><div><div class="code">${esc(o.code)}</div><div class="tiny">${vehicleIcon(o.vehicle)} ${esc(vehicleLabel(o.vehicle))} · pronto ${esc(o.readyTime||'—')}</div></div><span class="pill yellow">${o.status==='to_pickup'?'DA RITIRARE':o.status==='picked'?'IN CONSEGNA':'ARRIVATO'}</span></div><div class="route-box"><b>🏪 ${esc(o.restaurant)}</b><br>${esc(o.pickupAddress)}<br><br><b>👤 ${esc(o.customer)}</b> · ${esc(o.phone||'—')}<br>${esc(o.address)}</div><div class="order-grid"><div class="kv"><small>TARIFFA SOS</small><b>${money(o.fee)}</b></div><div class="kv"><small>PAGAMENTO ORDINE</small><b>${esc(paymentLabel(o.payment))}</b></div>${o.payment==='cash'?`<div class="kv"><small>DA INCASSARE</small><b>${money(o.total)}</b></div>`:''}<div class="kv"><small>DISTANZA</small><b>${num(o.distanceKm).toFixed(1)} km</b></div></div>${cash}<div class="order-actions">${actions}</div></article>`;
}
async function orderAction(id,action){
  const o=state.orders.find(x=>x.id===id);if(!o)return;
  if(action==='picked'){o.status='picked';o.pickedAt=nowIso();}
  else if(action==='arrived'){o.status='arrived';o.arrivedAt=nowIso();}
  else if(action==='delivered'){
    if(o.payment==='cash'){
      o.received=num(o.received);if(o.received<o.total){alert(`Inserisci almeno ${money(o.total)} ricevuti dal cliente.`);return;}o.change=roundHalf(Math.max(0,o.received-o.total));
    }
    o.status='delivered';o.deliveredAt=nowIso();o.outcome=o.outcome||'success';
  } else if(action==='cancel'){
    if(!confirm('Annullare questa consegna? Resterà nello storico.'))return;o.status='cancelled';o.outcome='cancelled';
  }
  saveState();renderRiderAll();
  if(o.remoteCode){try{await patchRemote(o.remoteCode,{status:action==='cancel'?'cancelled':o.status});await refreshRemoteRequests();}catch(e){console.warn('Sync stato remoto fallita',e)}}
}
function renderRestaurantCash(shiftId){
  const cashOrders=state.orders.filter(o=>o.shiftId===shiftId&&o.status==='delivered'&&o.payment==='cash'&&o.outcome!=='cancelled');
  const groups={};cashOrders.forEach(o=>(groups[o.restaurant]||(groups[o.restaurant]=[])).push(o));const names=Object.keys(groups);
  if(!names.length){$('restaurantCash').innerHTML='<p class="muted">Nessun incasso in contanti da gestire.</p>';return;}
  $('restaurantCash').innerHTML=names.map(name=>{const arr=groups[name],uns=arr.filter(o=>!o.cashSorted),due=arr.filter(o=>!o.restaurantSettled);return `<article class="restaurant-card"><div class="restaurant-top"><div><b>${esc(name)}</b><div class="tiny">${arr.length} ordini in contanti</div></div>${due.length?'<span class="pill yellow">DA SALDARE</span>':'<span class="pill green">SALDATO</span>'}</div><div class="restaurant-money"><div class="kv"><small>DA SISTEMARE</small><b>${money(uns.reduce((a,o)=>a+o.received,0))}</b></div><div class="kv"><small>DA RENDERE</small><b>${money(due.reduce((a,o)=>a+o.total,0))}</b></div><div class="kv"><small>CONSEGNE</small><b>${arr.length}</b></div></div><div class="request-actions">${uns.length?`<button class="btn ghost" data-sort-cash="${esc(name)}">✓ SOLDI SISTEMATI</button>`:'<span></span>'}${due.length?`<button class="btn primary" data-settle="${esc(name)}">SALDA LOCALE</button>`:''}</div></article>`}).join('');
}
function sortCashForRestaurant(name){state.orders.filter(o=>o.restaurant===name&&o.payment==='cash'&&o.status==='delivered').forEach(o=>o.cashSorted=true);saveState();renderDeliveries()}
function settleRestaurant(name){const arr=state.orders.filter(o=>o.restaurant===name&&o.payment==='cash'&&o.status==='delivered'&&!o.restaurantSettled&&o.outcome!=='cancelled');const total=arr.reduce((a,o)=>a+num(o.total),0);if(!arr.length)return;if(confirm(`Confermi di aver restituito ${money(total)} a ${name}?`)){arr.forEach(o=>o.restaurantSettled=true);saveState();renderDeliveries()}}
function closeCurrentShift(){const s=currentShift();if(!s)return;const active=state.orders.some(o=>o.shiftId===s.id&&!['delivered','cancelled'].includes(o.status));if(active){alert('Chiudi prima le consegne attive.');return;}if(!confirm('Chiudere il turno attuale?'))return;s.status='closed';s.endAt=nowIso();state.currentShiftId=null;saveState();renderRiderAll()}

// ---------- WhatsApp fallback parser ----------
const LABELS = ['Locale','Ritiro','Ordine pronto','Destinatario','Cliente','Telefono','Consegna','Indirizzo','Contenuto','Servizio','Pagamento','Importo ordine','Totale ordine','Tariffa SOS','Prezzo','Note'];
function sanitizeWa(raw){return String(raw||'').replace(/\uFFFD/g,' ').replace(/[�]+/g,' ').replace(/\r/g,'\n').replace(/\*+/g,'*').replace(/\s+\n/g,'\n').trim();}
function splitLabelledMessage(raw){
  let text=sanitizeWa(raw).replace(/\n+/g,' ');
  const labelPattern=LABELS.map(s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|');
  text=text.replace(new RegExp(`\\s*\\*?(${labelPattern})\\s*:?\\*?\\s*`,'gi'),'\n$1: ');
  const rows={};
  text.split('\n').map(s=>s.trim()).filter(Boolean).forEach(line=>{const m=line.match(/^([^:]{2,30}):\s*(.*)$/);if(m)rows[m[1].trim().toLowerCase()]=m[2].trim();});
  return rows;
}
function detectVehicle(text){const t=String(text||'').toLowerCase();if(/moto|express/.test(t))return'moto';if(/auto|cargo/.test(t))return'auto';if(/e-?bike|ebike|economy|standard|bici/.test(t))return'ebike';return'ebike'}
function detectPayment(text){const t=String(text||'').toLowerCase();if(/contant|cash|incass/.test(t))return'cash';if(/pos|carta|bancomat/.test(t))return'pos';return'paid'}
function parseWa(raw){
  const rows=splitLabelledMessage(raw), get=(...ks)=>{for(const k of ks){const v=rows[k.toLowerCase()];if(v)return v;}return''};
  const moneyFrom=s=>{const m=String(s||'').match(/(\d{1,4}(?:[.,]\d{1,2})?)/);return m?Number(m[1].replace(',','.')):0};
  return {restaurant:get('Locale'),pickupAddress:get('Ritiro'),readyTime:(get('Ordine pronto').match(/\b\d{1,2}:\d{2}\b/)||[])[0]||'',customer:get('Destinatario','Cliente'),phone:digits(get('Telefono')),address:get('Consegna','Indirizzo'),vehicle:detectVehicle(get('Servizio')),payment:detectPayment(get('Pagamento')),orderTotal:moneyFrom(get('Importo ordine','Totale ordine')),fee:moneyFrom(get('Tariffa SOS','Prezzo')),notes:get('Note')};
}
function openWhatsAppImporter(){
  openModal('Importa da WhatsApp',`<p class="muted">Fallback per messaggi arrivati fuori dal flusso guidato. I messaggi generati da SOS Rider vengono letti in modo strutturato.</p><label>Incolla messaggio<textarea id="mWaText" rows="8" placeholder="Incolla qui il messaggio…"></textarea></label><div id="mWaResult" class="status-line"></div>`,[
    {label:'ANNULLA',cls:'ghost'},
    {label:'ANALIZZA',cls:'primary',keep:true,fn:()=>{const d=parseWa($('mWaText').value);renderWaParsed(d)}}
  ]);
}
function renderWaParsed(d){
  const r=$('mWaResult');
  r.innerHTML=`<div class="notice blue"><b>Controlla i campi prima di creare la consegna.</b><br>Il parser non sovrascrive dati nascosti: qui vedi esattamente cosa verrà registrato.</div>
  <div class="form-grid" style="margin-top:9px">
    <label>Locale<input id="mPRestaurant" value="${esc(d.restaurant||'')}"></label>
    <label>Ordine pronto<input id="mPReady" type="time" value="${esc(d.readyTime||'')}"></label>
    <label class="full">Indirizzo ritiro<input id="mPPickup" value="${esc(d.pickupAddress||'')}"></label>
    <label>Cliente<input id="mPCustomer" value="${esc(d.customer||'')}"></label>
    <label>Telefono<input id="mPPhone" inputmode="tel" value="${esc(d.phone||'')}"></label>
    <label class="full">Indirizzo consegna<input id="mPAddress" value="${esc(d.address||'')}"></label>
    <label>Servizio<select id="mPVehicle"><option value="ebike" ${d.vehicle==='ebike'?'selected':''}>Economy E-bike</option><option value="moto" ${d.vehicle==='moto'?'selected':''}>Moto Express</option><option value="auto" ${d.vehicle==='auto'?'selected':''}>Auto Cargo</option></select></label>
    <label>Pagamento<select id="mPPayment"><option value="paid" ${d.payment==='paid'?'selected':''}>Già pagato</option><option value="cash" ${d.payment==='cash'?'selected':''}>Contanti da incassare</option><option value="pos" ${d.payment==='pos'?'selected':''}>POS locale</option></select></label>
    <label>Importo ordine<input id="mPOrderTotal" type="number" min="0" step="0.01" value="${num(d.orderTotal)||''}"></label>
    <label>Tariffa SOS<input id="mPFee" type="number" min="0" step="0.01" value="${num(d.fee)||''}"></label>
    <label class="full">Note<textarea id="mPNotes" rows="2">${esc(d.notes||'')}</textarea></label>
  </div>
  <button id="mCreateParsed" class="btn primary full" style="margin-top:8px">CREA CONSEGNA</button>`;
  $('mCreateParsed').onclick=()=>createManualFromParsed({restaurant:$('mPRestaurant').value.trim(),pickupAddress:$('mPPickup').value.trim(),readyTime:$('mPReady').value,customer:$('mPCustomer').value.trim(),phone:digits($('mPPhone').value),address:$('mPAddress').value.trim(),vehicle:$('mPVehicle').value,payment:$('mPPayment').value,orderTotal:num($('mPOrderTotal').value),fee:num($('mPFee').value),notes:$('mPNotes').value.trim()});
}
function createManualFromParsed(d){
  ensureShiftThen(()=>{
    if(!d.restaurant||!d.pickupAddress||!d.customer||!d.address){alert('Completa almeno locale, ritiro, cliente e indirizzo di consegna.');return;}
    const o={id:uid('ORD'),remoteCode:null,shiftId:currentShift().id,code:`SOS-${String(state.orders.length+1).padStart(3,'0')}`,restaurant:d.restaurant,pickupAddress:d.pickupAddress,readyTime:d.readyTime,customer:d.customer,phone:d.phone,address:d.address,total:num(d.orderTotal),fee:num(d.fee),payment:d.payment,vehicle:d.vehicle,distanceKm:0,durationMin:0,baseFee:num(d.fee),lateFee:isLateTime(d.readyTime)?2:0,pickupLat:null,pickupLon:null,lat:null,lon:null,received:0,change:0,status:'to_pickup',outcome:null,problemNote:'',cashSorted:false,restaurantSettled:false,createdAt:nowIso(),pickedAt:null,arrivedAt:null,deliveredAt:null,notes:d.notes||''};state.orders.push(o);saveState();closeModal();renderRiderAll();switchRiderPage('deliveries');
  });
}

// ---------- Storico / analytics ----------
function historyOrders(){const q=$('historySearch')?.value.trim().toLowerCase()||'';return state.orders.filter(o=>o.status==='delivered'||o.outcome==='cancelled').filter(o=>!q||[o.code,o.restaurant,o.customer,o.address,o.phone].join(' ').toLowerCase().includes(q)).sort((a,b)=>new Date(b.deliveredAt||b.createdAt)-new Date(a.deliveredAt||a.createdAt));}
function renderHistory(){const arr=historyOrders();$('historyList').innerHTML=arr.length?arr.map(o=>`<article class="history-card ${o.outcome==='problem'?'problem':o.outcome==='cancelled'?'cancelled':''}"><div class="history-top"><div><div class="code">${esc(o.code)}</div><div class="tiny">${fmtDateTime(o.deliveredAt||o.createdAt)}</div></div><span class="pill ${o.outcome==='cancelled'?'':'green'}">${o.outcome==='cancelled'?'ANNULLATA':'CONSEGNATA'}</span></div><div class="request-grid"><div class="kv"><small>LOCALE</small><b>${esc(o.restaurant)}</b></div><div class="kv"><small>CLIENTE</small><b>${esc(o.customer)}</b></div><div class="kv"><small>TARIFFA SOS</small><b>${money(o.fee)}</b></div><div class="kv"><small>VALORE ORDINE</small><b>${money(o.total)}</b></div></div></article>`).join(''):'<section class="card"><p class="muted">Nessuna consegna nello storico.</p></section>'}
function analyticsOrders(){const done=state.orders.filter(o=>o.status==='delivered'&&o.outcome!=='cancelled');if(analyticsPeriod==='all')return done;const now=new Date(),start=new Date(now);if(analyticsPeriod==='today')start.setHours(0,0,0,0);else if(analyticsPeriod==='7d'){start.setDate(now.getDate()-6);start.setHours(0,0,0,0)}else if(analyticsPeriod==='30d'){start.setDate(now.getDate()-29);start.setHours(0,0,0,0)}return done.filter(o=>new Date(o.deliveredAt||o.createdAt)>=start)}
function renderAnalytics(){
  const arr=analyticsOrders(),rev=arr.reduce((a,o)=>a+num(o.fee),0),value=arr.reduce((a,o)=>a+num(o.total),0);$('aRevenue').textContent=money(rev);$('aOrders').textContent=arr.length;$('aAvg').textContent=money(arr.length?rev/arr.length:0);$('aOrderValue').textContent=money(value);
  const byDay={};arr.forEach(o=>{const k=new Date(o.deliveredAt||o.createdAt).toLocaleDateString('it-IT',{day:'2-digit',month:'2-digit'});byDay[k]=(byDay[k]||0)+num(o.fee)});const days=Object.entries(byDay);const max=Math.max(1,...days.map(x=>x[1]));$('dailyChart').innerHTML=days.length?days.map(([d,v])=>`<div class="bar-wrap"><div class="bar-value">${money(v).replace(',00','')}</div><div class="bar" style="height:${Math.max(3,v/max*130)}px"></div><div class="bar-label">${d}</div></div>`).join(''):'<p class="muted">Nessun dato nel periodo.</p>';
  const ranks={};arr.forEach(o=>{const k=o.restaurant||'Senza nome';ranks[k]=ranks[k]||{n:0,v:0};ranks[k].n++;ranks[k].v+=num(o.fee)});const list=Object.entries(ranks).sort((a,b)=>b[1].v-a[1].v).slice(0,8);$('restaurantRank').innerHTML=list.length?list.map(([name,x],i)=>`<div class="rank-row"><div class="rank-num">${i+1}</div><div><b>${esc(name)}</b><div class="tiny">${x.n} consegne</div></div><b>${money(x.v)}</b></div>`).join(''):'<p class="muted">Nessun dato.</p>';
}
function csvExport(){const rows=[['Codice','Locale','Cliente','Telefono','Ritiro','Consegna','Pronto','Servizio','Pagamento','Valore ordine','Tariffa SOS','Stato','Creata','Consegnata']];state.orders.forEach(o=>rows.push([o.code,o.restaurant,o.customer,o.phone,o.pickupAddress,o.address,o.readyTime,vehicleLabel(o.vehicle),paymentLabel(o.payment),num(o.total).toFixed(2),num(o.fee).toFixed(2),o.status,o.createdAt,o.deliveredAt||'']));return rows.map(r=>r.map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(';')).join('\n')}
function download(name,text,type='text/plain;charset=utf-8'){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500)}

// ---------- Modal / settings ----------
function openModal(title,html,actions=[]){$('modalTitle').textContent=title;$('modalBody').innerHTML=html;$('modalActions').innerHTML='';for(const a of actions){const b=document.createElement('button');b.className='btn '+(a.cls||'ghost');b.textContent=a.label;b.onclick=()=>{if(a.fn)a.fn();if(!a.keep && a.label!=='ANNULLA' && !a.fn)closeModal();else if(!a.keep && a.label==='ANNULLA')closeModal()};$('modalActions').appendChild(b)}$('modalBackdrop').classList.remove('hidden')}
function closeModal(){$('modalBackdrop').classList.add('hidden');$('modalBody').innerHTML='';$('modalActions').innerHTML=''}
function openSettings(){
  openModal('Impostazioni',`<div class="eyebrow">SOS RIDER V${APP_VERSION}</div><label style="margin-top:10px">URL Worker/API<input id="mApiBase" value="${esc(apiBase())}"></label><button id="mTestApi" class="btn ghost full" style="margin-top:8px">TEST SERVER</button><div id="mApiStatus" class="status-line"></div><div class="notice green">Accesso Rider: ${esc(authUser?.email||'—')} · ruolo verificato dal backend.</div><div class="notice yellow">Tema automatico: giorno 07:00-18:29, notte 18:30-06:59. Il selettore ◐ può forzare Day/Night.</div><div class="dual-actions"><button id="mBackup" class="btn ghost">BACKUP JSON</button><button id="mImport" class="btn ghost">IMPORTA JSON</button></div><div class="dual-actions"><button id="mLogout" class="btn ghost">ESCI ACCOUNT</button><a class="btn ghost" href="legacy-v8.3.html">APRI V8.3 BACKUP</a></div><button id="mPasskey" class="btn ghost full" style="margin-top:8px">🔑 REGISTRA PASSKEY <span class="beta-tag">BETA</span></button><button id="mInstall" class="btn primary full" style="margin-top:8px">INSTALLA APP</button>`,[
    {label:'CHIUDI',cls:'ghost',fn:closeModal,keep:true},
    {label:'SALVA',cls:'primary',keep:true,fn:()=>{state.settings.apiBase=($('mApiBase').value.trim()||DEFAULT_API).replace(/\/+$/,'');saveState();$('mApiStatus').className='status-line ok';$('mApiStatus').textContent='✓ URL salvato.';}}
  ]);
  $('mTestApi').onclick=async()=>{const el=$('mApiStatus');el.className='status-line';el.textContent='Test…';try{const base=($('mApiBase').value.trim()||DEFAULT_API).replace(/\/+$/,'');const d=await fetchJson(base+'/api/status',{headers:{Accept:'application/json'}},7000);el.className='status-line ok';el.textContent=`✓ ${d.version||'Server'} online · autocomplete ${d.capabilities?.address?'OK':'?'} · auth ${d.capabilities?.auth?'OK':'da configurare'} · Telegram ${d.capabilities?.telegram?'OK':'da configurare'}`;}catch(e){el.className='status-line error';el.textContent='⚠ '+e.message}};
  $('mBackup').onclick=()=>download(`sos-rider-v10-backup-${new Date().toISOString().slice(0,10)}.json`,JSON.stringify(state,null,2),'application/json');
  $('mImport').onclick=()=>{const input=document.createElement('input');input.type='file';input.accept='.json,application/json';input.onchange=async()=>{try{const d=JSON.parse(await input.files[0].text());if(!Array.isArray(d.orders)||!Array.isArray(d.shifts))throw 0;state={...defaultState(),...d,settings:{...defaultState().settings,...(d.settings||{})}};saveState();closeModal();renderRiderAll();alert('Backup importato.')}catch{alert('Backup non valido.')}};input.click()};
  $('mLogout').onclick=()=>{closeModal();logoutAccount()};$('mPasskey').onclick=registerPasskey;$('mInstall').onclick=installApp;
}

async function installApp(){if(deferredInstall){deferredInstall.prompt();await deferredInstall.userChoice;deferredInstall=null;return}alert('Su iPhone: Safari → Condividi → Aggiungi alla schermata Home. Su Android/Chrome usa “Installa app”.')}

// ---------- Rider rendering/navigation ----------
function renderRiderAll(){renderRemoteRequests();renderDeliveries();renderHistory();renderAnalytics()}
function switchRiderPage(name){
  const map={requests:'riderPageRequests',deliveries:'riderPageDeliveries',history:'riderPageHistory',analytics:'riderPageAnalytics'};Object.values(map).forEach(id=>$(id).classList.remove('active'));$(map[name]).classList.add('active');document.querySelectorAll('[data-rider-page]').forEach(b=>b.classList.toggle('active',b.dataset.riderPage===name));if(name==='requests')refreshRemoteRequests();if(name==='history')renderHistory();if(name==='analytics')renderAnalytics();window.scrollTo({top:0,behavior:'instant'});
}

// ---------- Events ----------
function bindEvents(){
  $('openClientHub').onclick=openClient;$('openLoginHub').onclick=openLogin;$('riderGoLoginBtn').onclick=openLogin;$('guestLoginBtn').onclick=openLogin;document.querySelectorAll('[data-back-home]').forEach(b=>b.onclick=openHome);document.querySelectorAll('[data-theme-toggle]').forEach(b=>b.onclick=cycleTheme);
  $('authLoginBtn').onclick=loginEmail;$('authPassword').addEventListener('keydown',e=>{if(e.key==='Enter')loginEmail()});$('authPasskeyLoginBtn').onclick=loginPasskey;$('authForgotBtn').onclick=forgotPassword;$('authShowSignupBtn').onclick=()=>{$('signupCard').classList.remove('hidden');$('signupCard').scrollIntoView({behavior:'smooth'})};$('authHideSignupBtn').onclick=()=>$('signupCard').classList.add('hidden');$('authSignupBtn').onclick=signupClient;
  $('clientLogoutBtn').onclick=logoutAccount;$('clientRegisterPasskey').onclick=registerPasskey;
  $('directWhatsapp').href=waLink('Ciao Marcello, avrei bisogno di una consegna SOS.');$('clientStatusWhatsapp').href=waLink('Ciao Marcello, avrei bisogno di informazioni sulla mia richiesta SOS Rider.');
  document.querySelectorAll('[data-client-vehicle]').forEach(b=>b.onclick=()=>setClientVehicle(b.dataset.clientVehicle));
  $('cReadyTime').addEventListener('input',()=>{updateLateHint();invalidateClientQuote();saveClientDraft()});$('cPayment').addEventListener('change',()=>{toggleOrderTotal();invalidateClientQuote();saveClientDraft()});
  $('clientRequestForm').addEventListener('input',e=>{if(!['cReadyTime','cPayment'].includes(e.target.id)){invalidateClientQuote();saveClientDraft()}});
  $('clientCalcQuote').onclick=calculateClientQuote;$('clientEditQuote').onclick=()=>{$('clientQuoteSection').classList.add('hidden');$('clientFormCard').scrollIntoView({behavior:'smooth',block:'start'})};$('clientSendRequest').onclick=submitClientRequest;
  $('clientNewRequest').onclick=()=>{localStorage.removeItem(CLIENT_ACTIVE_KEY);stopClientPolling();lastClientStatus=null;$('clientRequestStatus').classList.add('hidden');$('clientFormCard').classList.remove('hidden');clearClientDeliveryFields();$('clientFormCard').scrollIntoView({behavior:'smooth'})};
  $('clientRecentList').addEventListener('click',e=>{const b=e.target.closest('[data-repeat-client]');if(b)repeatClientRequest(b.dataset.repeatClient)});
  $('riderRefresh').onclick=manualRiderRefresh;$('openSettings').onclick=openSettings;$('riderAvailableBtn').onclick=()=>setRiderAvailability(true);$('riderOfflineBtn').onclick=()=>setRiderAvailability(false);$('riderEtaSelect').onchange=()=>{if(currentAvailability)setRiderAvailability(!!currentAvailability.enabled)};$('enableRiderAlarm').onclick=enableAlarm;
  document.querySelectorAll('[data-rider-page]').forEach(b=>b.onclick=()=>switchRiderPage(b.dataset.riderPage));
  $('remoteRequestsList').addEventListener('click',e=>{const a=e.target.closest('[data-accept]');if(a)return acceptRemote(a.dataset.accept);const r=e.target.closest('[data-reject]');if(r)return rejectRemote(r.dataset.reject);const m=e.target.closest('[data-map-remote]');if(m){const x=normalizeRemote(findRemote(m.dataset.mapRemote));window.open(mapsRoute({label:x.pickupAddress,lat:x.pickupLat,lon:x.pickupLon},{label:x.deliveryAddress,lat:x.deliveryLat,lon:x.deliveryLon},x.service),'_blank','noopener');return}const o=e.target.closest('[data-open-delivery]');if(o){const rr=findRemote(o.dataset.openDelivery);if(rr&&!state.orders.some(x=>x.remoteCode===rr.code))ensureShiftThen(()=>createLocalOrderFromRemote(rr));switchRiderPage('deliveries')}});
  $('openWaImporter').onclick=openWhatsAppImporter;$('newManualOrder').onclick=openWhatsAppImporter;
  $('startShiftBtn').onclick=()=>openModal('Inizia turno',`<label>Nome turno<input id="mShiftName" value="${esc(new Date().toLocaleDateString('it-IT',{weekday:'long',day:'2-digit',month:'2-digit'})+' sera')}"></label><label style="margin-top:8px">Fondo resto<input id="mFund" type="number" min="0" value="100"></label>`,[{label:'ANNULLA',cls:'ghost'},{label:'INIZIA',cls:'primary',keep:true,fn:()=>{startShift($('mShiftName').value.trim(),num($('mFund').value));closeModal()}}]);
  $('closeShiftBtn').onclick=closeCurrentShift;
  $('statAvailable')?.closest('.stat-card')?.addEventListener('click',editCurrentFund);
  $('activeOrders').addEventListener('click',e=>{
    const cashBtn=e.target.closest('[data-cash-action]');
    if(cashBtn){
      const o=state.orders.find(x=>x.id===cashBtn.dataset.orderId);if(!o)return;
      const action=cashBtn.dataset.cashAction;
      if(action==='editfund'){editCurrentFund();return;}
      if(action==='exact'){cashStacks[o.id]=[];o.received=num(o.total);o.change=0;}
      else if(action==='add'){cashStacks[o.id]=cashStacks[o.id]||[];cashStacks[o.id].push(num(cashBtn.dataset.value));o.received=cashStacks[o.id].reduce((a,v)=>a+v,0);o.change=o.received>=o.total?roundHalf(o.received-o.total):0;}
      else if(action==='undo'){cashStacks[o.id]=cashStacks[o.id]||[];cashStacks[o.id].pop();o.received=cashStacks[o.id].reduce((a,v)=>a+v,0);o.change=o.received>=o.total?roundHalf(o.received-o.total):0;}
      else if(action==='reset'){cashStacks[o.id]=[];o.received=0;o.change=0;}
      saveState();renderDeliveries();return;
    }
    const b=e.target.closest('[data-order-action]');if(b)orderAction(b.dataset.orderId,b.dataset.orderAction);
  });
  $('activeOrders').addEventListener('input',e=>{const i=e.target.closest('[data-received]');if(!i)return;const o=state.orders.find(x=>x.id===i.dataset.received);if(!o)return;cashStacks[o.id]=[];o.received=num(i.value);o.change=o.received>=o.total?roundHalf(o.received-o.total):0;saveState();const b=i.closest('.order-card')?.querySelector('.change-box b');if(b)b.textContent=money(o.change)});
  $('restaurantCash').addEventListener('click',e=>{const a=e.target.closest('[data-sort-cash]');if(a)return sortCashForRestaurant(a.dataset.sortCash);const t=e.target.closest('[data-settle]');if(t)return settleRestaurant(t.dataset.settle)});
  $('historySearch').addEventListener('input',renderHistory);$('exportHistory').onclick=()=>download('sos-rider-storico.csv',csvExport(),'text/csv;charset=utf-8');
  document.querySelectorAll('[data-period]').forEach(b=>b.onclick=()=>{analyticsPeriod=b.dataset.period;document.querySelectorAll('[data-period]').forEach(x=>x.classList.toggle('active',x===b));renderAnalytics()});
  $('modalClose').onclick=closeModal;$('modalBackdrop').addEventListener('click',e=>{if(e.target===$('modalBackdrop'))closeModal()});$('clientInstallBtn').onclick=installApp;
}

function initAutocomplete(){
  wireAutocomplete({inputId:'cPickup',boxId:'cPickupSuggestions',statusId:'cPickupStatus',mapsId:'cPickupMaps',slotKey:'client-pickup',onSelect:v=>{clientPickup=v;saveClientDraft()}});
  wireAutocomplete({inputId:'cDelivery',boxId:'cDeliverySuggestions',statusId:'cDeliveryStatus',mapsId:'cDeliveryMaps',slotKey:'client-delivery',onSelect:v=>{clientDelivery=v;saveClientDraft()}});
}

async function bootRoute(){
  const p=new URLSearchParams(location.search),hub=p.get('hub');
  if(hub==='client')await openClient();else if(hub==='rider')await openRider();else if(hub==='login')openLogin();else openHome();
}

async function boot(){
  migrateAndLoad();applyTheme();bindEvents();initAutocomplete();setDefaultReadyTime();sessionStorage.setItem('sosClientStartedAt',String(Date.now()));
  window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstall=e;$('clientInstallBtn').classList.remove('hidden')});
  if('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>{});
  await syncAuthState();
  setInterval(()=>{if(themeMode()==='auto')applyTheme()},60000);
  setTimeout(()=>{$('splash').classList.add('out');setTimeout(async()=>{$('splash')?.remove();await bootRoute()},360)},1550);
}

boot();
})();
