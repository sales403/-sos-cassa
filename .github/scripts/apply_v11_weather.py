from pathlib import Path
import re

ROOT = Path('.')


def read(path):
    return (ROOT / path).read_text(encoding='utf-8')


def write(path, text):
    (ROOT / path).write_text(text, encoding='utf-8')


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'ANCHOR NOT FOUND: {label}')
    return text.replace(old, new, 1)


def replace_all_expected(text, old, new, label, minimum=1):
    count = text.count(old)
    if count < minimum:
        raise SystemExit(f'ANCHOR NOT FOUND/TOO FEW ({count}): {label}')
    return text.replace(old, new)


# ---------------- Worker ----------------
path = 'worker-v11.0.0-dispatch.js'
w = read(path)
w = replace_once(w, "const VERSION = 'SOS Rider API 11.1.0-batch';", "const VERSION = 'SOS Rider API 11.2.0-weather';", 'worker version')
w = replace_once(w, "const V11_BATCH_FEATURE = true;\nlet batchSchemaReady = false;", "const V11_BATCH_FEATURE = true;\nconst WEATHER_FEE_EUR = 3;\nlet batchSchemaReady = false;\nlet weatherSchemaReady = false;", 'worker weather constants')
w = replace_once(w, "            batch: !!env.DB,\n            push: !!(env.DB && env.VAPID_PRIVATE_JWK)", "            batch: !!env.DB,\n            weatherAdverse: !!env.DB,\n            push: !!(env.DB && env.VAPID_PRIVATE_JWK)", 'worker capabilities')

route_anchor = """      if (url.pathname === '/api/rider/availability' && request.method === 'PATCH') {
        requireDb(env);
        await requireRole(request, env, 'rider');
        return updateAvailability(request, env, cors);
      }

      if (url.pathname === '/api/rider/location' && request.method === 'GET') {"""
route_new = """      if (url.pathname === '/api/rider/availability' && request.method === 'PATCH') {
        requireDb(env);
        await requireRole(request, env, 'rider');
        return updateAvailability(request, env, cors);
      }

      if (url.pathname === '/api/rider/weather' && request.method === 'GET') {
        requireDb(env);
        await requireRole(request, env, 'rider');
        return json({ ok: true, weather: await getWeatherState(env) }, 200, cors);
      }

      if (url.pathname === '/api/rider/weather' && request.method === 'PATCH') {
        requireDb(env);
        await requireRole(request, env, 'rider');
        return updateWeatherState(request, env, cors);
      }

      if (url.pathname === '/api/rider/location' && request.method === 'GET') {"""
w = replace_once(w, route_anchor, route_new, 'worker weather routes')

