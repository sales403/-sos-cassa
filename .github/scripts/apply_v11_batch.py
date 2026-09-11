from pathlib import Path
import re

ROOT = Path('.')


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'Anchor missing: {label}')
    return text.replace(old, new, 1)


def replace_between(text, start, end, new, label):
    i = text.find(start)
    if i < 0:
        raise SystemExit(f'Start anchor missing: {label}')
    j = text.find(end, i)
    if j < 0:
        raise SystemExit(f'End anchor missing: {label}')
    return text[:i] + new.rstrip() + '\n\n' + text[j:]

# ---------------- WORKER ----------------
wp = ROOT / 'worker-v11.0.0-dispatch.js'
w = wp.read_text()
if 'V11_BATCH_FEATURE' not in w:
    w = w.replace("const VERSION = 'SOS Rider API 11.0.2-dispatch';", "const VERSION = 'SOS Rider API 11.1.0-batch';\nconst V11_BATCH_FEATURE = true;\nlet batchSchemaReady = false;")
    w = replace_once(w, "            maxConcurrentOrders: 2,\n            push:", "            maxConcurrentOrders: 2,\n            batch: !!env.DB,\n            push:", 'capability batch')

    route_anchor = "      if (url.pathname === '/api/quote' && request.method === 'POST') {\n        return handleQuote(request, env, cors);\n      }\n"
    route_new = route_anchor + "\n      if (url.pathname === '/api/batch/quote' && request.method === 'POST') {\n        requireDb(env);\n        return handleBatchQuote(request, env, cors);\n      }\n\n      if (url.pathname === '/api/requests/batch' && request.method === 'POST') {\n        requireDb(env);\n        return createBatchRequest(request, env, ctx, cors);\n      }\n\n      const guestBatchMatch = url.pathname.match(/^\\/api\\/batches\\/([^/]+)$/);\n      if (guestBatchMatch && request.method === 'GET') {\n        requireDb(env);\n        return getGuestBatch(guestBatchMatch[1], url, env, cors);\n      }\n"
    w = replace_once(w, route_anchor, route_new, 'batch public routes')

    rider_route_anchor = "      const riderMatch = url.pathname.match(/^\\/api\\/rider\\/requests\\/([^/]+)$/);\n"
    rider_route_new = "      const riderBatchMatch = url.pathname.match(/^\\/api\\/rider\\/batches\\/([^/]+)$/);\n      if (riderBatchMatch && request.method === 'PATCH') {\n        requireDb(env);\n        await requireRole(request, env, 'rider');\n        return updateRiderBatch(riderBatchMatch[1], request, env, cors);\n      }\n\n" + rider_route_anchor
    w = replace_once(w, rider_route_anchor, rider_route_new, 'batch rider route')

    batch_helpers = r'''
// ---------- V11_BATCH_FEATURE: giri multi-consegna (2 stop) ----------
async function ensureBatchSchema(env) {
  if (batchSchemaReady) return;
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS request_batches (
    batch_id TEXT PRIMARY KEY,
    submission_id TEXT NOT NULL UNIQUE,
    user_id TEXT NOT NULL DEFAULT '',
    client_token TEXT NOT NULL,
    requester_name TEXT NOT NULL,
    requester_phone TEXT NOT NULL,
    pickup_address TEXT NOT NULL,
    pickup_lat REAL NOT NULL,
    pickup_lon REAL NOT NULL,
    ready_time TEXT NOT NULL,
    service TEXT NOT NULL,
    total_distance_km REAL NOT NULL DEFAULT 0,
    total_duration_min INTEGER NOT NULL DEFAULT 0,
    base_fee REAL NOT NULL DEFAULT 0,
    extra_stop_fee REAL NOT NULL DEFAULT 3.5,
    late_fee REAL NOT NULL DEFAULT 0,
    total_fee REAL NOT NULL DEFAULT 0,
    route_order TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'new',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS request_batch_items (
    batch_id TEXT NOT NULL,
    code TEXT NOT NULL UNIQUE,
    stop_index INTEGER NOT NULL,
    fee_share REAL NOT NULL DEFAULT 0,
    PRIMARY KEY(batch_id, code)
  )`).run();
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_batch_items_batch_stop ON request_batch_items(batch_id, stop_index)').run();
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_batches_created ON request_batches(created_at DESC)').run();
  batchSchemaReady = true;
}

function makeBatchId() {
  const d = new Date();
  const day = String(d.getUTCDate()).padStart(2, '0');
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const rnd = Math.random().toString(36).slice(2, 6).toUpperCase();
  return 'BG-' + mo + day + '-' + rnd;
}

function validateBatchBase(p) {
  const d = {
    requesterName: cleanText(p.requesterName, 80),
    requesterPhone: cleanPhone(p.requesterPhone),
    pickupAddress: cleanText(p.pickupAddress, 180),
    pickupLat: Number(p.pickupLat),
    pickupLon: Number(p.pickupLon),
    readyTime: cleanText(p.readyTime, 5),
    service: cleanText(p.service, 10)
  };
  if (!d.requesterName || d.requesterPhone.length < 9) fail('Dati richiedente incompleti');
  if (!d.pickupAddress || !validCoord(d.pickupLat, d.pickupLon)) fail('Indirizzo ritiro non verificato');
  if (!/^\d{2}:\d{2}$/.test(d.readyTime)) fail('Orario pronto non valido');
  if (!['ebike','moto','auto'].includes(d.service)) fail('Servizio non valido');
  return d;
}

function validateBatchStop(x, index) {
  const d = {
    recipientName: cleanText(x?.recipientName, 80),
    recipientPhone: cleanPhone(x?.recipientPhone),
    deliveryAddress: cleanText(x?.deliveryAddress, 180),
    deliveryLat: Number(x?.deliveryLat),
    deliveryLon: Number(x?.deliveryLon),
    payment: cleanText(x?.payment, 10),
    orderTotal: Number(x?.orderTotal) || 0,
    notes: cleanText(x?.notes, 400),
    originalIndex: index
  };
  if (!d.recipientName || d.recipientPhone.length < 9) fail('Dati destinatario ' + (index + 1) + ' incompleti');
  if (!d.deliveryAddress || !validCoord(d.deliveryLat, d.deliveryLon)) fail('Indirizzo consegna ' + (index + 1) + ' non verificato');
  if (!['paid','cash','pos'].includes(d.payment)) fail('Pagamento consegna ' + (index + 1) + ' non valido');
  if (d.payment === 'cash' && d.orderTotal <= 0) fail('Importo da incassare consegna ' + (index + 1) + ' non valido');
  return d;
}

async function calculateBatchData(env, p) {
  const base = validateBatchBase(p);
  const inputStops = Array.isArray(p.deliveries) ? p.deliveries : [];
  if (inputStops.length !== 2) fail('Il giro multiplo supporta esattamente 2 consegne');
  const stops = inputStops.map(validateBatchStop);

  const pickupPoint = base.pickupLon + ',' + base.pickupLat;
  const aPoint = stops[0].deliveryLon + ',' + stops[0].deliveryLat;
  const bPoint = stops[1].deliveryLon + ',' + stops[1].deliveryLat;
  const [pA, pB, aB, bA] = await Promise.all([
    routeData(pickupPoint, aPoint, base.service),
    routeData(pickupPoint, bPoint, base.service),
    routeData(aPoint, bPoint, base.service),
    routeData(bPoint, aPoint, base.service)
  ]);

  const abKm = pA.distanceKm + aB.distanceKm;
  const baKm = pB.distanceKm + bA.distanceKm;
  const useAB = abKm <= baKm;
  const ordered = useAB ? [stops[0], stops[1]] : [stops[1], stops[0]];
  const firstLeg = useAB ? pA : pB;
  const secondLeg = useAB ? aB : bA;
  const totalDistanceKm = firstLeg.distanceKm + secondLeg.distanceKm;
  const totalDurationMin = firstLeg.durationMin + secondLeg.durationMin;
  const routeFee = tariffFor(totalDistanceKm, base.service, base.readyTime);
  const extraStopFee = 3.50;
  const totalFee = roundHalf(routeFee.totalFee + extraStopFee);

  const singleRoutes = [pA, pB];
  const singleFees = singleRoutes.map(r => tariffFor(r.distanceKm, base.service, base.readyTime).totalFee);
  const weightTotal = Math.max(0.5, singleFees[0] + singleFees[1]);
  let share0 = roundHalf(totalFee * singleFees[0] / weightTotal);
  share0 = Math.max(0.5, Math.min(totalFee - 0.5, share0));
  const share1 = roundHalf(totalFee - share0);
  const sharesByOriginal = [share0, share1];

  const pickupAvailability = await buildPickupAvailabilityPreview(env, {
    pickupLat: base.pickupLat,
    pickupLon: base.pickupLon,
    service: base.service,
    readyTime: base.readyTime
  });
  const activeNow = Number(pickupAvailability?.active) || 0;
  if (pickupAvailability?.enabled && activeNow + 2 > MAX_ACTIVE_ORDERS) {
    pickupAvailability.level = 'red';
    pickupAvailability.title = 'Giro da 2 consegne · capacità momentaneamente piena';
    pickupAvailability.text = 'Per accettare questo giro servono 2 slot liberi. Completa prima la consegna attiva.';
    pickupAvailability.canAcceptNow = false;
  } else if (pickupAvailability) {
    pickupAvailability.canAcceptNow = !!pickupAvailability.enabled;
  }

  const pickupMin = Math.max(1, Number(pickupAvailability?.pickupEtaMin) || 1);
  const firstDeliveryMin = pickupMin + ETA_MODEL.pickupBufferMin + travelMinutes(firstLeg.distanceKm, base.service);
  const secondDeliveryMin = firstDeliveryMin + ETA_MODEL.dropoffBufferMin + travelMinutes(secondLeg.distanceKm, base.service);
  const stopEtaByOriginal = {};
  stopEtaByOriginal[ordered[0].originalIndex] = etaWindow(firstDeliveryMin);
  stopEtaByOriginal[ordered[1].originalIndex] = etaWindow(secondDeliveryMin);

  return {
    base,
    stops,
    ordered,
    routeOrder: ordered.map(x => x.originalIndex),
    firstLeg,
    secondLeg,
    singleRoutes,
    sharesByOriginal,
    totalDistanceKm,
    totalDurationMin,
    baseFee: routeFee.baseFee,
    lateFee: routeFee.lateFee,
    extraStopFee,
    totalFee,
    pickupAvailability,
    stopEtaByOriginal
  };
}

function batchQuotePublic(x) {
  return {
    batch: true,
    service: x.base.service,
    totalDistanceKm: Math.round(x.totalDistanceKm * 10) / 10,
    totalDurationMin: x.totalDurationMin,
    baseFee: x.baseFee,
    extraStopFee: x.extraStopFee,
    lateFee: x.lateFee,
    totalFee: x.totalFee,
    routeOrder: x.routeOrder,
    pickupAvailability: x.pickupAvailability,
    stops: x.routeOrder.map((originalIndex, pos) => ({
      originalIndex,
      stopIndex: pos + 1,
      recipientName: x.stops[originalIndex].recipientName,
      deliveryAddress: x.stops[originalIndex].deliveryAddress,
      eta: x.stopEtaByOriginal[originalIndex]
    }))
  };
}

async function handleBatchQuote(request, env, cors) {
  await ensureBatchSchema(env);
  const p = await request.json().catch(() => fail('JSON non valido'));
  const x = await calculateBatchData(env, p);
  return json({ ok: true, quote: batchQuotePublic(x), availability: x.pickupAvailability }, 200, cors);
}

async function loadBatchMetaMap(env) {
  await ensureBatchSchema(env);
  const r = await env.DB.prepare(`SELECT i.code,i.batch_id,i.stop_index,i.fee_share,
    b.total_fee AS batch_total_fee,b.extra_stop_fee,b.total_distance_km,b.route_order,b.status AS batch_status,
    b.pickup_address AS batch_pickup_address,b.pickup_lat AS batch_pickup_lat,b.pickup_lon AS batch_pickup_lon
    FROM request_batch_items i JOIN request_batches b ON b.batch_id=i.batch_id
    WHERE b.created_at >= datetime('now','-30 day')`).all();
  const m = new Map();
  for (const row of (r.results || [])) m.set(row.code, row);
  return m;
}

function attachBatchMeta(obj, meta, size=2) {
  if (!meta) return obj;
  return {
    ...obj,
    batchId: meta.batch_id,
    batchStopIndex: Number(meta.stop_index) || 1,
    batchSize: size,
    batchTotalFee: Number(meta.batch_total_fee) || 0,
    batchExtraStopFee: Number(meta.extra_stop_fee) || 0,
    batchTotalDistanceKm: Number(meta.total_distance_km) || 0,
    batchRouteOrder: meta.route_order || '',
    batchStatus: meta.batch_status || 'new',
    batchPickupAddress: meta.batch_pickup_address || obj.pickupAddress,
    batchPickupLat: Number(meta.batch_pickup_lat),
    batchPickupLon: Number(meta.batch_pickup_lon)
  };
}

async function createBatchRequest(request, env, ctx, cors) {
  await ensureBatchSchema(env);
  const p = await request.json().catch(() => fail('JSON non valido'));
  if (p.hp || p.websiteUrl) fail('Richiesta non valida');
  const submissionId = cleanText(p.submissionId, 80);
  if (!/^[A-Za-z0-9_-]{10,80}$/.test(submissionId)) fail('Identificativo invio non valido');

  const auth = await requireAuth(request, env, true);
  if (auth?.profile?.role === 'rider') fail('L’account Rider non può creare richieste cliente', 403);
  const userId = auth?.profile?.role === 'client' ? auth.user.id : '';

  const existing = await env.DB.prepare('SELECT * FROM request_batches WHERE submission_id=?').bind(submissionId).first();
  if (existing) {
    if (userId && existing.user_id !== userId) fail('Identificativo invio già utilizzato', 409);
    return json({ ok: true, idempotent: true, ...(await getBatchPayload(env, existing.batch_id, false)) }, 200, cors);
  }

  const availability = await computeAvailability(env);
  if (availability.mode === 'offline') fail('Rider non disponibile in questo momento. Usa WhatsApp per richieste particolari.', 409);
  const x = await calculateBatchData(env, p);
  const batchId = makeBatchId();
  const clientToken = token();
  const codes = [makeCode(), makeCode()];
  if (codes[0] === codes[1]) codes[1] = makeCode();
  const now = new Date().toISOString();

  const stopIndexByOriginal = {};
  x.routeOrder.forEach((originalIndex, i) => { stopIndexByOriginal[originalIndex] = i + 1; });

  const statements = [];
  statements.push(env.DB.prepare(`INSERT INTO request_batches(
    batch_id,submission_id,user_id,client_token,requester_name,requester_phone,pickup_address,pickup_lat,pickup_lon,
    ready_time,service,total_distance_km,total_duration_min,base_fee,extra_stop_fee,late_fee,total_fee,route_order,status,created_at,updated_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
    batchId,submissionId,userId,clientToken,x.base.requesterName,x.base.requesterPhone,x.base.pickupAddress,x.base.pickupLat,x.base.pickupLon,
    x.base.readyTime,x.base.service,x.totalDistanceKm,x.totalDurationMin,x.baseFee,x.extraStopFee,x.lateFee,x.totalFee,
    x.routeOrder.join(','),'new',now,now
  ));

  for (let originalIndex = 0; originalIndex < 2; originalIndex++) {
    const s = x.stops[originalIndex];
    const direct = x.singleRoutes[originalIndex];
    const share = x.sharesByOriginal[originalIndex];
    statements.push(env.DB.prepare(`INSERT INTO requests(
      code,client_token,submission_id,user_id,created_at,updated_at,status,requester_name,requester_phone,pickup_address,pickup_lat,pickup_lon,
      ready_time,recipient_name,recipient_phone,delivery_address,delivery_lat,delivery_lon,service,payment,order_total,notes,
      distance_km,duration_min,route_source,base_fee,late_fee,total_fee,micro_delivery,rejection_reason
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
      codes[originalIndex],clientToken,submissionId + '_' + (originalIndex + 1),userId,now,now,'new',x.base.requesterName,x.base.requesterPhone,
      x.base.pickupAddress,x.base.pickupLat,x.base.pickupLon,x.base.readyTime,s.recipientName,s.recipientPhone,s.deliveryAddress,s.deliveryLat,s.deliveryLon,
      x.base.service,s.payment,s.orderTotal,s.notes,direct.distanceKm,direct.durationMin,direct.source,share,0,share,
      (x.base.service === 'ebike' && direct.distanceKm <= 1) ? 1 : 0,''
    ));
    statements.push(env.DB.prepare('INSERT INTO request_batch_items(batch_id,code,stop_index,fee_share) VALUES(?,?,?,?)').bind(
      batchId,codes[originalIndex],stopIndexByOriginal[originalIndex],share
    ));
    statements.push(env.DB.prepare('INSERT OR IGNORE INTO request_sources(code,channel,external_id,created_at) VALUES(?,?,?,?)').bind(
      codes[originalIndex],'app-batch',submissionId,now
    ));
  }
  await env.DB.batch(statements);

  if (auth?.profile?.role === 'client') {
    await env.DB.prepare('UPDATE profiles SET display_name=?,phone=?,pickup_address=?,pickup_lat=?,pickup_lon=?,updated_at=? WHERE user_id=?').bind(
      x.base.requesterName,x.base.requesterPhone,x.base.pickupAddress,x.base.pickupLat,x.base.pickupLon,now,auth.user.id
    ).run();
  }
  for (const code of codes) await safeLogEvent(env, code, 'request_created', '', 'new', 'app-batch', { batchId, batchSize: 2 });

  const notify = async () => { await Promise.allSettled([sendPushToAll(env)]); };
  if (ctx?.waitUntil) ctx.waitUntil(notify()); else notify().catch(() => {});
  return json({ ok: true, ...(await getBatchPayload(env, batchId, false)) }, 201, cors);
}

async function getBatchRows(env, batchId) {
  await ensureBatchSchema(env);
  const batch = await env.DB.prepare('SELECT * FROM request_batches WHERE batch_id=?').bind(batchId).first();
  if (!batch) return { batch: null, rows: [] };
  const q = await env.DB.prepare(`SELECT r.*,i.stop_index,i.fee_share FROM request_batch_items i
    JOIN requests r ON r.code=i.code WHERE i.batch_id=? ORDER BY i.stop_index ASC`).bind(batchId).all();
  return { batch, rows: q.results || [] };
}

function deriveBatchStatus(rows) {
  if (!rows.length) return 'new';
  if (rows.every(r => r.status === 'delivered')) return 'delivered';
  if (rows.every(r => ['rejected','cancelled'].includes(r.status))) return rows.some(r => r.status === 'rejected') ? 'rejected' : 'cancelled';
  if (rows.some(r => ['picked','arrived','delivered'].includes(r.status))) return 'picked';
  if (rows.some(r => r.status === 'accepted')) return 'accepted';
  return 'new';
}

async function syncBatchStatus(env, batchId) {
  if (!batchId) return;
  const x = await getBatchRows(env, batchId);
  if (!x.batch) return;
  const status = deriveBatchStatus(x.rows);
  await env.DB.prepare('UPDATE request_batches SET status=?,updated_at=? WHERE batch_id=?').bind(status,new Date().toISOString(),batchId).run();
}

async function syncBatchStatusForCode(env, code) {
  await ensureBatchSchema(env);
  const item = await env.DB.prepare('SELECT batch_id FROM request_batch_items WHERE code=?').bind(code).first();
  if (item?.batch_id) await syncBatchStatus(env, item.batch_id);
}

async function getBatchPayload(env, batchId, safe=true) {
  const x = await getBatchRows(env, batchId);
  if (!x.batch) fail('Giro non trovato', 404);
  const etaState = await buildEtaState(env);
  const status = deriveBatchStatus(x.rows);
  const deliveredCount = x.rows.filter(r => r.status === 'delivered').length;
  const items = x.rows.map(r => ({
    ...(safe ? rowClientSafe(r) : rowPublic(r)),
    batchId,
    batchStopIndex: Number(r.stop_index),
    batchSize: x.rows.length,
    eta: etaState.etaByCode[r.code] || null
  }));
  return {
    batch: {
      batchId,
      status,
      createdAt: x.batch.created_at,
      updatedAt: x.batch.updated_at,
      requesterName: x.batch.requester_name,
      pickupAddress: x.batch.pickup_address,
      readyTime: x.batch.ready_time,
      service: x.batch.service,
      totalDistanceKm: Number(x.batch.total_distance_km) || 0,
      totalDurationMin: Number(x.batch.total_duration_min) || 0,
      baseFee: Number(x.batch.base_fee) || 0,
      extraStopFee: Number(x.batch.extra_stop_fee) || 0,
      lateFee: Number(x.batch.late_fee) || 0,
      totalFee: Number(x.batch.total_fee) || 0,
      deliveredCount,
      totalStops: items.length,
      items
    },
    clientToken: x.batch.client_token,
    availability: etaState.availability
  };
}

async function getGuestBatch(batchId, url, env, cors) {
  await ensureBatchSchema(env);
  const t = String(url.searchParams.get('token') || '');
  const row = await env.DB.prepare('SELECT client_token FROM request_batches WHERE batch_id=?').bind(batchId).first();
  if (!row) fail('Giro non trovato', 404);
  if (!t || t !== row.client_token) fail('Token giro non valido', 403);
  return json({ ok: true, ...(await getBatchPayload(env, batchId, true)) }, 200, cors);
}

async function updateRiderBatch(batchId, request, env, cors) {
  await ensureBatchSchema(env);
  const p = await request.json().catch(() => fail('JSON non valido'));
  const status = cleanText(p.status, 20);
  if (!['accepted','picked','rejected','cancelled'].includes(status)) fail('Stato giro non valido');
  const x = await getBatchRows(env, batchId);
  if (!x.batch) fail('Giro non trovato', 404);
  const rows = x.rows;
  const now = new Date().toISOString();

  if (status === 'accepted') {
    if (!rows.every(r => r.status === 'new')) fail('Il giro non è più completamente in attesa', 409);
    const codes = new Set(rows.map(r => r.code));
    const q = await env.DB.prepare("SELECT code FROM requests WHERE status IN ('accepted','picked','arrived')").all();
    const activeOther = (q.results || []).filter(r => !codes.has(r.code)).length;
    if (activeOther + rows.length > MAX_ACTIVE_ORDERS) fail('Limite sicurezza: il giro richiede 2 slot liberi.', 409);
    await env.DB.batch(rows.map(r => env.DB.prepare("UPDATE requests SET status='accepted',updated_at=? WHERE code=? AND status='new'").bind(now,r.code)));
  } else if (status === 'picked') {
    if (!rows.every(r => ['accepted','picked'].includes(r.status))) fail('Accetta prima il giro completo', 409);
    await env.DB.batch(rows.map(r => env.DB.prepare("UPDATE requests SET status='picked',updated_at=? WHERE code=? AND status='accepted'").bind(now,r.code)));
  } else if (status === 'rejected') {
    await env.DB.batch(rows.filter(r => r.status === 'new').map(r => env.DB.prepare("UPDATE requests SET status='rejected',rejection_reason='Giro non accettato',updated_at=? WHERE code=?").bind(now,r.code)));
  } else if (status === 'cancelled') {
    await env.DB.batch(rows.filter(r => !['delivered','rejected','cancelled'].includes(r.status)).map(r => env.DB.prepare("UPDATE requests SET status='cancelled',updated_at=? WHERE code=?").bind(now,r.code)));
  }
  await syncBatchStatus(env, batchId);
  for (const r of rows) await safeLogEvent(env, r.code, 'batch_status_changed', r.status, status, 'rider', { batchId });
  return json({ ok: true, ...(await getBatchPayload(env, batchId, false)) }, 200, cors);
}
'''
    w = replace_once(w, '// ---------- Disponibilità + ETA automatici ----------', batch_helpers + '\n// ---------- Disponibilità + ETA automatici ----------', 'batch helpers')

    new_eta = r'''async function buildEtaState(env) {
  const p = await ensurePresence(env);
  const enabled = Number(p.enabled) === 1;
  const firstPickupEtaMin = Math.max(5, Math.min(60, Number(p.eta_per_job) || 5));
  const liveLocation = await getRiderLocation(env);
  await ensureBatchSchema(env);
  const batchMap = await loadBatchMetaMap(env);

  const q = await env.DB.prepare("SELECT * FROM requests WHERE status IN ('new','accepted','picked','arrived') ORDER BY created_at ASC").all();
  const rows = (q.results || []).map(r => ({ ...r, _batch: batchMap.get(r.code) || null }));
  const pendingRows = rows.filter(r => r.status === 'new');
  const activeRows = rows.filter(r => ['accepted','picked','arrived'].includes(r.status));

  const etaByCode = {};
  const decisionByCode = {};
  let cursorMin = 0;
  let lastPoint = null;
  let queuePosition = 1;

  const unitsFrom = list => {
    const map = new Map();
    for (const r of list) {
      const key = r._batch?.batch_id ? 'B:' + r._batch.batch_id : 'R:' + r.code;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(r);
    }
    return [...map.values()].map(unit => unit.sort((a,b) => {
      const ai = Number(a._batch?.stop_index) || 1, bi = Number(b._batch?.stop_index) || 1;
      return ai - bi;
    }));
  };

  const activeUnits = unitsFrom(activeRows).sort((a,b) => {
    const am = a.some(r => ['picked','arrived'].includes(r.status)) ? 0 : 1;
    const bm = b.some(r => ['picked','arrived'].includes(r.status)) ? 0 : 1;
    if (am !== bm) return am - bm;
    return String(a[0].updated_at || a[0].created_at).localeCompare(String(b[0].updated_at || b[0].created_at));
  });

  for (const unit of activeUnits) {
    const isBatch = !!unit[0]._batch?.batch_id;
    if (!isBatch) {
      const r = unit[0];
      if (r.status === 'picked' || r.status === 'arrived') {
        let deliveryMin = cursorMin;
        if (r.status !== 'arrived') {
          if (cursorMin === 0 && liveLocation?.fresh) {
            deliveryMin += travelMinutes(estimatedRoadKm(liveLocation.lat, liveLocation.lon, Number(r.delivery_lat), Number(r.delivery_lon)), r.service);
          } else if (lastPoint && validCoord(lastPoint.lat,lastPoint.lon)) {
            deliveryMin += travelMinutes(estimatedRoadKm(lastPoint.lat,lastPoint.lon, Number(r.delivery_lat), Number(r.delivery_lon)), r.service);
          } else {
            const totalTrip = travelMinutes(r.distance_km, r.service);
            const stageStarted = Date.parse(r.updated_at || '') || Date.now();
            const elapsedMin = Math.max(0, (Date.now() - stageStarted) / 60000);
            deliveryMin += Math.max(1, Math.ceil(totalTrip - elapsedMin));
          }
        }
        etaByCode[r.code] = etaPayload({ queuePosition, stage:r.status==='arrived'?'arrived':'in_delivery', pickupMin:0, deliveryMin, service:r.service });
        cursorMin = deliveryMin + ETA_MODEL.dropoffBufferMin;
        lastPoint = { lat:Number(r.delivery_lat), lon:Number(r.delivery_lon) };
      } else {
        let pickupMin = cursorMin;
        if (lastPoint && validCoord(lastPoint.lat,lastPoint.lon)) pickupMin += travelMinutes(estimatedRoadKm(lastPoint.lat,lastPoint.lon,Number(r.pickup_lat),Number(r.pickup_lon)),r.service);
        else if (cursorMin === 0 && liveLocation?.fresh) pickupMin += travelMinutes(estimatedRoadKm(liveLocation.lat,liveLocation.lon,Number(r.pickup_lat),Number(r.pickup_lon)),r.service);
        else pickupMin += firstPickupEtaMin;
        const deliveryMin = pickupMin + ETA_MODEL.pickupBufferMin + travelMinutes(r.distance_km,r.service);
        etaByCode[r.code] = etaPayload({ queuePosition, stage:queuePosition===1?'to_pickup':'queued', pickupMin, deliveryMin, service:r.service });
        cursorMin = deliveryMin + ETA_MODEL.dropoffBufferMin;
        lastPoint = { lat:Number(r.delivery_lat), lon:Number(r.delivery_lon) };
      }
      queuePosition++;
      continue;
    }

    const service = unit[0].service;
    const allAccepted = unit.every(r => r.status === 'accepted');
    let pickupMin = null;
    let point = lastPoint;
    if (allAccepted) {
      pickupMin = cursorMin;
      const pLat = Number(unit[0]._batch.batch_pickup_lat), pLon = Number(unit[0]._batch.batch_pickup_lon);
      if (point && validCoord(point.lat,point.lon)) pickupMin += travelMinutes(estimatedRoadKm(point.lat,point.lon,pLat,pLon),service);
      else if (cursorMin === 0 && liveLocation?.fresh) pickupMin += travelMinutes(estimatedRoadKm(liveLocation.lat,liveLocation.lon,pLat,pLon),service);
      else pickupMin += firstPickupEtaMin;
      cursorMin = pickupMin + ETA_MODEL.pickupBufferMin;
      point = { lat:pLat, lon:pLon };
    } else if (cursorMin === 0 && liveLocation?.fresh) {
      point = { lat:liveLocation.lat, lon:liveLocation.lon };
    }

    for (const r of unit) {
      let deliveryMin = cursorMin;
      if (r.status !== 'arrived') {
        if (point && validCoord(point.lat,point.lon)) deliveryMin += travelMinutes(estimatedRoadKm(point.lat,point.lon,Number(r.delivery_lat),Number(r.delivery_lon)),service);
        else deliveryMin += travelMinutes(r.distance_km,service);
      }
      etaByCode[r.code] = etaPayload({
        queuePosition,
        stage: allAccepted ? (queuePosition===1?'to_pickup':'queued') : (r.status==='arrived'?'arrived':'in_delivery'),
        pickupMin: allAccepted ? pickupMin : 0,
        deliveryMin,
        service
      });
      cursorMin = deliveryMin + ETA_MODEL.dropoffBufferMin;
      point = { lat:Number(r.delivery_lat), lon:Number(r.delivery_lon) };
      lastPoint = point;
      queuePosition++;
    }
  }

  const active = activeRows.length;
  const carryingFood = activeRows.some(r => r.status === 'picked');
  const pendingUnits = unitsFrom(pendingRows);
  for (const unit of pendingUnits) {
    const first = unit[0];
    const requestedSlots = unit.length;
    let previewPickupMin = cursorMin;
    let transferKm = null;
    const pLat = Number(first._batch?.batch_pickup_lat ?? first.pickup_lat);
    const pLon = Number(first._batch?.batch_pickup_lon ?? first.pickup_lon);
    if (lastPoint && validCoord(lastPoint.lat,lastPoint.lon)) {
      transferKm = estimatedRoadKm(lastPoint.lat,lastPoint.lon,pLat,pLon);
      previewPickupMin += travelMinutes(transferKm,first.service);
    } else if (liveLocation?.fresh) {
      transferKm = estimatedRoadKm(liveLocation.lat,liveLocation.lon,pLat,pLon);
      previewPickupMin += travelMinutes(transferKm,first.service);
    } else previewPickupMin += firstPickupEtaMin;

    for (const r of unit) {
      etaByCode[r.code] = etaPayload({ queuePosition:null, stage:'pending', previewPickupMin, service:r.service });
      decisionByCode[r.code] = buildDispatchDecision(r, { activeCount:active, requestedSlots, pickupMin:previewPickupMin, transferKm, liveLocation, carryingFood });
    }
  }

  const pending = pendingRows.length;
  const nextFreeMin = active ? Math.max(1,Math.ceil(cursorMin)) : 0;
  const publicLocation = liveLocation ? { fresh:!!liveLocation.fresh, ageSec:liveLocation.ageSec, capturedAt:liveLocation.capturedAt, accuracyM:liveLocation.accuracyM } : null;
  const availability = !enabled ? {
    mode:'offline',enabled:false,pending,active,firstPickupEtaMin,etaMin:null,nextAvailableAt:null,availableEtaMin:5,availableEtaMax:10,location:publicLocation,
    etaModel:{automatic:true,ebikeKmh:ETA_MODEL.ebikeKmh,windowMin:ETA_MODEL.windowMin},updatedAt:p.updated_at
  } : active ? {
    mode:'busy',enabled:true,pending,active,firstPickupEtaMin,etaMin:nextFreeMin,nextAvailableAt:isoPlusMinutes(nextFreeMin),availableEtaMin:5,availableEtaMax:10,location:publicLocation,
    etaModel:{automatic:true,ebikeKmh:ETA_MODEL.ebikeKmh,windowMin:ETA_MODEL.windowMin},updatedAt:p.updated_at
  } : {
    mode:'available',enabled:true,pending,active:0,firstPickupEtaMin,etaMin:0,nextAvailableAt:new Date().toISOString(),availableEtaMin:5,availableEtaMax:10,location:publicLocation,
    etaModel:{automatic:true,ebikeKmh:ETA_MODEL.ebikeKmh,windowMin:ETA_MODEL.windowMin},updatedAt:p.updated_at
  };
  return { availability, etaByCode, decisionByCode, liveLocation, queueContext:{active,pending,cursorMin:Math.max(0,Math.ceil(cursorMin)),lastPoint,carryingFood} };
}'''
    w = replace_between(w, 'async function buildEtaState(env) {', 'async function computeAvailability(env)', new_eta, 'buildEtaState')

    w = replace_once(w, "  const carryingFood = !!ctx.carryingFood;\n", "  const carryingFood = !!ctx.carryingFood;\n  const requestedSlots = Math.max(1, Number(ctx.requestedSlots) || 1);\n", 'dispatch requestedSlots var')
    w = replace_once(w, "  if (active >= MAX_ACTIVE_ORDERS) {", "  if (active + requestedSlots > MAX_ACTIVE_ORDERS) {", 'dispatch slot condition')
    w = replace_once(w, "    reason = 'Hai già raggiunto il limite iniziale di 2 ordini attivi.';", "    reason = requestedSlots > 1 ? 'Il giro richiede 2 slot liberi e supererebbe il limite operativo.' : 'Hai già raggiunto il limite iniziale di 2 ordini attivi.';", 'dispatch slot reason')
    w = replace_once(w, "    activeOrders: active,\n    maxActiveOrders:", "    activeOrders: active,\n    requestedSlots,\n    maxActiveOrders:", 'dispatch payload slots')

    new_list = r'''async function listRiderRequests(url, env, cors) {
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 100));
  const status = url.searchParams.get('status');
  let r;
  if (status) r = await env.DB.prepare('SELECT * FROM requests WHERE status=? ORDER BY created_at DESC LIMIT ?').bind(status,limit).all();
  else r = await env.DB.prepare("SELECT * FROM requests WHERE created_at >= datetime('now','-30 day') ORDER BY created_at DESC LIMIT ?").bind(limit).all();
  const etaState = await buildEtaState(env);
  const batchMap = await loadBatchMetaMap(env);
  return json({
    ok:true,
    requests:(r.results||[]).map(row => attachBatchMeta({ ...attachEta(row,etaState.etaByCode), dispatch:etaState.decisionByCode?.[row.code]||null }, batchMap.get(row.code))),
    riderLocation:etaState.liveLocation
  },200,cors);
}'''
    w = replace_between(w, 'async function listRiderRequests(url, env, cors) {', 'const TRANSITIONS = {', new_list, 'listRiderRequests')

    status_anchor = "  await safeLogEvent(env, code, 'status_changed', row.status, status, 'rider', { rejectionReason: reason || '' });\n  const updatedRow = await getByCode(env, code);"
    status_new = "  await safeLogEvent(env, code, 'status_changed', row.status, status, 'rider', { rejectionReason: reason || '' });\n  await syncBatchStatusForCode(env, code);\n  const updatedRow = await getByCode(env, code);"
    w = replace_once(w, status_anchor, status_new, 'sync batch child status')

    wp.write_text(w)