old_tariff = """function tariffFor(km, service, readyTime) {
  km = Math.max(0, Number(km) || 0);

  let base;
  let micro = false;

  if (service === 'moto') {
    base = km <= 5 ? 9 : 9 + (km - 5) * 1.20;
  } else if (service === 'auto') {
    base = km <= 5 ? 12 : 12 + (km - 5) * 1.50;
  } else if (km <= 1) {
    base = 2.50;
    micro = true;
  } else {
    base = km <= 3 ? 6.50 : 6.50 + (km - 3) * 1.00;
  }

  base = roundHalf(base);
  const lateFee = isLate(readyTime) ? 2 : 0;

  return {
    baseFee: base,
    lateFee,
    totalFee: roundHalf(base + lateFee),
    microDelivery: micro
  };
}"""
new_tariff = """function tariffFor(km, service, readyTime, weatherAdverse = false) {
  km = Math.max(0, Number(km) || 0);

  let base;
  let micro = false;

  if (service === 'moto') {
    base = km <= 5 ? 9 : 9 + (km - 5) * 1.20;
  } else if (service === 'auto') {
    base = km <= 5 ? 12 : 12 + (km - 5) * 1.50;
  } else if (km <= 1) {
    base = 2.50;
    micro = true;
  } else {
    base = km <= 3 ? 6.50 : 6.50 + (km - 3) * 1.00;
  }

  base = roundHalf(base);
  const lateFee = isLate(readyTime) ? 2 : 0;
  const weatherFee = weatherAdverse ? WEATHER_FEE_EUR : 0;

  return {
    baseFee: base,
    lateFee,
    weatherFee,
    weatherAdverse: weatherFee > 0,
    totalFee: roundHalf(base + lateFee + weatherFee),
    microDelivery: micro
  };
}

async function ensureWeatherSchema(env) {
  if (weatherSchemaReady) return;

  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS operator_settings (
    id INTEGER PRIMARY KEY,
    weather_adverse INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  )`).run();

  await env.DB.prepare(
    `INSERT OR IGNORE INTO operator_settings(id,weather_adverse,updated_at) VALUES(1,0,?)`
  ).bind(new Date().toISOString()).run();

  const cols = await env.DB.prepare('PRAGMA table_info(requests)').all();
  const names = new Set((cols.results || []).map(x => String(x.name || '')));
  if (!names.has('weather_fee')) {
    await env.DB.prepare('ALTER TABLE requests ADD COLUMN weather_fee REAL NOT NULL DEFAULT 0').run();
  }

  weatherSchemaReady = true;
}

async function getWeatherState(env) {
  await ensureWeatherSchema(env);
  const row = await env.DB.prepare('SELECT weather_adverse,updated_at FROM operator_settings WHERE id=1').first();
  const adverse = Number(row?.weather_adverse) === 1;
  return {
    adverse,
    fee: adverse ? WEATHER_FEE_EUR : 0,
    updatedAt: row?.updated_at || new Date().toISOString()
  };
}

async function updateWeatherState(request, env, cors) {
  const p = await request.json().catch(() => fail('JSON non valido'));
  const adverse = !!p.adverse;
  await ensureWeatherSchema(env);
  await env.DB.prepare(
    'UPDATE operator_settings SET weather_adverse=?,updated_at=? WHERE id=1'
  ).bind(adverse ? 1 : 0, new Date().toISOString()).run();
  return json({ ok: true, weather: await getWeatherState(env) }, 200, cors);
}"""
w = replace_once(w, old_tariff, new_tariff, 'worker tariff weather')

old_quote_fee = """  const fee = tariffFor(
    route.distanceKm,
    service,
    readyTime
  );"""
new_quote_fee = """  const weather = env.DB ? await getWeatherState(env) : { adverse: false, fee: 0 };
  const fee = tariffFor(
    route.distanceKm,
    service,
    readyTime,
    weather.adverse
  );"""
w = replace_once(w, old_quote_fee, new_quote_fee, 'single quote weather')

# Batch schema gets weather_fee and auto-migrates existing staging DB.
w = replace_once(w, "    late_fee REAL NOT NULL DEFAULT 0,\n    total_fee REAL NOT NULL DEFAULT 0,", "    late_fee REAL NOT NULL DEFAULT 0,\n    weather_fee REAL NOT NULL DEFAULT 0,\n    total_fee REAL NOT NULL DEFAULT 0,", 'batch schema weather column')
w = replace_once(w, "  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_batch_items_batch_stop ON request_batch_items(batch_id, stop_index)').run();", "  const batchCols = await env.DB.prepare('PRAGMA table_info(request_batches)').all();\n  const batchNames = new Set((batchCols.results || []).map(x => String(x.name || '')));\n  if (!batchNames.has('weather_fee')) {\n    await env.DB.prepare('ALTER TABLE request_batches ADD COLUMN weather_fee REAL NOT NULL DEFAULT 0').run();\n  }\n  await ensureWeatherSchema(env);\n  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_batch_items_batch_stop ON request_batch_items(batch_id, stop_index)').run();", 'batch migration weather')

w = replace_once(w, "  const routeFee = tariffFor(totalDistanceKm, base.service, base.readyTime);\n  const extraStopFee = 3.50;\n  const totalFee = roundHalf(routeFee.totalFee + extraStopFee);", "  const weather = await getWeatherState(env);\n  const routeFee = tariffFor(totalDistanceKm, base.service, base.readyTime, weather.adverse);\n  const extraStopFee = 3.50;\n  const totalFee = roundHalf(routeFee.totalFee + extraStopFee);", 'batch weather calculation')
w = replace_once(w, "    lateFee: routeFee.lateFee,\n    extraStopFee,", "    lateFee: routeFee.lateFee,\n    weatherFee: routeFee.weatherFee,\n    weatherAdverse: routeFee.weatherAdverse,\n    extraStopFee,", 'batch result weather')
w = replace_once(w, "    lateFee: x.lateFee,\n    totalFee: x.totalFee,", "    lateFee: x.lateFee,\n    weatherFee: x.weatherFee,\n    weatherAdverse: x.weatherAdverse,\n    totalFee: x.totalFee,", 'batch public weather')
w = replace_once(w, "    b.total_fee AS batch_total_fee,b.extra_stop_fee,b.total_distance_km,b.route_order,b.status AS batch_status,", "    b.total_fee AS batch_total_fee,b.extra_stop_fee,b.weather_fee AS batch_weather_fee,b.total_distance_km,b.route_order,b.status AS batch_status,", 'batch meta query weather')
w = replace_once(w, "    batchExtraStopFee: Number(meta.extra_stop_fee) || 0,\n    batchTotalDistanceKm:", "    batchExtraStopFee: Number(meta.extra_stop_fee) || 0,\n    batchWeatherFee: Number(meta.batch_weather_fee) || 0,\n    batchTotalDistanceKm:", 'batch meta weather') if "    batchTotalDistanceKm:" in w else w
# Above branch may not match exact minified formatting in this Worker; handle canonical block too.
if "batchWeatherFee" not in w:
    w = replace_once(w, "    batchExtraStopFee: Number(meta.extra_stop_fee) || 0,\n    batchTotalDistanceKm: Number(meta.total_distance_km) || 0,", "    batchExtraStopFee: Number(meta.extra_stop_fee) || 0,\n    batchWeatherFee: Number(meta.batch_weather_fee) || 0,\n    batchTotalDistanceKm: Number(meta.total_distance_km) || 0,", 'batch attach weather fallback')

old_batch_insert = """    ready_time,service,total_distance_km,total_duration_min,base_fee,extra_stop_fee,late_fee,total_fee,route_order,status,created_at,updated_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
    batchId,submissionId,userId,clientToken,x.base.requesterName,x.base.requesterPhone,x.base.pickupAddress,x.base.pickupLat,x.base.pickupLon,
    x.base.readyTime,x.base.service,x.totalDistanceKm,x.totalDurationMin,x.baseFee,x.extraStopFee,x.lateFee,x.totalFee,
    x.routeOrder.join(','),'new',now,now"""
new_batch_insert = """    ready_time,service,total_distance_km,total_duration_min,base_fee,extra_stop_fee,late_fee,weather_fee,total_fee,route_order,status,created_at,updated_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
    batchId,submissionId,userId,clientToken,x.base.requesterName,x.base.requesterPhone,x.base.pickupAddress,x.base.pickupLat,x.base.pickupLon,
    x.base.readyTime,x.base.service,x.totalDistanceKm,x.totalDurationMin,x.baseFee,x.extraStopFee,x.lateFee,x.weatherFee,x.totalFee,
    x.routeOrder.join(','),'new',now,now"""
w = replace_once(w, old_batch_insert, new_batch_insert, 'batch insert weather')

w = replace_once(w, "      lateFee: Number(x.batch.late_fee) || 0,\n      totalFee: Number(x.batch.total_fee) || 0,", "      lateFee: Number(x.batch.late_fee) || 0,\n      weatherFee: Number(x.batch.weather_fee) || 0,\n      weatherAdverse: Number(x.batch.weather_fee) > 0,\n      totalFee: Number(x.batch.total_fee) || 0,", 'batch payload weather')

# Single request always recalculates weather at submit time.
old_create_fee = """  const fee = tariffFor(
    route.distanceKm,
    d.service,
    d.readyTime
  );"""
new_create_fee = """  const weather = await getWeatherState(env);
  const fee = tariffFor(
    route.distanceKm,
    d.service,
    d.readyTime,
    weather.adverse
  );"""
w = replace_once(w, old_create_fee, new_create_fee, 'single create weather')

old_req_cols = """          base_fee,
          late_fee,
          total_fee,
          micro_delivery,
          rejection_reason"""