# ---------------- APP ----------------
ap = ROOT / 'app.js'
a = ap.read_text()
if 'V11_BATCH_UI' not in a:
    a = a.replace("const APP_VERSION = '11.0.2-dispatch';", "const APP_VERSION = '11.1.0-batch';\nconst V11_BATCH_UI = true;")
    globals_anchor = "let clientDelivery = null;\nlet clientQuote = null;"
    globals_new = "let clientDelivery = null;\nlet clientDelivery2 = null;\nlet clientBatchMode = false;\nlet clientBatchPolling = null;\nlet clientQuote = null;"
    a = replace_once(a, globals_anchor, globals_new, 'app batch globals')

    data_block = r'''function clientSecondData(){
  if(!clientBatchMode)return null;
  return {
    recipientName:clampText($('cRecipient2')?.value,80),recipientPhone:digits($('cRecipientPhone2')?.value),
    deliveryAddress:clampText($('cDelivery2')?.value,180),deliveryLat:clientDelivery2?.lat??null,deliveryLon:clientDelivery2?.lon??null,
    payment:$('cPayment2')?.value||'paid',orderTotal:$('cPayment2')?.value==='cash'?num($('cOrderTotal2')?.value):0,
    notes:clampText($('cNotes2')?.value,400)
  };
}
function clientFormData(){
  return {
    requesterName:clampText($('cRequester').value,80), requesterPhone:digits($('cRequesterPhone').value),
    pickupAddress:clampText($('cPickup').value,180), pickupLat:clientPickup?.lat??null, pickupLon:clientPickup?.lon??null,
    readyTime:$('cReadyTime').value,
    recipientName:clampText($('cRecipient').value,80), recipientPhone:digits($('cRecipientPhone').value),
    deliveryAddress:clampText($('cDelivery').value,180), deliveryLat:clientDelivery?.lat??null, deliveryLon:clientDelivery?.lon??null,
    service:clientVehicle, payment:$('cPayment').value, orderTotal:$('cPayment').value==='cash'?num($('cOrderTotal').value):0,
    notes:clampText($('cNotes').value,400), second:clientSecondData()
  };
}
function validateClientForm(forQuote=true){
  const d=clientFormData(), missing=[];
  if(!d.requesterName) missing.push('nome locale/richiedente');
  if(d.requesterPhone.length<9) missing.push('telefono referente');
  if(!d.pickupAddress || !clientPickup) missing.push('indirizzo ritiro selezionato');
  if(!d.readyTime) missing.push('orario ordine pronto');
  if(!d.recipientName) missing.push('destinatario 1');
  if(d.recipientPhone.length<9) missing.push('telefono destinatario 1');
  if(!d.deliveryAddress || !clientDelivery) missing.push('indirizzo consegna 1 selezionato');
  if(d.payment==='cash' && d.orderTotal<=0) missing.push('importo ordine 1 da incassare');
  if(clientBatchMode){
    const s=d.second||{};
    if(!s.recipientName)missing.push('destinatario 2');
    if((s.recipientPhone||'').length<9)missing.push('telefono destinatario 2');
    if(!s.deliveryAddress||!clientDelivery2)missing.push('indirizzo consegna 2 selezionato');
    if(s.payment==='cash'&&s.orderTotal<=0)missing.push('importo ordine 2 da incassare');
  }
  if(missing.length)throw new Error('Completa: '+missing.join(', ')+'.');
  if(forQuote && (!clientPickup?.lat || !clientDelivery?.lat || (clientBatchMode&&!clientDelivery2?.lat)))throw new Error('Seleziona gli indirizzi dai suggerimenti reali.');
  return d;
}
function hideClientQuote(){ $('clientQuoteSection').classList.add('hidden'); }
function invalidateClientQuote(){ clientQuote=null; clientSubmissionId=null; hideClientQuote(); }
function batchPayload(d){
  return {
    requesterName:d.requesterName,requesterPhone:d.requesterPhone,pickupAddress:d.pickupAddress,pickupLat:d.pickupLat,pickupLon:d.pickupLon,
    readyTime:d.readyTime,service:d.service,
    deliveries:[
      {recipientName:d.recipientName,recipientPhone:d.recipientPhone,deliveryAddress:d.deliveryAddress,deliveryLat:d.deliveryLat,deliveryLon:d.deliveryLon,payment:d.payment,orderTotal:d.orderTotal,notes:d.notes},
      d.second
    ]
  };
}
async function calculateClientQuote(){
  const status=$('clientFormStatus');status.className='status-line';status.textContent=clientBatchMode?'Calcolo il giro migliore per 2 consegne…':'Calcolo percorso e tariffa sul server…';
  try{
    const d=validateClientForm(true);
    if(clientBatchMode){
      const res=await fetchJson(apiBase()+'/api/batch/quote',{method:'POST',headers:{'Accept':'application/json','Content-Type':'application/json'},body:JSON.stringify(batchPayload(d))},14000);
      const q=res.quote;if(!q||!Number.isFinite(Number(q.totalFee)))throw new Error('Preventivo giro non disponibile.');
      clientQuote={batch:true,distanceKm:Number(q.totalDistanceKm)||0,durationMin:Number(q.totalDurationMin)||0,base:Number(q.baseFee)||0,extraStopFee:Number(q.extraStopFee)||3.5,lateFee:Number(q.lateFee)||0,total:Number(q.totalFee),service:d.service,readyTime:d.readyTime,routeOrder:q.routeOrder||[0,1],stops:q.stops||[],pickupAvailability:q.pickupAvailability||res.availability||null,createdAt:Date.now()};
    }else{
      const res=await fetchJson(apiBase()+'/api/quote',{method:'POST',headers:{'Accept':'application/json','Content-Type':'application/json'},body:JSON.stringify({pickupLat:d.pickupLat,pickupLon:d.pickupLon,deliveryLat:d.deliveryLat,deliveryLon:d.deliveryLon,service:d.service,readyTime:d.readyTime})},10000);
      const q=res.quote;if(!q||!Number.isFinite(Number(q.totalFee)))throw new Error('Preventivo server non disponibile.');
      clientQuote={distanceKm:Number(q.distanceKm),durationMin:Number(q.durationMin)||0,source:q.routeSource||'server',base:Number(q.baseFee),lateFee:Number(q.lateFee)||0,total:Number(q.totalFee),micro:!!q.microDelivery,service:d.service,readyTime:d.readyTime,createdAt:Date.now(),pickupAvailability:res.pickupAvailability||null};
      currentAvailability=res.availability||currentAvailability;
    }
    clientSubmissionId=null;renderAvailability();renderClientQuote();await generateClientQuoteImage();
    $('clientQuoteSection').classList.remove('hidden');$('clientQuoteSection').scrollIntoView({behavior:'smooth',block:'start'});
    status.className='status-line ok';status.textContent=clientBatchMode?'✓ Giro ottimizzato: 1 ritiro, 2 consegne. Controlla ordine e tariffa.':'✓ Preventivo pronto e verificato dal server. Puoi modificarlo oppure inviare la richiesta.';
    if(!clientBatchMode&&clientQuote.distanceKm>8&&clientVehicle==='ebike'){$('serviceSuggestion').classList.remove('hidden');$('serviceSuggestion').textContent="💡 Oltre 8 km la tariffa è indicativa: la disponibilità viene confermata dall'operatore.";}else if(!clientBatchMode&&clientQuote.micro){$('serviceSuggestion').classList.remove('hidden');$('serviceSuggestion').textContent='⚡ ECONOMY E-BIKE: fascia 0–1 km · €2,50.';}else $('serviceSuggestion').classList.add('hidden');
  }catch(e){status.className='status-line error';status.textContent='⚠ '+e.message;}
}'''
    a = replace_between(a, 'function clientFormData(){', 'function renderClientPickupAvailability(){', data_block, 'client data/quote block')

    render_anchor = "  $('cqLateNotice').classList.toggle('hidden', !clientQuote.lateFee);\n  $('clientQuoteRouteBadge').textContent='PERCORSO CALCOLATO';\n  renderClientPickupAvailability();"
    render_new = "  $('cqLateNotice').classList.toggle('hidden', !clientQuote.lateFee);\n  $('cqBatchRow')?.classList.toggle('hidden',!clientQuote.batch);\n  if($('cqBatchExtra'))$('cqBatchExtra').textContent=clientQuote.batch?money(clientQuote.extraStopFee||3.5):'—';\n  const br=$('clientBatchRoute');\n  if(br){br.classList.toggle('hidden',!clientQuote.batch);br.innerHTML=clientQuote.batch?'<b>⚡ ORDINE DI CONSEGNA OTTIMIZZATO</b>'+clientQuote.stops.map(s=>`<span>${s.stopIndex}️⃣ ${esc(s.recipientName)} · ${esc(s.deliveryAddress)} · ETA ${esc(etaRange(s.eta))}</span>`).join(''):'';}\n  $('clientQuoteRouteBadge').textContent=clientQuote.batch?'GIRO OTTIMIZZATO':'PERCORSO CALCOLATO';\n  renderClientPickupAvailability();"
    a = replace_once(a, render_anchor, render_new, 'render batch quote')

    wa_start = a.find('function clientStructuredWhatsApp(')
    wa_end = a.find('async function submitClientRequest()', wa_start)
    if wa_start < 0 or wa_end < 0: raise SystemExit('WA/submit anchors missing')
    submit_block = r'''function clientStructuredWhatsApp(d=clientFormData(),q=clientQuote){
  if(clientBatchMode&&d.second){
    return `Ciao Marcello, avrei bisogno di un giro SOS con 2 consegne.\n\n*Locale:* ${d.requesterName||'—'}\n*Ritiro unico:* ${d.pickupAddress||'—'}\n*Ordini pronti:* ${d.readyTime||'—'}\n\n*CONSEGNA 1*\n${d.recipientName} · ${d.recipientPhone}\n${d.deliveryAddress}\n${paymentLabel(d.payment)}${d.payment==='cash'?` · ${money(d.orderTotal)}`:''}\n\n*CONSEGNA 2*\n${d.second.recipientName} · ${d.second.recipientPhone}\n${d.second.deliveryAddress}\n${paymentLabel(d.second.payment)}${d.second.payment==='cash'?` · ${money(d.second.orderTotal)}`:''}${q?`\n\n*Tariffa giro SOS:* ${money(q.total)}`:''}`;
  }
  return `Ciao Marcello, avrei bisogno di una consegna SOS.\n\n*Locale:* ${d.requesterName||'—'}\n*Ritiro:* ${d.pickupAddress||'—'}\n*Ordine pronto:* ${d.readyTime||'—'}\n*Destinatario:* ${d.recipientName||'—'}\n*Telefono:* ${d.recipientPhone||'—'}\n*Consegna:* ${d.deliveryAddress||'—'}\n*Servizio:* ${vehicleLabel(d.service)}\n*Pagamento:* ${paymentLabel(d.payment)}${d.payment==='cash'?`\n*Importo ordine:* ${money(d.orderTotal)}`:''}${q?`\n*Tariffa SOS:* ${money(q.total)}`:''}${d.notes?`\n*Note:* ${d.notes}`:''}`;
}
async function submitClientRequest(){
  const status=$('clientSendStatus'),sendBtn=$('clientSendRequest');if(sendBtn.disabled)return;
  sendBtn.disabled=true;status.className='status-line';status.textContent='Verifico disponibilità e dati…';
  try{
    const d=validateClientForm(true);if(!clientQuote)throw new Error('Ricalcola prima la tariffa.');
    if(!clientSubmissionId)clientSubmissionId=(crypto.randomUUID?.()||uid('SUB'));
    getAudioCtx('client')?.resume?.();
    const av=await refreshAvailability();if(av?.mode==='offline')throw new Error('Il rider è segnato come non disponibile. Puoi contattarlo su WhatsApp.');
    if(!clientBatchMode&&av?.mode==='busy'&&!confirm(`Il rider è attualmente occupato. Nuova partenza stimata ~${av.etaMin||25} min. Vuoi comunque inviare la richiesta?`))return;
    if(clientBatchMode&&clientQuote?.pickupAvailability?.canAcceptNow===false&&!confirm('Il giro usa 2 slot e al momento non può essere accettato subito. Vuoi inviarlo comunque in attesa?'))return;
    status.textContent=clientBatchMode?'Invio giro da 2 consegne all’Area Rider…':'Invio automatico all’Area Rider…';
    const headers=authSession&&authProfile?.role==='client'?authHeaders():{'Accept':'application/json','Content-Type':'application/json'};
    if(clientBatchMode){
      const payload={...batchPayload(d),submissionId:clientSubmissionId,formStartedAt:Number(sessionStorage.getItem('sosClientStartedAt')||Date.now()),website:'sos-rider-v11-batch'};
      const res=await fetchJson(apiBase()+'/api/requests/batch',{method:'POST',headers,body:JSON.stringify(payload)},16000);
      if(!res?.batch?.batchId||!res?.clientToken)throw new Error('Risposta giro incompleta.');
      localStorage.setItem(CLIENT_ACTIVE_KEY,JSON.stringify({batch:true,batchId:res.batch.batchId,token:res.clientToken}));
      clientSubmissionId=null;showClientBatchStatus(res.batch,res.clientToken);status.className='status-line ok';status.textContent='✓ Giro con 2 consegne inviato.';
    }else{
      const payload={...d,second:undefined,submissionId:clientSubmissionId,clientQuote:{distanceKm:clientQuote.distanceKm,total:clientQuote.total},formStartedAt:Number(sessionStorage.getItem('sosClientStartedAt')||Date.now()),website:'sos-rider-v11'};
      const res=await fetchJson(apiBase()+'/api/requests',{method:'POST',headers,body:JSON.stringify(payload)},12000);
      if(!res?.request?.code||!res?.clientToken)throw new Error('Risposta server incompleta.');
      const r=res.request;clientQuote={service:r.service,distanceKm:Number(r.distanceKm),durationMin:Number(r.durationMin)||0,source:r.routeSource||'server',base:Number(r.baseFee),lateFee:Number(r.lateFee),total:Number(r.totalFee),micro:!!r.microDelivery,readyTime:r.readyTime,pickupAvailability:clientQuote?.pickupAvailability||null};renderClientQuote();await generateClientQuoteImage();
      localStorage.setItem(CLIENT_ACTIVE_KEY,JSON.stringify({code:r.code,token:res.clientToken,owned:!!(authSession&&authProfile?.role==='client')}));addClientHistory(r.code);saveClientDraft();clientSubmissionId=null;
      showClientRequestStatus(r,res.clientToken,!!(authSession&&authProfile?.role==='client'));status.className='status-line ok';status.textContent='✓ Richiesta inviata automaticamente.';currentAvailability=res.availability||currentAvailability;renderAvailability();loadClientRecent();
    }
  }catch(e){status.className='status-line error';status.innerHTML=`⚠ Invio automatico non riuscito: ${esc(e.message)}<br><a class="btn whatsapp-btn full" style="margin-top:8px" href="${waLink(clientStructuredWhatsApp())}" target="_blank" rel="noopener">INVIA I DATI SU WHATSAPP</a>`;}finally{sendBtn.disabled=false;}
}
function showClientBatchStatus(batch,token){
  $('clientFormCard').classList.add('hidden');$('clientQuoteSection').classList.add('hidden');$('clientRequestStatus').classList.remove('hidden');$('clientRequestCode').textContent=batch.batchId;$('clientStatusWhatsapp').href=waLink(`Ciao Marcello, ho inviato il giro SOS Rider ${batch.batchId}.`);lastClientStatus=null;updateClientBatchStatusUI(batch);startClientBatchPolling(batch.batchId,token);$('clientRequestStatus').scrollIntoView({behavior:'smooth',block:'start'});
}
function updateClientBatchStatusUI(b){
  const badge=$('clientStatusBadge'),s=b.status||'new';if(lastClientStatus&&lastClientStatus!==s)playDing();lastClientStatus=s;badge.className='request-state';$('clientConfirmedPrice').textContent=`Tariffa giro: ${money(b.totalFee)}`;$('clientStatusIcon').textContent=s==='delivered'?'✓':s==='new'?'…':'⚡';
  if(s==='new'){badge.classList.add('waiting');badge.textContent='GIRO IN ATTESA DEL RIDER';$('clientStatusText').textContent='Richiesta unica: 1 ritiro e 2 consegne.';}
  else if(s==='accepted'){badge.classList.add('accepted');badge.textContent='GIRO ACCETTATO';$('clientStatusText').textContent='Marcello ha preso in carico entrambi gli ordini.';}
  else if(s==='picked'){badge.classList.add('progress');badge.textContent=`IN CONSEGNA · ${b.deliveredCount||0}/2 COMPLETATE`;$('clientStatusText').textContent='Entrambi gli ordini sono stati ritirati. Il rider segue l’ordine di consegna ottimizzato.';}
  else if(s==='delivered'){badge.classList.add('accepted');badge.textContent='GIRO COMPLETATO';$('clientStatusText').textContent='Entrambe le consegne sono state completate.';localStorage.removeItem(CLIENT_ACTIVE_KEY);stopClientBatchPolling();}
  else if(s==='rejected'||s==='cancelled'){badge.classList.add('rejected');badge.textContent='GIRO NON ATTIVO';$('clientStatusText').textContent='Il giro non è stato preso in carico.';localStorage.removeItem(CLIENT_ACTIVE_KEY);stopClientBatchPolling();}
  const items=(b.items||[]).slice().sort((x,y)=>x.batchStopIndex-y.batchStopIndex);$('clientEtaBox').innerHTML=`<div class="live-eta-title">⚡ GIRO 2 CONSEGNE</div><div class="batch-status-stops">${items.map(x=>`<div><b>${x.batchStopIndex}️⃣ ${esc(x.recipientName)}</b><span>${esc(x.deliveryAddress)}</span><small>${x.status==='delivered'?'✓ CONSEGNATA':x.eta?.delivery?'ETA '+esc(etaRange(x.eta.delivery)):remoteStatusLabel(x.status)}</small></div>`).join('')}</div>`;$('clientEtaBox').classList.remove('hidden');
}
function startClientBatchPolling(batchId,token){stopClientBatchPolling();const go=async()=>{try{const u=new URL(apiBase()+`/api/batches/${encodeURIComponent(batchId)}`);u.searchParams.set('token',token);const d=await fetchJson(u.toString(),{headers:{Accept:'application/json'}},7000);if(d?.batch)updateClientBatchStatusUI(d.batch)}catch(e){console.warn('Status giro non disponibile',e)}};go();clientBatchPolling=setInterval(go,4000);}
function stopClientBatchPolling(){if(clientBatchPolling){clearInterval(clientBatchPolling);clientBatchPolling=null;}}
'''
    a = a[:wa_start] + submit_block + a[wa_end + len('async function submitClientRequest()'):]
    # The replacement above intentionally consumed only the function signature; remove the old submit body up to showClientRequestStatus.
    old_body_start = a.find('{', a.find('function stopClientBatchPolling'))
    # Repair by cutting duplicate old submit body if present between our block and showClientRequestStatus.
    marker = "function showClientRequestStatus(r,token,owned=false){"
    first_marker = a.find(marker)
    dup_sig = a.find('{\n  const status=$\'clientSendStatus\'', a.find('function stopClientBatchPolling'))
    if dup_sig != -1 and dup_sig < first_marker:
        a = a[:dup_sig] + '\n' + a[first_marker:]

    # Robustly replace restore active to support batches.
    restore_new = r'''function restoreActiveClientRequest(){
  try{const x=JSON.parse(localStorage.getItem(CLIENT_ACTIVE_KEY)||'null');if(x?.batch&&x?.batchId&&x?.token){$('clientRequestCode').textContent=x.batchId;$('clientFormCard').classList.add('hidden');$('clientQuoteSection').classList.add('hidden');$('clientRequestStatus').classList.remove('hidden');startClientBatchPolling(x.batchId,x.token);return;}if(x?.code&&x?.token){$('clientRequestCode').textContent=x.code;$('clientFormCard').classList.add('hidden');$('clientQuoteSection').classList.add('hidden');$('clientRequestStatus').classList.remove('hidden');startClientPolling(x.code,x.token,!!x.owned,true)}}catch{}
}'''
    a = replace_between(a, 'function restoreActiveClientRequest(){', 'function startClientPolling(', restore_new, 'restore active batch')

    norm_old = "status:r.status,eta:r.eta||null};}"
    norm_new = "status:r.status,eta:r.eta||null,batchId:r.batchId||null,batchStopIndex:Number(r.batchStopIndex)||null,batchSize:Number(r.batchSize)||0,batchTotalFee:Number(r.batchTotalFee)||0,batchExtraStopFee:Number(r.batchExtraStopFee)||0,batchTotalDistanceKm:Number(r.batchTotalDistanceKm)||0,batchPickupAddress:r.batchPickupAddress||null,batchPickupLat:Number(r.batchPickupLat),batchPickupLon:Number(r.batchPickupLon)};}"
    a = replace_once(a, norm_old, norm_new, 'normalize batch meta')
    local_old = "notes:r.notes||''};state.orders.push(o);"
    local_new = "notes:r.notes||'',batchId:r.batchId||null,batchStopIndex:r.batchStopIndex||null,batchSize:r.batchSize||0,batchTotalFee:r.batchTotalFee||0,batchExtraStopFee:r.batchExtraStopFee||0};state.orders.push(o);"
    a = replace_once(a, local_old, local_new, 'local batch meta')

    # Insert rider batch helper before rejectRemote.
    batch_rider = r'''async function patchRemoteBatch(batchId,body){
  if(['accepted','picked'].includes(body?.status))captureRiderLocationOnce(true).catch(()=>{});
  return fetchJson(apiBase()+`/api/rider/batches/${encodeURIComponent(batchId)}`,{method:'PATCH',headers:riderHeaders(),body:JSON.stringify(body)},10000);
}
async function acceptRemoteBatch(batchId){
  const rows=remoteRequests.filter(r=>r.batchId===batchId);if(!rows.length)return;const dsc=rows[0]?.dispatch;
  if(dsc?.level==='red'&&!confirm(`⚠ ${dsc.label||'NON CONSIGLIATO'}\n\n${dsc.reason||''}\n\nInviare comunque il giro in accettazione?`))return;
  stopAlarm();ensureShiftThen(async()=>{try{const d=await patchRemoteBatch(batchId,{status:'accepted'});(d.batch?.items||[]).forEach(createLocalOrderFromRemote);await refreshRemoteRequests();switchRiderPage('deliveries');}catch(e){alert('Non sono riuscito ad accettare il giro: '+e.message)}});
}
async function rejectRemoteBatch(batchId){if(!confirm('Rifiutare entrambe le consegne di questo giro?'))return;try{await patchRemoteBatch(batchId,{status:'rejected'});await refreshRemoteRequests();}catch(e){alert('Errore: '+e.message)}}
async function markBatchPicked(batchId){
  const locals=state.orders.filter(o=>o.batchId===batchId&&!['delivered','cancelled'].includes(o.status));const before=locals.map(o=>({o,status:o.status,pickedAt:o.pickedAt}));
  locals.forEach(o=>{o.status='picked';o.pickedAt=nowIso()});saveState();renderRiderAll();
  try{const d=await patchRemoteBatch(batchId,{status:'picked'});(d.batch?.items||[]).forEach(raw=>{const o=state.orders.find(x=>x.remoteCode===raw.code);if(o){o.status='picked';o.pickedAt=o.pickedAt||nowIso();}});saveState();await refreshRemoteRequests();renderRiderAll();}
  catch(e){before.forEach(x=>{x.o.status=x.status;x.o.pickedAt=x.pickedAt});saveState();renderRiderAll();alert('Giro non sincronizzato: '+e.message)}
}
'''
    a = replace_once(a, 'async function rejectRemote(code){', batch_rider + 'async function rejectRemote(code){', 'rider batch actions')

    new_render_remote = r'''function renderRemoteRequests(){
  const visible=remoteRequests.filter(r=>['new','accepted','picked','arrived'].includes(r.status));
  const newOnes=visible.filter(r=>r.status==='new');$('newRequestCount').textContent=newOnes.length;
  if(!visible.length){$('remoteRequestsList').innerHTML='<section class="card"><div class="eyebrow">TUTTO TRANQUILLO</div><h2>Nessuna richiesta in attesa</h2><p class="muted">Nessuna richiesta nuova e nessuna consegna attiva sul server.</p></section>';return;}
  const units=[];const seen=new Set();
  for(const r of visible){if(r.batchId){if(seen.has(r.batchId))continue;seen.add(r.batchId);units.push(visible.filter(x=>x.batchId===r.batchId).sort((a,b)=>a.batchStopIndex-b.batchStopIndex));}else units.push([r]);}
  $('remoteRequestsList').innerHTML=units.map(unit=>{
    if(unit.length===1&&!unit[0].batchId){const r=unit[0],exists=state.orders.some(o=>o.remoteCode===r.code);const etaBlock=r.status==='accepted'?riderEtaMarkup(r.eta,'to_pickup'):r?.eta?.previewPickup?`<div class="rider-eta-panel preview"><div class="rider-eta-head">PREVIEW CODA</div><div class="rider-eta-grid"><div><small>SE ACCETTI ORA</small><b>${esc(etaRange(r.eta.previewPickup))}</b><span>~${r.eta.previewPickup.min||0} min</span></div></div></div>`:'';return `<article class="request-card ${r.status==='new'?'new':'accepted'}"><div class="request-top"><div><div class="code">${esc(r.code)}</div><div class="tiny">${fmtDateTime(r.createdAt||r.created_at)}</div></div><span class="pill ${r.status==='new'?'yellow':'green'}">${remoteStatusLabel(r.status)}</span></div><div class="request-grid"><div class="kv"><small>RICHIEDENTE</small><b>${esc(r.requesterName||r.requester_name)}</b></div><div class="kv"><small>PRONTO</small><b>${esc(r.readyTime||r.ready_time||'—')}</b></div><div class="kv"><small>SERVIZIO</small><b>${vehicleIcon(r.service)} ${esc(r.microDelivery?'Micro E-bike':vehicleLabel(r.service))}</b></div><div class="kv"><small>TARIFFA SOS</small><b>${money(r.totalFee||r.total_fee)}</b></div></div><div class="route-box"><b>${icon('pin','mini-inline-icon')} Ritiro</b> ${esc(r.pickupAddress||r.pickup_address)}<br><b>${icon('navigation','mini-inline-icon')} Consegna</b> ${esc(r.deliveryAddress||r.delivery_address)}<br><b>${icon('customer','mini-inline-icon')}</b> ${esc(r.recipientName||r.recipient_name)} · ${esc(r.recipientPhone||r.recipient_phone)}</div>${r.status==='new'?dispatchDecisionMarkup(r):''}${etaBlock}<div class="request-actions">${r.status==='new'?`<button class="btn ghost" data-reject="${esc(r.code)}">RIFIUTA</button><button class="btn primary" data-accept="${esc(r.code)}">${icon('bolt','btn-icon')} ACCETTA ORDINE</button>`:`<button class="btn ghost" data-map-remote="${esc(r.code)}">PERCORSO</button><button class="btn primary" data-open-delivery="${esc(r.code)}">${exists?'APRI CONSEGNA':'RECUPERA CONSEGNA'}</button>`}</div></article>`;}
    const first=unit[0],allNew=unit.every(x=>x.status==='new'),batchId=first.batchId;return `<article class="request-card batch-request ${allNew?'new':'accepted'}"><div class="request-top"><div><div class="code">${esc(batchId)}</div><div class="tiny">1 RITIRO · 2 CONSEGNE</div></div><span class="pill yellow">⚡ GIRO 2 STOP</span></div><div class="request-grid"><div class="kv"><small>LOCALE</small><b>${esc(first.requesterName)}</b></div><div class="kv"><small>PRONTO</small><b>${esc(first.readyTime||'—')}</b></div><div class="kv"><small>SERVIZIO</small><b>${vehicleIcon(first.service)} ${esc(vehicleLabel(first.service))}</b></div><div class="kv"><small>TARIFFA GIRO</small><b>${money(first.batchTotalFee)}</b></div></div><div class="batch-pickup"><b>${icon('store','mini-inline-icon')} RITIRO UNICO</b><span>${esc(first.batchPickupAddress||first.pickupAddress)}</span></div><div class="batch-stop-list">${unit.map(x=>`<div><b>${x.batchStopIndex}️⃣ ${esc(x.recipientName)}</b><span>${esc(x.deliveryAddress)}</span><small>${esc(x.recipientPhone||'')} · ${paymentLabel(x.payment)}</small></div>`).join('')}</div>${allNew?dispatchDecisionMarkup(first):''}<div class="request-actions">${allNew?`<button class="btn ghost" data-reject-batch="${esc(batchId)}">RIFIUTA GIRO</button><button class="btn primary" data-accept-batch="${esc(batchId)}">⚡ ACCETTA GIRO</button>`:`<button class="btn primary" data-open-batch="${esc(batchId)}">APRI GIRO</button>`}</div></article>`;
  }).join('');
}'''
    a = replace_between(a, 'function renderRemoteRequests(){', 'async function patchRemote(code,body){', new_render_remote, 'render grouped rider requests')

    # Add batch local card + replace renderDeliveries.
    delivery_block = r'''function batchOrderCard(arr){
  const rows=arr.slice().sort((a,b)=>(a.batchStopIndex||1)-(b.batchStopIndex||1));const active=rows.filter(o=>!['delivered','cancelled'].includes(o.status));if(!active.length)return'';const first=rows[0],next=active[0];
  const allPickup=active.every(o=>o.status==='to_pickup');
  if(allPickup){const pickup={label:first.pickupAddress,lat:first.pickupLat,lon:first.pickupLon};return `<article class="order-card batch-order"><div class="order-top"><div><div class="code">${esc(first.batchId)}</div><div class="tiny">GIRO · 2 CONSEGNE · pronto ${esc(first.readyTime||'—')}</div></div><span class="pill yellow">DA RITIRARE</span></div><div class="batch-pickup"><b>${icon('store','mini-inline-icon')} RITIRO UNICO · 2 ORDINI</b><span>${esc(first.pickupAddress)}</span></div><div class="batch-stop-list">${rows.map(o=>`<div><b>${o.batchStopIndex}️⃣ ${esc(o.customer)}</b><span>${esc(o.address)}</span></div>`).join('')}</div><div class="order-grid"><div class="kv"><small>TARIFFA GIRO</small><b>${money(first.batchTotalFee)}</b></div><div class="kv"><small>DISTANZA GIRO</small><b>${num(first.batchTotalDistanceKm).toFixed(1)} km</b></div></div><div class="order-actions"><a class="btn ghost" href="${mapsNavigate(pickup,first.vehicle)}" target="_blank" rel="noopener">${icon('pin','btn-icon')} VAI AL RITIRO</a><button class="btn primary" data-batch-order-action="picked" data-batch-id="${esc(first.batchId)}">${icon('check','btn-icon')} RITIRATI 2 ORDINI</button></div></article>`;}
  const del={label:next.address,lat:next.lat,lon:next.lon};let actions='',cash='';if(next.status==='picked')actions=`<a class="btn ghost" href="${mapsNavigate(del,next.vehicle)}" target="_blank" rel="noopener">${icon('navigation','btn-icon')} NAVIGA STOP ${next.batchStopIndex}</a><button class="btn primary" data-order-action="arrived" data-order-id="${next.id}">${icon('pin','btn-icon')} ARRIVATO</button>`;else if(next.status==='arrived'){actions=`<button class="btn primary" data-order-action="delivered" data-order-id="${next.id}">${icon('check','btn-icon')} CONSEGNATO STOP ${next.batchStopIndex}</button>`;cash=next.payment==='cash'?cashPanel(next):'';}
  const done=rows.filter(o=>o.status==='delivered').length;const live=next.remoteCode?findRemote(next.remoteCode):null;return `<article class="order-card batch-order"><div class="order-top"><div><div class="code">${esc(first.batchId)}</div><div class="tiny">GIRO 2 STOP · ${done}/2 consegnate</div></div><span class="pill green">STOP ${next.batchStopIndex}/2</span></div><div class="batch-next-stop"><small>PROSSIMA CONSEGNA</small><b>${next.batchStopIndex}️⃣ ${esc(next.customer)}</b><span>${esc(next.phone||'')} · ${esc(next.address)}</span></div><div class="order-grid"><div class="kv"><small>PAGAMENTO</small><b>${esc(paymentLabel(next.payment))}</b></div>${next.payment==='cash'?`<div class="kv"><small>DA INCASSARE</small><b>${money(next.total)}</b></div>`:''}<div class="kv"><small>TARIFFA GIRO</small><b>${money(first.batchTotalFee)}</b></div></div>${riderEtaMarkup(live?.eta||null,next.status)}${cash}<div class="order-actions">${actions}</div><div class="batch-stop-list compact">${rows.map(o=>`<div class="${o.status==='delivered'?'done':''}"><b>${o.batchStopIndex}️⃣ ${esc(o.customer)}</b><small>${o.status==='delivered'?'✓ CONSEGNATA':o===next?'IN CORSO':'SUCCESSIVA'}</small></div>`).join('')}</div></article>`;
}
function renderDeliveries(){
  const s=currentShift(),has=!!s;$('noShiftCard').classList.toggle('hidden',has);$('shiftWork').classList.toggle('hidden',!has);if(!has)return;
  const orders=state.orders.filter(o=>o.shiftId===s.id),cash=cashTotals(s.id),delivered=orders.filter(o=>o.status==='delivered'&&o.outcome!=='cancelled');$('statFund').textContent=money(s.fundStart);$('statAvailable').textContent=money(Math.max(0,s.fundStart-cash.change));$('statUnsorted').textContent=money(cash.unsorted);$('statDue').textContent=money(cash.due);$('statFees').textContent=money(delivered.reduce((a,o)=>a+num(o.fee),0));$('shiftName').textContent=s.name;$('shiftMeta').textContent=`Iniziato ${fmtDateTime(s.startAt)} · ${orders.length} consegne registrate`;
  const active=orders.filter(o=>!['delivered','cancelled'].includes(o.status)&&o.outcome!=='cancelled');$('activeCount').textContent=active.length;const units=[];const seen=new Set();for(const o of active){if(o.batchId){if(seen.has(o.batchId))continue;seen.add(o.batchId);units.push(active.filter(x=>x.batchId===o.batchId));}else units.push([o]);}$('activeOrders').innerHTML=units.length?units.slice().reverse().map(u=>u[0].batchId?batchOrderCard(u):orderCard(u[0])).join(''):'<p class="muted">Nessuna consegna attiva.</p>';renderRestaurantCash(s.id);
}'''
    a = replace_between(a, 'function renderDeliveries(){', 'function cashPanel(o){', delivery_block, 'batch delivery rendering')

    # Events for batch controls.
    remote_event_old = "$('remoteRequestsList').addEventListener('click',e=>{const a=e.target.closest('[data-accept]');"
    remote_event_new = "$('remoteRequestsList').addEventListener('click',e=>{const ab=e.target.closest('[data-accept-batch]');if(ab)return acceptRemoteBatch(ab.dataset.acceptBatch);const rb=e.target.closest('[data-reject-batch]');if(rb)return rejectRemoteBatch(rb.dataset.rejectBatch);const ob=e.target.closest('[data-open-batch]');if(ob){const rows=remoteRequests.filter(x=>x.batchId===ob.dataset.openBatch);ensureShiftThen(()=>rows.forEach(createLocalOrderFromRemote));switchRiderPage('deliveries');return;}const a=e.target.closest('[data-accept]');"
    a = replace_once(a, remote_event_old, remote_event_new, 'batch remote events')
    active_event_old = "$('activeOrders').addEventListener('click',e=>{\n    const cashBtn=e.target.closest('[data-cash-action]');"
    active_event_new = "$('activeOrders').addEventListener('click',e=>{\n    const batchBtn=e.target.closest('[data-batch-order-action]');if(batchBtn&&batchBtn.dataset.batchOrderAction==='picked')return markBatchPicked(batchBtn.dataset.batchId);\n    const cashBtn=e.target.closest('[data-cash-action]');"
    a = replace_once(a, active_event_old, active_event_new, 'batch active event')

    # Batch mode UI functions before bindEvents.
    batch_ui = r'''function setBatchMode(on){
  clientBatchMode=!!on;clientDelivery2=null;$('clientSecondDelivery')?.classList.toggle('hidden',!clientBatchMode);if($('clientAddSecond'))$('clientAddSecond').textContent=clientBatchMode?'− RIMUOVI SECONDA CONSEGNA':'+ AGGIUNGI SECONDA CONSEGNA';invalidateClientQuote();saveClientDraft();
}
function toggleOrderTotal2(){if(!$('cOrderTotalWrap2'))return;$('cOrderTotalWrap2').classList.toggle('hidden',$('cPayment2').value!=='cash');if($('cPayment2').value!=='cash')$('cOrderTotal2').value='';}
'''
    a = replace_once(a, '// ---------- Events ----------', batch_ui + '\n// ---------- Events ----------', 'batch UI helpers')
    bind_anchor = "  $('clientLogoutBtn').onclick=logoutAccount;$('clientRegisterPasskey').onclick=registerPasskey;"
    bind_new = bind_anchor + "\n  if($('clientAddSecond'))$('clientAddSecond').onclick=()=>setBatchMode(!clientBatchMode);if($('cPayment2'))$('cPayment2').addEventListener('change',()=>{toggleOrderTotal2();invalidateClientQuote();saveClientDraft()});"
    a = replace_once(a, bind_anchor, bind_new, 'bind batch mode')
    init_anchor = "  wireAutocomplete({inputId:'cDelivery',boxId:'cDeliverySuggestions',statusId:'cDeliveryStatus',mapsId:'cDeliveryMaps',slotKey:'client-delivery',onSelect:v=>{clientDelivery=v;saveClientDraft()}});"
    init_new = init_anchor + "\n  wireAutocomplete({inputId:'cDelivery2',boxId:'cDelivery2Suggestions',statusId:'cDelivery2Status',mapsId:'cDelivery2Maps',slotKey:'client-delivery2',onSelect:v=>{clientDelivery2=v;saveClientDraft()}});"
    a = replace_once(a, init_anchor, init_new, 'second autocomplete')
    new_req_old = "$('clientNewRequest').onclick=()=>{localStorage.removeItem(CLIENT_ACTIVE_KEY);stopClientPolling();lastClientStatus=null;"
    new_req_new = "$('clientNewRequest').onclick=()=>{localStorage.removeItem(CLIENT_ACTIVE_KEY);stopClientPolling();stopClientBatchPolling();lastClientStatus=null;setBatchMode(false);"
    a = replace_once(a, new_req_old, new_req_new, 'new request batch reset')
    a = a.replace("stopClientPolling(); stopRiderPolling(); stopAvailabilityPolling();", "stopClientPolling(); stopClientBatchPolling(); stopRiderPolling(); stopAvailabilityPolling();", 1)
    ap.write_text(a)

# ---------------- HTML ----------------
ip = ROOT / 'index.html'
i = ip.read_text()
if 'clientSecondDelivery' not in i:
    anchor = '''          <label class="full">Note facoltative
            <textarea id="cNotes" rows="2" placeholder="Citofono, piano, indicazioni utili..."></textarea>
          </label>
          <label class="check-row full"><input id="cRemember" type="checkbox" checked><span>Ricorda questo locale/richiedente su questo dispositivo.</span></label>'''
    insert = '''          <label class="full">Note facoltative
            <textarea id="cNotes" rows="2" placeholder="Citofono, piano, indicazioni utili..."></textarea>
          </label>

          <div class="full batch-add-wrap">
            <button id="clientAddSecond" type="button" class="btn batch-add-btn">+ AGGIUNGI SECONDA CONSEGNA</button>
            <small>Stesso ritiro, due indirizzi: il sistema sceglie automaticamente l'ordine di consegna più efficiente.</small>
          </div>

          <section id="clientSecondDelivery" class="full second-delivery-panel hidden">
            <div class="second-delivery-head"><div><div class="eyebrow">STOP 2</div><b>Seconda consegna</b></div><span class="pill yellow">STESSO RITIRO</span></div>
            <div class="form-grid">
              <label>Destinatario 2<input id="cRecipient2" autocomplete="name" placeholder="Nome cliente"></label>
              <label>Telefono destinatario 2<input id="cRecipientPhone2" inputmode="tel" autocomplete="tel" placeholder="Es. 349 1234567"></label>
              <div class="address-field full"><label>Indirizzo consegna 2<input id="cDelivery2" autocomplete="off" placeholder="Via, civico, località"></label><div id="cDelivery2Suggestions" class="suggestions hidden"></div><div class="field-meta"><span id="cDelivery2Status">Scrivi almeno 3 caratteri e seleziona un risultato.</span><button id="cDelivery2Maps" type="button" class="mini-btn">MAPS</button></div></div>
              <label>Pagamento ordine 2<select id="cPayment2"><option value="paid">Ordine già pagato</option><option value="cash">Contanti da incassare</option><option value="pos">POS del locale</option></select></label>
              <label id="cOrderTotalWrap2" class="hidden">Importo ordine 2 da incassare<input id="cOrderTotal2" type="number" inputmode="decimal" min="0" step="0.01" placeholder="0,00"></label>
              <label class="full">Note consegna 2<textarea id="cNotes2" rows="2" placeholder="Citofono, piano, indicazioni utili..."></textarea></label>
            </div>
          </section>
          <label class="check-row full"><input id="cRemember" type="checkbox" checked><span>Ricorda questo locale/richiedente su questo dispositivo.</span></label>'''
    i = replace_once(i, anchor, insert, 'second delivery html')
    qanchor = '''        <div id="cqLateRow" class="hidden"><span>Supplemento serale dopo 22:30</span><b>+ €2,00</b></div>
      </div>'''
    qinsert = '''        <div id="cqLateRow" class="hidden"><span>Supplemento serale dopo 22:30</span><b>+ €2,00</b></div>
        <div id="cqBatchRow" class="hidden"><span>Seconda fermata / gestione giro</span><b id="cqBatchExtra">+ €3,50</b></div>
      </div>
      <div id="clientBatchRoute" class="batch-route-preview hidden"></div>'''
    i = replace_once(i, qanchor, qinsert, 'batch quote html')
    i = i.replace('styles.css?v=11.0.4-staging','styles.css?v=11.1.0-batch')
    i = i.replace('app.js?v=11.0.2-staging','app.js?v=11.1.0-batch')
    ip.write_text(i)