new_req_cols = """          base_fee,
          late_fee,
          weather_fee,
          total_fee,
          micro_delivery,
          rejection_reason"""
w = replace_once(w, old_req_cols, new_req_cols, 'single request weather column')
w = replace_once(w, """          ?,?,?,?,?,?,?,?,?,?,
          ?,?,?,?,?,?,?,?,?,?
        )`""", """          ?,?,?,?,?,?,?,?,?,?,
          ?,?,?,?,?,?,?,?,?,?,?
        )`""", 'single insert placeholders')
w = replace_once(w, """        fee.baseFee,
        fee.lateFee,
        fee.totalFee,
        fee.microDelivery ? 1 : 0,""", """        fee.baseFee,
        fee.lateFee,
        fee.weatherFee,
        fee.totalFee,
        fee.microDelivery ? 1 : 0,""", 'single insert bind weather')
w = replace_once(w, "    lateFee: r.late_fee,\n    totalFee: r.total_fee,", "    lateFee: r.late_fee,\n    weatherFee: Number(r.weather_fee) || 0,\n    weatherAdverse: Number(r.weather_fee) > 0,\n    totalFee: r.total_fee,", 'rowBase weather')

# Batch child requests need the new requests.weather_fee column too, but the global +3 is stored once on the batch.
old_batch_req = """      distance_km,duration_min,route_source,base_fee,late_fee,total_fee,micro_delivery,rejection_reason
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind("""
new_batch_req = """      distance_km,duration_min,route_source,base_fee,late_fee,weather_fee,total_fee,micro_delivery,rejection_reason
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind("""
w = replace_once(w, old_batch_req, new_batch_req, 'batch child request weather column')
w = replace_once(w, "      x.base.service,s.payment,s.orderTotal,s.notes,direct.distanceKm,direct.durationMin,direct.source,share,0,share,\n      (x.base.service === 'ebike'", "      x.base.service,s.payment,s.orderTotal,s.notes,direct.distanceKm,direct.durationMin,direct.source,share,0,0,share,\n      (x.base.service === 'ebike'", 'batch child request weather bind')

write(path, w)