# ---------------- CSS ----------------
sp = ROOT / 'styles.css'
s = sp.read_text()
if 'V11 batch / multi-stop' not in s:
    s += r'''

/* V11 batch / multi-stop */
.batch-add-wrap{margin-top:6px;padding:13px;border:1px dashed rgba(255,208,0,.55);border-radius:16px;background:rgba(255,208,0,.045)}
.batch-add-wrap small{display:block;margin-top:7px;opacity:.72;line-height:1.35}.batch-add-btn{width:100%;border-color:rgba(255,208,0,.75)!important;color:var(--accent,#ffd000)!important;background:rgba(255,208,0,.08)!important;font-weight:900}
.second-delivery-panel{padding:14px;border:1px solid rgba(255,208,0,.45);border-radius:18px;background:rgba(255,208,0,.04)}.second-delivery-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}.second-delivery-head b{font-size:1.05rem}.batch-route-preview{margin:12px 0;padding:13px;border:1px solid rgba(255,208,0,.42);border-radius:15px;background:rgba(255,208,0,.055)}.batch-route-preview>b{display:block;color:var(--accent,#ffd000);margin-bottom:8px}.batch-route-preview span{display:block;padding:6px 0;border-top:1px solid rgba(255,255,255,.07);font-size:.9rem}.batch-request,.batch-order{border-color:rgba(255,208,0,.6)!important}.batch-pickup,.batch-next-stop{display:flex;flex-direction:column;gap:4px;margin:10px 0;padding:12px;border-radius:13px;background:rgba(255,208,0,.07);border:1px solid rgba(255,208,0,.26)}.batch-pickup b,.batch-next-stop small{color:var(--accent,#ffd000);font-weight:900}.batch-stop-list{display:grid;gap:8px;margin:10px 0}.batch-stop-list>div{display:flex;flex-direction:column;gap:2px;padding:10px 11px;border-radius:12px;background:rgba(127,127,127,.08);border:1px solid rgba(127,127,127,.14)}.batch-stop-list small,.batch-stop-list span{opacity:.75}.batch-stop-list.compact>div{padding:7px 9px}.batch-stop-list .done{opacity:.55}.batch-status-stops{display:grid;gap:8px;margin-top:8px}.batch-status-stops>div{display:flex;flex-direction:column;gap:3px;padding:9px;border-radius:10px;background:rgba(127,127,127,.08)}
'''
    sp.write_text(s)