# ---------------- App JS ----------------
def patch_app(path):
    a = read(path)
    a = replace_once(a, "const APP_VERSION = '11.1.0-batch';", "const APP_VERSION = '11.2.0-weather';", f'{path} version')
    a = replace_once(a, "let currentAvailability = null;", "let currentAvailability = null;\nlet currentWeatherAdverse = null;", f'{path} weather state')
    a = replace_once(a, "  refreshRemoteRequests();\n  startRiderPolling(); startAvailabilityPolling();", "  refreshRemoteRequests();\n  refreshRiderWeather();\n  startRiderPolling(); startAvailabilityPolling();", f'{path} rider initial weather')

    availability_anchor = """async function setRiderAvailability(enabled){
  try{
    const eta=Number($('riderEtaSelect').value)||15;
    const d=await fetchJson(apiBase()+'/api/rider/availability',{method:'PATCH',headers:riderHeaders(),body:JSON.stringify({enabled,etaPerJob:eta})},8000);
    currentAvailability=d.availability;
    renderAvailability();
    if(enabled){
      startRiderLocationTracking();
      captureRiderLocationOnce(true).catch(()=>{});
    }else{
      stopRiderLocationTracking();
    }
  }catch(e){alert('Stato rider non aggiornato: '+e.message)}
}

// ---------- Posizione Rider / Dispatch ----------"""
    weather_funcs = """async function setRiderAvailability(enabled){
  try{
    const eta=Number($('riderEtaSelect').value)||15;
    const d=await fetchJson(apiBase()+'/api/rider/availability',{method:'PATCH',headers:riderHeaders(),body:JSON.stringify({enabled,etaPerJob:eta})},8000);
    currentAvailability=d.availability;
    renderAvailability();
    if(enabled){
      startRiderLocationTracking();
      captureRiderLocationOnce(true).catch(()=>{});
    }else{
      stopRiderLocationTracking();
    }
  }catch(e){alert('Stato rider non aggiornato: '+e.message)}
}

function renderRiderWeather(){
  const el=$('riderWeatherStatus');if(!el)return;
  const on=!!currentWeatherAdverse?.adverse;
  el.className='rider-gps-status '+(on?'warn':'ok');
  el.textContent=on?'☔ Meteo avverso: ON · +3 € su tutti i nuovi preventivi':'☔ Meteo avverso: OFF · nessun supplemento';
  if($('riderWeatherOnBtn'))$('riderWeatherOnBtn').setAttribute('aria-pressed',on?'true':'false');
  if($('riderWeatherOffBtn'))$('riderWeatherOffBtn').setAttribute('aria-pressed',on?'false':'true');
}
async function refreshRiderWeather(){
  if(authProfile?.role!=='rider'||!authSession)return null;
  try{
    const d=await fetchJson(apiBase()+'/api/rider/weather',{headers:riderHeaders()},7000);
    currentWeatherAdverse=d.weather||null;renderRiderWeather();return currentWeatherAdverse;
  }catch(e){console.warn('Stato meteo non disponibile',e);return null}
}
async function setRiderWeather(adverse){
  try{
    const d=await fetchJson(apiBase()+'/api/rider/weather',{method:'PATCH',headers:riderHeaders(),body:JSON.stringify({adverse:!!adverse})},7000);
    currentWeatherAdverse=d.weather||null;renderRiderWeather();
  }catch(e){alert('Meteo avverso non aggiornato: '+e.message)}
}

// ---------- Posizione Rider / Dispatch ----------"""
    a = replace_once(a, availability_anchor, weather_funcs, f'{path} weather functions')

    a = replace_once(a, "function startRiderPolling(){stopRiderPolling();riderPolling=setInterval(refreshRemoteRequests,4000)}", "function startRiderPolling(){stopRiderPolling();riderPolling=setInterval(()=>{refreshRemoteRequests();refreshRiderWeather();},4000)}", f'{path} rider weather polling')

    # quote data
    a = replace_once(a, "lateFee:Number(q.lateFee)||0,total:Number(q.totalFee)", "lateFee:Number(q.lateFee)||0,weatherFee:Number(q.weatherFee)||0,weatherAdverse:!!q.weatherAdverse,total:Number(q.totalFee)", f'{path} batch quote weather')
    a = replace_once(a, "lateFee:Number(q.lateFee)||0,total:Number(q.totalFee),micro:", "lateFee:Number(q.lateFee)||0,weatherFee:Number(q.weatherFee)||0,weatherAdverse:!!q.weatherAdverse,total:Number(q.totalFee),micro:", f'{path} single quote weather')
    a = replace_once(a, "  $('cqLateNotice').classList.toggle('hidden', !clientQuote.lateFee);", "  $('cqLateNotice').classList.toggle('hidden', !clientQuote.lateFee);\n  $('cqWeatherRow')?.classList.toggle('hidden', !clientQuote.weatherFee);", f'{path} render weather row')

    # image summary
    a = replace_once(a, "${clientQuote.micro?'Micro E-bike':'Tariffa base'} ${money(clientQuote.base)}${clientQuote.lateFee?'  +  serale €2,00':''}", "${clientQuote.micro?'Micro E-bike':'Tariffa base'} ${money(clientQuote.base)}${clientQuote.lateFee?'  +  serale €2,00':''}${clientQuote.weatherFee?'  +  meteo avverso €3,00':''}", f'{path} quote image weather')

    # WhatsApp messages
    a = replace_once(a, "${q?`\\n\\n*Tariffa giro SOS:* ${money(q.total)}`:''}`;", "${q&&q.weatherFee?`\\n\\n*Supplemento meteo avverso:* + €3,00`:''}${q?`\\n*Tariffa giro SOS:* ${money(q.total)}`:''}`;", f'{path} batch whatsapp weather')
    a = replace_once(a, "${q?`\\n*Tariffa SOS:* ${money(q.total)}`:''}${d.notes?", "${q&&q.weatherFee?`\\n*Supplemento meteo avverso:* + €3,00`:''}${q?`\\n*Tariffa SOS:* ${money(q.total)}`:''}${d.notes?", f'{path} single whatsapp weather')

    # server-confirmed single quote may change if operator toggled weather between quote and submit
    a = replace_once(a, "base:Number(r.baseFee),lateFee:Number(r.lateFee),total:Number(r.totalFee),micro:", "base:Number(r.baseFee),lateFee:Number(r.lateFee),weatherFee:Number(r.weatherFee)||0,weatherAdverse:!!r.weatherAdverse,total:Number(r.totalFee),micro:", f'{path} submitted single weather')

    # remote normalization/local history
    a = replace_once(a, "lateFee:Number(r.lateFee??r.late_fee)||0,totalFee:Number(r.totalFee??r.total_fee)||0,microDelivery:", "lateFee:Number(r.lateFee??r.late_fee)||0,weatherFee:Number(r.weatherFee??r.weather_fee)||0,weatherAdverse:!!(r.weatherAdverse??((Number(r.weather_fee)||0)>0)),totalFee:Number(r.totalFee??r.total_fee)||0,microDelivery:", f'{path} normalize weather')
    a = replace_once(a, "batchExtraStopFee:Number(r.batchExtraStopFee)||0,batchTotalDistanceKm:", "batchExtraStopFee:Number(r.batchExtraStopFee)||0,batchWeatherFee:Number(r.batchWeatherFee)||0,batchTotalDistanceKm:", f'{path} normalize batch weather')
    a = replace_once(a, "baseFee:r.baseFee,lateFee:r.lateFee,microDelivery:", "baseFee:r.baseFee,lateFee:r.lateFee,weatherFee:r.weatherFee||0,weatherAdverse:!!r.weatherAdverse,microDelivery:", f'{path} local order weather')
    a = replace_once(a, "batchExtraStopFee:r.batchExtraStopFee||0};state.orders.push", "batchExtraStopFee:r.batchExtraStopFee||0,batchWeatherFee:r.batchWeatherFee||0};state.orders.push", f'{path} local batch weather')

    # UI event bindings
    a = replace_once(a, "$('riderRefresh').onclick=manualRiderRefresh;$('openSettings').onclick=openSettings;$('riderAvailableBtn').onclick=()=>setRiderAvailability(true);$('riderOfflineBtn').onclick=()=>setRiderAvailability(false);", "$('riderRefresh').onclick=manualRiderRefresh;$('openSettings').onclick=openSettings;$('riderAvailableBtn').onclick=()=>setRiderAvailability(true);$('riderOfflineBtn').onclick=()=>setRiderAvailability(false);if($('riderWeatherOnBtn'))$('riderWeatherOnBtn').onclick=()=>setRiderWeather(true);if($('riderWeatherOffBtn'))$('riderWeatherOffBtn').onclick=()=>setRiderWeather(false);", f'{path} weather bindings')

    return a