# ---------------- MIGRATION DOC ----------------
mp = ROOT / 'migration-v11-to-v11.1-batches.sql'
if not mp.exists():
    mp.write_text('''-- SOS Rider V11.1 · Batch / 2 consegne, stesso ritiro\n-- Il Worker crea queste tabelle anche automaticamente con IF NOT EXISTS.\nCREATE TABLE IF NOT EXISTS request_batches (\n  batch_id TEXT PRIMARY KEY, submission_id TEXT NOT NULL UNIQUE, user_id TEXT NOT NULL DEFAULT '', client_token TEXT NOT NULL,\n  requester_name TEXT NOT NULL, requester_phone TEXT NOT NULL, pickup_address TEXT NOT NULL, pickup_lat REAL NOT NULL, pickup_lon REAL NOT NULL,\n  ready_time TEXT NOT NULL, service TEXT NOT NULL, total_distance_km REAL NOT NULL DEFAULT 0, total_duration_min INTEGER NOT NULL DEFAULT 0,\n  base_fee REAL NOT NULL DEFAULT 0, extra_stop_fee REAL NOT NULL DEFAULT 3.5, late_fee REAL NOT NULL DEFAULT 0, total_fee REAL NOT NULL DEFAULT 0,\n  route_order TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'new', created_at TEXT NOT NULL, updated_at TEXT NOT NULL\n);\nCREATE TABLE IF NOT EXISTS request_batch_items (batch_id TEXT NOT NULL, code TEXT NOT NULL UNIQUE, stop_index INTEGER NOT NULL, fee_share REAL NOT NULL DEFAULT 0, PRIMARY KEY(batch_id,code));\nCREATE INDEX IF NOT EXISTS idx_batch_items_batch_stop ON request_batch_items(batch_id,stop_index);\nCREATE INDEX IF NOT EXISTS idx_batches_created ON request_batches(created_at DESC);\n''')

# Sync frontend preview files.
for name in ['app.js','index.html','styles.css']:
    src = ROOT / name
    dst = ROOT / 'preview-v11' / name
    if dst.exists(): dst.write_text(src.read_text())

# Cache bust preview/root SW.
for path in [ROOT/'sw.js', ROOT/'preview-v11'/'sw.js']:
    if path.exists():
        sw = path.read_text()
        sw = re.sub(r"const CACHE='[^']+';", "const CACHE='sos-rider-v11-20260910-batch-1110';", sw, count=1)
        path.write_text(sw)

print('V11.1 batch patch applied')