for p in ['app.js','preview-v11/app.js']:
    write(p, patch_app(p))


# ---------------- App HTML ----------------
def patch_app_html(path):
    h = read(path)
    h = h.replace('styles.css?v=11.1.0-batch', 'styles.css?v=11.2.0-weather')
    h = h.replace('app.js?v=11.1.0-batch', 'app.js?v=11.2.0-weather')

    h = replace_once(h, """        <div id=\"cqLateRow\" class=\"hidden\"><span>Supplemento serale dopo 22:30</span><b>+ €2,00</b></div>
        <div id=\"cqBatchRow\" class=\"hidden\"><span>Seconda fermata / gestione giro</span><b id=\"cqBatchExtra\">+ €3,50</b></div>""", """        <div id=\"cqLateRow\" class=\"hidden\"><span>Supplemento serale dopo 22:30</span><b>+ €2,00</b></div>
        <div id=\"cqWeatherRow\" class=\"hidden\"><span>Supplemento meteo avverso</span><b>+ €3,00</b></div>
        <div id=\"cqBatchRow\" class=\"hidden\"><span>Seconda fermata / gestione giro</span><b id=\"cqBatchExtra\">+ €3,50</b></div>""", f'{path} quote weather row')

    h = replace_once(h, """      <div class=\"rider-gps-row\">
        <div id=\"riderGpsStatus\" class=\"rider-gps-status idle\">GPS: in attesa di posizione…</div>
        <button id=\"riderGpsRefresh\" class=\"btn ghost small\" type=\"button\">AGGIORNA GPS</button>
      </div>
    </section>""", """      <div class=\"rider-gps-row\">
        <div id=\"riderGpsStatus\" class=\"rider-gps-status idle\">GPS: in attesa di posizione…</div>
        <button id=\"riderGpsRefresh\" class=\"btn ghost small\" type=\"button\">AGGIORNA GPS</button>
      </div>
      <div class=\"rider-gps-row\">
        <div id=\"riderWeatherStatus\" class=\"rider-gps-status idle\">☔ Meteo avverso: controllo stato…</div>
        <div class=\"operator-toggle\" aria-label=\"Supplemento meteo avverso\">
          <button id=\"riderWeatherOnBtn\" class=\"btn status-on small\" type=\"button\" aria-pressed=\"false\">METEO ON +€3</button>
          <button id=\"riderWeatherOffBtn\" class=\"btn status-off small\" type=\"button\" aria-pressed=\"true\">METEO OFF</button>
        </div>
      </div>
    </section>""", f'{path} operator weather toggle')
    return h

for p in ['index.html','preview-v11/index.html']:
    write(p, patch_app_html(p))


# ---------------- Landing site copy ----------------
site_path = 'site/index.html'
s = read(site_path)
s = replace_once(s, "<p>Spesa, più pacchi e carichi più voluminosi. Più spazio, più flessibilità.</p>", "<p>Ideale anche in caso di maltempo, spesa, più colli o carichi ingombranti.</p>", 'site cargo copy')
# Also make the pricing-card subline carry the same requested message without changing structure.
s = replace_once(s, "<p class=\"premium-card-sub\">Più spazio per ogni esigenza.</p>", "<p class=\"premium-card-sub\">Ideale anche in caso di maltempo, spesa, più colli o carichi ingombranti.</p>", 'site cargo pricing copy')

night_block = """        <div class=\"premium-night-fee reveal\">
          <div class=\"moon-icon\">
            <svg viewBox=\"0 0 48 48\" aria-hidden=\"true\"><path d=\"M34 34A17 17 0 0 1 18 8a18 18 0 1 0 16 26Z\"/></svg>
          </div>
          <div><b>Supplemento serale:</b> dopo le 22:30</div>
          <strong>+ € 2,00</strong>
        </div>

        <div class=\"premium-price-footer reveal\">"""
weather_site = """        <div class=\"premium-night-fee reveal\">
          <div class=\"moon-icon\">
            <svg viewBox=\"0 0 48 48\" aria-hidden=\"true\"><path d=\"M34 34A17 17 0 0 1 18 8a18 18 0 1 0 16 26Z\"/></svg>
          </div>
          <div><b>Supplemento serale:</b> dopo le 22:30</div>
          <strong>+ € 2,00</strong>
        </div>

        <div class=\"premium-night-fee reveal\">
          <div class=\"moon-icon\">
            <svg viewBox=\"0 0 48 48\" aria-hidden=\"true\"><path d=\"M8 25c2-10 10-16 16-16s14 6 16 16H8Z\"/><path d=\"M24 25v12c0 3 2 5 5 5s5-2 5-5\"/><path d=\"M14 7l-2-4M24 5V1M34 7l2-4\"/></svg>
          </div>
          <div><b>Meteo avverso:</b> quando effettivamente necessario</div>
          <strong>+ € 3,00</strong>
        </div>

        <div class=\"premium-price-footer reveal\">
          <span>ⓘ I supplementi vengono applicati solo quando effettivamente necessari, in base alle condizioni della richiesta.</span>
        </div>

        <div class=\"premium-price-footer reveal\">"""
s = replace_once(s, night_block, weather_site, 'site weather supplement block')
write(site_path, s)


# ---------------- Service worker cache bust ----------------
for p in ['sw.js','preview-v11/sw.js']:
    sw = read(p)
    sw = re.sub(r"const CACHE='[^']+';", "const CACHE='sos-rider-v11-20260911-weather-1120';", sw, count=1)
    write(p, sw)

print('V11 weather adverse patch applied successfully')
