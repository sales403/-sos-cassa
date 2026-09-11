const VERSION = 'SOS Rider API 11.2.0-weather';
const V11_BATCH_FEATURE = true;
const WEATHER_FEE_EUR = 3;
let batchSchemaReady = false;
let weatherSchemaReady = false;

const ETA_MODEL = Object.freeze({
  ebikeKmh: 30,
  motoKmh: 35,
  autoKmh: 28,
  roadFactor: 1.22,
  legBufferMin: 1,
  pickupBufferMin: 2,
  dropoffBufferMin: 2,
  windowMin: 3
});

const DEFAULT_ORIGINS = [
  'https://sales403.github.io',
  'https://sos-rider-richiesta.marcello-marcellopo.chatgpt.site',
  'http://localhost:8000',
  'http://127.0.0.1:8000'
];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    const cors = corsHeaders(origin, env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    try {
      if (url.pathname === '/api/status' && request.method === 'GET') {
        return json({
          ok: true,
          version: VERSION,
          capabilities: {
            address: true,
            route: true,
            quote: true,
            requests: !!env.DB,
            auth: authIsConfigured(env),
            telegram: !!(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID),
            availability: !!env.DB,
            eta: !!env.DB,
            etaEbikeKmh: ETA_MODEL.ebikeKmh,
            riderLocation: !!env.DB,
            dispatchDecision: !!env.DB,
            maxConcurrentOrders: 2,
            batch: !!env.DB,
            weatherAdverse: !!env.DB,
            push: !!(env.DB && env.VAPID_PRIVATE_JWK)
          }
        }, 200, cors);
      }

      if (url.pathname === '/api/address' && request.method === 'GET') {
        return handleAddress(url, cors);
      }

      if (url.pathname === '/api/route' && request.method === 'GET') {
        return handleRoute(url, cors);
      }

      if (url.pathname === '/api/quote' && request.method === 'POST') {
        return handleQuote(request, env, cors);
      }

      if (url.pathname === '/api/batch/quote' && request.method === 'POST') {
        requireDb(env);
        return handleBatchQuote(request, env, cors);
      }

      if (url.pathname === '/api/requests/batch' && request.method === 'POST') {
        requireDb(env);
        return createBatchRequest(request, env, ctx, cors);
      }

      const guestBatchMatch = url.pathname.match(/^\/api\/batches\/([^/]+)$/);
      if (guestBatchMatch && request.method === 'GET') {
        requireDb(env);
        return getGuestBatch(guestBatchMatch[1], url, env, cors);
      }

      if (url.pathname === '/api/availability' && request.method === 'GET') {
        requireDb(env);
        return json({ ok: true, availability: await computeAvailability(env) }, 200, cors);
      }

      if (url.pathname === '/api/me' && request.method === 'GET') {
        requireDb(env);
        const a = await requireAuth(request, env);
        return json({ ok: true, profile: publicProfile(a.profile) }, 200, cors);
      }

      if (url.pathname === '/api/me' && request.method === 'PATCH') {
        requireDb(env);
        const a = await requireAuth(request, env);
        return updateMyProfile(request, env, a, cors);
      }

      if (url.pathname === '/api/requests' && request.method === 'POST') {
        requireDb(env);
        return createRequest(request, env, ctx, cors);
      }

      const guestMatch = url.pathname.match(/^\/api\/requests\/([^/]+)$/);
      if (guestMatch && request.method === 'GET') {
        requireDb(env);
        return getGuestRequest(guestMatch[1], url, env, cors);
      }

      if (url.pathname === '/api/client/requests' && request.method === 'GET') {
        requireDb(env);
        const a = await requireRole(request, env, 'client');
        return listClientRequests(url, env, a, cors);
      }

      const clientMatch = url.pathname.match(/^\/api\/client\/requests\/([^/]+)$/);
      if (clientMatch && request.method === 'GET') {
        requireDb(env);
        const a = await requireRole(request, env, 'client');
        return getClientRequest(clientMatch[1], env, a, cors);
      }

      if (url.pathname === '/api/rider/availability' && request.method === 'PATCH') {
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

      if (url.pathname === '/api/rider/location' && request.method === 'GET') {
        requireDb(env);
        await requireRole(request, env, 'rider');
        return json({ ok: true, location: await getRiderLocation(env) }, 200, cors);
      }

      if (url.pathname === '/api/rider/location' && (request.method === 'PATCH' || request.method === 'POST')) {
        requireDb(env);
        await requireRole(request, env, 'rider');
        return updateRiderLocation(request, env, cors);
      }

      if (url.pathname === '/api/rider/requests' && request.method === 'GET') {
        requireDb(env);
        await requireRole(request, env, 'rider');
        return listRiderRequests(url, env, cors);
      }

      if (url.pathname === '/api/rider/push/subscribe' && request.method === 'POST') {
        requireDb(env);
        const a = await requireRole(request, env, 'rider');
        return subscribePush(request, env, a, cors);
      }

      if (url.pathname === '/api/rider/push/test' && request.method === 'POST') {
        requireDb(env);
        await requireRole(request, env, 'rider');
        const result = await sendPushToAll(env);
        return json({ ok: true, ...result }, 200, cors);
      }

      const riderBatchMatch = url.pathname.match(/^\/api\/rider\/batches\/([^/]+)$/);
      if (riderBatchMatch && request.method === 'PATCH') {
        requireDb(env);
        await requireRole(request, env, 'rider');
        return updateRiderBatch(riderBatchMatch[1], request, env, cors);
      }

      const riderMatch = url.pathname.match(/^\/api\/rider\/requests\/([^/]+)$/);
      if (riderMatch && request.method === 'PATCH') {
        requireDb(env);
        await requireRole(request, env, 'rider');
        return updateRiderRequest(riderMatch[1], request, env, cors);
      }

      return json({ error: 'Not found' }, 404, cors);

    } catch (e) {
      const status = Number(e.status) || 500;
      console.error('SOS Rider worker error', e);

      return json({
        error: status === 500 ? 'Errore server' : e.message,
        detail: status === 500 ? String(e.message || e) : undefined
      }, status, cors);
    }
  }
};

function corsHeaders(origin, env) {
  const extra = String(env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  const allowed = new Set([...DEFAULT_ORIGINS, ...extra]);

  const headers = {
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };

  if (!origin || allowed.has(origin)) {
    headers['Access-Control-Allow-Origin'] = origin || '*';
  }

  return headers;
}

function json(data, status = 200, extra = {}) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        'Content-Type': 'application/json;charset=UTF-8',
        'Cache-Control': 'no-store',
        ...extra
      }
    }
  );
}

function fail(message, status = 400) {
  const e = new Error(message);
  e.status = status;
  throw e;
}

function requireDb(env) {
  if (!env.DB) fail('Database D1 non configurato', 503);
}

function cleanText(v, max = 220) {
  return String(v ?? '')
    .replace(/[\u0000-\u001F]/g, ' ')
    .trim()
    .slice(0, max);
}

function cleanPhone(v) {
  return String(v || '')
    .replace(/\D/g, '')
    .replace(/^39(?=3\d{8,9}$)/, '')
    .slice(0, 13);
}

function validCoord(lat, lon) {
  lat = Number(lat);
  lon = Number(lon);

  return Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= 35 &&
    lat <= 48 &&
    lon >= 6 &&
    lon <= 19;
}

function isLate(t) {
  const m = String(t || '').match(/^(\d{2}):(\d{2})$/);
  if (!m) return false;

  return Number(m[1]) * 60 + Number(m[2]) >= 22 * 60 + 30;
}

function roundHalf(n) {
  return Math.round(Number(n || 0) * 2) / 2;
}

function tariffFor(km, service, readyTime, weatherAdverse = false) {
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
}

// ---------- Auth Supabase ----------

function authIsConfigured(env) {
  return /^https:\/\/.+\.supabase\.co$/i.test(String(env.SUPABASE_URL || '')) &&
    String(env.SUPABASE_ANON_KEY || '').length > 20;
}

function riderEmailSet(env) {
  return new Set(
    String(env.RIDER_EMAILS || '')
      .split(',')
      .map(x => x.trim().toLowerCase())
      .filter(Boolean)
  );
}

async function requireAuth(request, env, optional = false) {
  const h = String(request.headers.get('Authorization') || '');
  const m = h.match(/^Bearer\s+(.+)$/i);

  if (!m) {
    if (optional) return null;
    fail('Accesso richiesto', 401);
  }

  if (!authIsConfigured(env)) {
    fail('Autenticazione Supabase non configurata sul Worker', 503);
  }

  const res = await fetch(
    String(env.SUPABASE_URL).replace(/\/+$/, '') + '/auth/v1/user',
    {
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        Authorization: 'Bearer ' + m[1]
      }
    }
  );

  if (!res.ok) {
    if (optional) return null;
    fail('Sessione non valida o scaduta', 401);
  }

  const user = await res.json();

  if (!user?.id) {
    if (optional) return null;
    fail('Utente non valido', 401);
  }

  if (!user.email_confirmed_at) {
    fail('Email account non confermata', 403);
  }

  const profile = await ensureProfile(env, user);

  return {
    user,
    profile,
    token: m[1]
  };
}

async function requireRole(request, env, role) {
  const a = await requireAuth(request, env);

  if (a.profile.role !== role) {
    fail('Accesso non autorizzato per questo profilo', 403);
  }

  return a;
}

async function ensureProfile(env, user) {
  const email = String(user.email || '').toLowerCase();
  const role = riderEmailSet(env).has(email) ? 'rider' : 'client';

  const existing = await env.DB
    .prepare('SELECT * FROM profiles WHERE user_id=?')
    .bind(user.id)
    .first();

  const meta = user.user_metadata || {};

  const displayName = cleanText(
    existing?.display_name ||
    meta.display_name ||
    meta.full_name ||
    '',
    80
  );

  const phone = cleanPhone(
    existing?.phone ||
    meta.phone ||
    ''
  );

  const now = new Date().toISOString();

  if (!existing) {
    await env.DB.prepare(
      'INSERT INTO profiles(user_id,email,role,display_name,phone,pickup_address,pickup_lat,pickup_lon,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)'
    ).bind(
      user.id,
      email,
      role,
      displayName,
      phone,
      '',
      null,
      null,
      now,
      now
    ).run();

  } else if (existing.role !== role || existing.email !== email) {
    await env.DB.prepare(
      'UPDATE profiles SET email=?,role=?,updated_at=? WHERE user_id=?'
    ).bind(
      email,
      role,
      now,
      user.id
    ).run();
  }

  return env.DB
    .prepare('SELECT * FROM profiles WHERE user_id=?')
    .bind(user.id)
    .first();
}

function publicProfile(p) {
  return {
    userId: p.user_id,
    email: p.email,
    role: p.role,
    displayName: p.display_name || '',
    phone: p.phone || '',
    pickupAddress: p.pickup_address || '',
    pickupLat: p.pickup_lat == null ? null : Number(p.pickup_lat),
    pickupLon: p.pickup_lon == null ? null : Number(p.pickup_lon),
    createdAt: p.created_at,
    updatedAt: p.updated_at
  };
}

async function updateMyProfile(request, env, a, cors) {
  if (a.profile.role !== 'client') {
    fail('Il profilo Rider non viene modificato dal portale cliente', 403);
  }

  const p = await request.json().catch(() => fail('JSON non valido'));

  const displayName = cleanText(p.displayName, 80);
  const phone = cleanPhone(p.phone);
  const pickupAddress = cleanText(p.pickupAddress, 180);

  let pickupLat = p.pickupLat == null ? null : Number(p.pickupLat);
  let pickupLon = p.pickupLon == null ? null : Number(p.pickupLon);

  if (displayName && displayName.length < 2) {
    fail('Nome profilo non valido');
  }

  if (phone && phone.length < 9) {
    fail('Telefono non valido');
  }

  if (pickupAddress && (!validCoord(pickupLat, pickupLon))) {
    fail('Indirizzo profilo non verificato');
  }

  if (!pickupAddress) {
    pickupLat = a.profile.pickup_lat;
    pickupLon = a.profile.pickup_lon;
  }

  await env.DB.prepare(
    'UPDATE profiles SET display_name=?,phone=?,pickup_address=?,pickup_lat=?,pickup_lon=?,updated_at=? WHERE user_id=?'
  ).bind(
    displayName || a.profile.display_name || '',
    phone || a.profile.phone || '',
    pickupAddress || a.profile.pickup_address || '',
    pickupAddress ? pickupLat : (a.profile.pickup_lat ?? null),
    pickupAddress ? pickupLon : (a.profile.pickup_lon ?? null),
    new Date().toISOString(),
    a.user.id
  ).run();

  const profile = await env.DB
    .prepare('SELECT * FROM profiles WHERE user_id=?')
    .bind(a.user.id)
    .first();

  return json({
    ok: true,
    profile: publicProfile(profile)
  }, 200, cors);
}

// ---------- Indirizzi / route ----------

async function handleAddress(url, cors) {
  const q = cleanText(url.searchParams.get('q'), 160);

  if (q.length < 3) {
    return json({ features: [] }, 200, cors);
  }

  const u = new URL('https://photon.komoot.io/api/');
  u.searchParams.set('q', q);
  u.searchParams.set('limit', '10');
  u.searchParams.set('lang', 'it');
  u.searchParams.set('lat', '44.783');
  u.searchParams.set('lon', '10.884');

  const res = await fetch(
    u.toString(),
    {
      headers: {
        'User-Agent': 'SOS-Rider-Carpi-Soliera/10.0'
      }
    }
  );

  if (!res.ok) {
    fail('Servizio indirizzi non disponibile', 502);
  }

  const d = await res.json();

  const features = (d.features || [])
    .filter(f => {
      const p = f.properties || {};
      const cc = String(p.countrycode || '').toUpperCase();
      return !cc || cc === 'IT';
    })
    .sort((a, b) => localScore(b) - localScore(a))
    .slice(0, 7);

  return json({ features }, 200, cors);
}

function localScore(f) {
  const p = f.properties || {};

  const txt = [
    p.city,
    p.locality,
    p.district,
    p.county,
    p.state
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  let s = 0;

  if (/carpi/.test(txt)) s += 10;
  if (/soliera/.test(txt)) s += 10;
  if (/limidi|sozzigalli|cortile/.test(txt)) s += 12;
  if (/modena/.test(txt)) s += 5;
  if (/emilia/.test(txt)) s += 2;

  return s;
}

function parsePoint(s) {
  const p = String(s || '')
    .split(',')
    .map(Number);

  if (p.length !== 2) return null;

  const [lon, lat] = p;

  if (!validCoord(lat, lon)) return null;

  return { lat, lon };
}

async function routeData(from, to, service) {
  const a = parsePoint(from);
  const b = parsePoint(to);

  if (!a || !b) {
    fail('Coordinate percorso non valide', 400);
  }

  const profile = service === 'ebike' ? 'cycling' : 'driving';

  const u =
    'https://router.project-osrm.org/route/v1/driving/' +
    a.lon + ',' + a.lat + ';' + b.lon + ',' + b.lat +
    '?overview=false&steps=false&alternatives=false';

  const res = await fetch(
    u,
    {
      headers: {
        'User-Agent': 'SOS-Rider-Carpi-Soliera/10.0'
      }
    }
  );

  if (!res.ok) {
    fail('Servizio percorso temporaneamente non disponibile', 502);
  }

  const d = await res.json();
  const r = d.routes?.[0];

  if (!r?.distance) {
    fail('Percorso non calcolabile per questi indirizzi', 422);
  }

  const distanceKm = r.distance / 1000;
  return {
    distanceKm,
    durationMin: Math.max(1, Math.round(r.duration / 60)),
    etaTravelMin: travelMinutes(distanceKm, service),
    etaSpeedKmh: etaSpeedKmh(service),
    source: 'osrm-road',
    profile
  };
}

async function handleRoute(url, cors) {
  const service =
    ['ebike', 'moto', 'auto'].includes(url.searchParams.get('mode'))
      ? url.searchParams.get('mode')
      : 'ebike';

  return json(
    await routeData(
      url.searchParams.get('from'),
      url.searchParams.get('to'),
      service
    ),
    200,
    cors
  );
}

async function handleQuote(request, env, cors) {
  const p = await request.json().catch(() => fail('JSON non valido'));

  const service = cleanText(p.service, 10);
  const readyTime = cleanText(p.readyTime, 5);

  if (!['ebike', 'moto', 'auto'].includes(service)) {
    fail('Servizio non valido');
  }

  if (!/^\d{2}:\d{2}$/.test(readyTime)) {
    fail('Orario non valido');
  }

  const a = {
    lat: Number(p.pickupLat),
    lon: Number(p.pickupLon)
  };

  const b = {
    lat: Number(p.deliveryLat),
    lon: Number(p.deliveryLon)
  };

  if (!validCoord(a.lat, a.lon) || !validCoord(b.lat, b.lon)) {
    fail('Indirizzi non verificati');
  }

  const route = await routeData(
    a.lon + ',' + a.lat,
    b.lon + ',' + b.lat,
    service
  );

  const weather = env.DB ? await getWeatherState(env) : { adverse: false, fee: 0 };
  const fee = tariffFor(
    route.distanceKm,
    service,
    readyTime,
    weather.adverse
  );

  const availability =
    env.DB
      ? await computeAvailability(env)
      : null;

  const pickupAvailability =
    env.DB
      ? await buildPickupAvailabilityPreview(env, {
          pickupLat: a.lat,
          pickupLon: a.lon,
          service,
          readyTime
        })
      : null;

  return json({
    ok: true,
    quote: {
      ...route,
      ...fee
    },
    availability,
    pickupAvailability
  }, 200, cors);
}


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
    weather_fee REAL NOT NULL DEFAULT 0,
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
  const batchCols = await env.DB.prepare('PRAGMA table_info(request_batches)').all();
  const batchNames = new Set((batchCols.results || []).map(x => String(x.name || '')));
  if (!batchNames.has('weather_fee')) {
    await env.DB.prepare('ALTER TABLE request_batches ADD COLUMN weather_fee REAL NOT NULL DEFAULT 0').run();
  }
  await ensureWeatherSchema(env);
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
  const weather = await getWeatherState(env);
  const routeFee = tariffFor(totalDistanceKm, base.service, base.readyTime, weather.adverse);
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
    weatherFee: routeFee.weatherFee,
    weatherAdverse: routeFee.weatherAdverse,
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
    weatherFee: x.weatherFee,
    weatherAdverse: x.weatherAdverse,
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
    b.total_fee AS batch_total_fee,b.extra_stop_fee,b.weather_fee AS batch_weather_fee,b.total_distance_km,b.route_order,b.status AS batch_status,
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
    batchWeatherFee: Number(meta.batch_weather_fee) || 0,
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
    ready_time,service,total_distance_km,total_duration_min,base_fee,extra_stop_fee,late_fee,weather_fee,total_fee,route_order,status,created_at,updated_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
    batchId,submissionId,userId,clientToken,x.base.requesterName,x.base.requesterPhone,x.base.pickupAddress,x.base.pickupLat,x.base.pickupLon,
    x.base.readyTime,x.base.service,x.totalDistanceKm,x.totalDurationMin,x.baseFee,x.extraStopFee,x.lateFee,x.weatherFee,x.totalFee,
    x.routeOrder.join(','),'new',now,now
  ));

  for (let originalIndex = 0; originalIndex < 2; originalIndex++) {
    const s = x.stops[originalIndex];
    const direct = x.singleRoutes[originalIndex];
    const share = x.sharesByOriginal[originalIndex];
    statements.push(env.DB.prepare(`INSERT INTO requests(
      code,client_token,submission_id,user_id,created_at,updated_at,status,requester_name,requester_phone,pickup_address,pickup_lat,pickup_lon,
      ready_time,recipient_name,recipient_phone,delivery_address,delivery_lat,delivery_lon,service,payment,order_total,notes,
      distance_km,duration_min,route_source,base_fee,late_fee,weather_fee,total_fee,micro_delivery,rejection_reason
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
      codes[originalIndex],clientToken,submissionId + '_' + (originalIndex + 1),userId,now,now,'new',x.base.requesterName,x.base.requesterPhone,
      x.base.pickupAddress,x.base.pickupLat,x.base.pickupLon,x.base.readyTime,s.recipientName,s.recipientPhone,s.deliveryAddress,s.deliveryLat,s.deliveryLon,
      x.base.service,s.payment,s.orderTotal,s.notes,direct.distanceKm,direct.durationMin,direct.source,share,0,0,share,
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
    batchTotalFee: Number(x.batch.total_fee) || 0,
    batchExtraStopFee: Number(x.batch.extra_stop_fee) || 0,
    batchTotalDistanceKm: Number(x.batch.total_distance_km) || 0,
    batchPickupAddress: x.batch.pickup_address || r.pickup_address,
    batchPickupLat: Number(x.batch.pickup_lat),
    batchPickupLon: Number(x.batch.pickup_lon),
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
      weatherFee: Number(x.batch.weather_fee) || 0,
      weatherAdverse: Number(x.batch.weather_fee) > 0,
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

// ---------- Disponibilità + ETA automatici ----------

function etaSpeedKmh(service) {
  if (service === 'moto') return ETA_MODEL.motoKmh;
  if (service === 'auto') return ETA_MODEL.autoKmh;
  return ETA_MODEL.ebikeKmh;
}

function travelMinutes(km, service = 'ebike') {
  km = Math.max(0, Number(km) || 0);
  if (!km) return 1;
  return Math.max(
    1,
    Math.ceil((km / etaSpeedKmh(service)) * 60 + ETA_MODEL.legBufferMin)
  );
}

function haversineKm(lat1, lon1, lat2, lon2) {
  lat1 = Number(lat1); lon1 = Number(lon1);
  lat2 = Number(lat2); lon2 = Number(lon2);
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return 0;
  const toRad = d => d * Math.PI / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function estimatedRoadKm(aLat, aLon, bLat, bLon) {
  return haversineKm(aLat, aLon, bLat, bLon) * ETA_MODEL.roadFactor;
}

function isoPlusMinutes(min) {
  return new Date(Date.now() + Math.max(0, Number(min) || 0) * 60000).toISOString();
}

function etaWindow(min) {
  min = Math.max(0, Math.ceil(Number(min) || 0));
  return {
    min,
    at: isoPlusMinutes(min),
    windowStart: isoPlusMinutes(min),
    windowEnd: isoPlusMinutes(min + ETA_MODEL.windowMin)
  };
}

function etaPayload({ queuePosition, stage, pickupMin = null, deliveryMin = null, previewPickupMin = null, service = 'ebike' }) {
  const out = {
    automatic: true,
    model: 'distance-speed-queue-v1',
    queuePosition: queuePosition || null,
    stage,
    speedKmh: etaSpeedKmh(service),
    updatedAt: new Date().toISOString()
  };
  if (pickupMin != null) out.pickup = etaWindow(pickupMin);
  if (deliveryMin != null) out.delivery = etaWindow(deliveryMin);
  if (previewPickupMin != null) out.previewPickup = etaWindow(previewPickupMin);
  return out;
}

async function ensurePresence(env) {
  const row = await env.DB
    .prepare('SELECT * FROM rider_presence WHERE id=1')
    .first();

  if (row) return row;

  const now = new Date().toISOString();

  await env.DB.prepare(
    'INSERT INTO rider_presence(id,enabled,eta_per_job,updated_at) VALUES(1,0,5,?)'
  ).bind(now).run();

  return env.DB
    .prepare('SELECT * FROM rider_presence WHERE id=1')
    .first();
}

async function buildEtaState(env) {
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
}

async function computeAvailability(env) {
  return (await buildEtaState(env)).availability;
}

async function buildPickupAvailabilityPreview(env, input) {
  const state = await buildEtaState(env);
  const a = state.availability;
  const ctx = state.queueContext || {};
  const pickupLat = Number(input.pickupLat);
  const pickupLon = Number(input.pickupLon);
  const service = ['ebike','moto','auto'].includes(input.service) ? input.service : 'ebike';

  if (!validCoord(pickupLat, pickupLon)) {
    return {
      mode: 'unknown',
      enabled: !!a?.enabled,
      canSubmit: !!a?.enabled,
      level: 'yellow',
      title: 'Disponibilità da verificare',
      text: 'Indirizzo di ritiro non verificato.',
      active: Number(ctx.active) || 0
    };
  }

  if (!a?.enabled) {
    return {
      mode: 'offline',
      enabled: false,
      manualOffline: true,
      canSubmit: false,
      level: 'red',
      title: 'Rider non disponibile',
      text: 'Marcello ha impostato manualmente il servizio come non disponibile.',
      active: Number(ctx.active) || 0,
      pending: Number(ctx.pending) || 0,
      pickupEta: null,
      pickupEtaMin: null,
      queueAhead: Number(ctx.active) || 0,
      locationFresh: !!state.liveLocation?.fresh,
      updatedAt: a?.updatedAt || new Date().toISOString()
    };
  }

  let pickupMin = Math.max(0, Number(ctx.cursorMin) || 0);
  let transferKm = null;

  if (ctx.lastPoint && validCoord(ctx.lastPoint.lat, ctx.lastPoint.lon)) {
    transferKm = estimatedRoadKm(
      ctx.lastPoint.lat,
      ctx.lastPoint.lon,
      pickupLat,
      pickupLon
    );
    pickupMin += travelMinutes(transferKm, service);
  } else if (state.liveLocation?.fresh && validCoord(state.liveLocation.lat, state.liveLocation.lon)) {
    transferKm = estimatedRoadKm(
      state.liveLocation.lat,
      state.liveLocation.lon,
      pickupLat,
      pickupLon
    );
    pickupMin += travelMinutes(transferKm, service);
  } else {
    pickupMin += Math.max(5, Number(a?.firstPickupEtaMin) || 5);
  }

  pickupMin = Math.max(1, Math.ceil(pickupMin));
  const active = Number(ctx.active) || 0;
  const readyInMin = minutesUntilReadyLocal(input.readyTime);
  const lateByMin = Math.max(0, pickupMin - readyInMin);

  let level = active > 0 ? 'yellow' : 'green';
  let title = active > 0
    ? `Rider impegnato · ${active} consegna${active === 1 ? '' : 'e'} prima della tua`
    : 'Rider disponibile';

  let text = active > 0
    ? 'ETA calcolato completando prima le consegne già prese in carico.'
    : 'ETA calcolato dalla posizione attuale del rider.';

  if (lateByMin > 12) {
    level = 'red';
    text = 'L’arrivo stimato è sensibilmente successivo all’orario in cui l’ordine sarà pronto.';
  } else if (lateByMin > 5) {
    level = 'yellow';
    text = 'L’arrivo stimato potrebbe essere qualche minuto dopo l’orario pronto.';
  } else if (readyInMin > pickupMin) {
    text = active > 0
      ? 'La coda attuale è compatibile con l’orario di preparazione.'
      : 'Arrivo previsto in linea con l’orario di preparazione.';
  }

  return {
    mode: active > 0 ? 'busy' : 'available',
    enabled: true,
    manualOffline: false,
    canSubmit: true,
    level,
    title,
    text,
    active,
    pending: Number(ctx.pending) || 0,
    queueAhead: active,
    pickupEta: etaWindow(pickupMin),
    pickupEtaMin: pickupMin,
    readyInMin,
    lateByMin,
    transferKm: transferKm == null ? null : Math.round(transferKm * 10) / 10,
    locationFresh: !!state.liveLocation?.fresh,
    updatedAt: new Date().toISOString()
  };
}

function attachEta(row, etaByCode, safe = false) {
  const base = safe ? rowClientSafe(row) : rowPublic(row);
  return {
    ...base,
    eta: etaByCode?.[row.code] || null
  };
}

async function updateAvailability(request, env, cors) {
  const p = await request.json().catch(() => fail('JSON non valido'));
  const enabled = !!p.enabled;

  // This value is now ONLY the anchor for the very first pickup when the app
  // does not know Marcello's live position. Queue legs are calculated automatically.
  const eta = Math.max(
    5,
    Math.min(
      60,
      Number(p.etaPerJob) || 5
    )
  );

  await ensurePresence(env);

  await env.DB.prepare(
    'UPDATE rider_presence SET enabled=?,eta_per_job=?,updated_at=? WHERE id=1'
  ).bind(
    enabled ? 1 : 0,
    eta,
    new Date().toISOString()
  ).run();

  return json({
    ok: true,
    availability: await computeAvailability(env)
  }, 200, cors);
}


const RIDER_LOCATION_MAX_AGE_SEC = 90;
const MAX_ACTIVE_ORDERS = 2;

async function getRiderLocation(env) {
  try {
    const row = await env.DB.prepare('SELECT * FROM rider_location WHERE id=1').first();
    if (!row) return null;
    const capturedAt = row.captured_at || row.updated_at || '';
    const ms = Date.parse(capturedAt);
    const ageSec = Number.isFinite(ms) ? Math.max(0, Math.floor((Date.now() - ms) / 1000)) : null;
    return {
      lat: Number(row.lat),
      lon: Number(row.lon),
      accuracyM: Number(row.accuracy_m) || null,
      speedMps: Number.isFinite(Number(row.speed_mps)) ? Number(row.speed_mps) : null,
      headingDeg: Number.isFinite(Number(row.heading_deg)) ? Number(row.heading_deg) : null,
      source: row.source || 'pwa',
      capturedAt,
      ageSec,
      fresh: ageSec != null && ageSec <= RIDER_LOCATION_MAX_AGE_SEC
    };
  } catch (e) {
    console.warn('rider_location unavailable', e);
    return null;
  }
}

async function updateRiderLocation(request, env, cors) {
  const p = await request.json().catch(() => fail('JSON non valido'));
  const lat = Number(p.lat);
  const lon = Number(p.lon);
  if (!validCoord(lat, lon)) fail('Posizione rider non valida');

  const accuracy = Number.isFinite(Number(p.accuracyM)) ? Math.max(0, Number(p.accuracyM)) : null;
  const speed = Number.isFinite(Number(p.speedMps)) ? Math.max(0, Number(p.speedMps)) : null;
  const heading = Number.isFinite(Number(p.headingDeg)) ? Number(p.headingDeg) : null;
  const source = cleanText(p.source || 'pwa', 30) || 'pwa';
  let capturedAt = cleanText(p.capturedAt, 40);
  const capturedMs = Date.parse(capturedAt);
  if (!Number.isFinite(capturedMs) || capturedMs > Date.now() + 120000 || capturedMs < Date.now() - 3600000) {
    capturedAt = new Date().toISOString();
  }
  const now = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO rider_location(id,lat,lon,accuracy_m,speed_mps,heading_deg,source,captured_at,updated_at)
     VALUES(1,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       lat=excluded.lat,
       lon=excluded.lon,
       accuracy_m=excluded.accuracy_m,
       speed_mps=excluded.speed_mps,
       heading_deg=excluded.heading_deg,
       source=excluded.source,
       captured_at=excluded.captured_at,
       updated_at=excluded.updated_at`
  ).bind(lat, lon, accuracy, speed, heading, source, capturedAt, now).run();

  return json({ ok: true, location: await getRiderLocation(env) }, 200, cors);
}

async function safeLogEvent(env, code, eventType, statusFrom='', statusTo='', source='system', payload={}) {
  try {
    await env.DB.prepare(
      'INSERT INTO request_events(code,event_type,status_from,status_to,source,payload_json,created_at) VALUES(?,?,?,?,?,?,?)'
    ).bind(
      cleanText(code, 40),
      cleanText(eventType, 40),
      cleanText(statusFrom, 20),
      cleanText(statusTo, 20),
      cleanText(source, 20),
      JSON.stringify(payload || {}).slice(0, 3000),
      new Date().toISOString()
    ).run();
  } catch (e) {
    console.warn('request_events unavailable', e);
  }
}

function minutesUntilReadyLocal(hhmm) {
  const m = String(hhmm || '').match(/^(\d{2}):(\d{2})$/);
  if (!m) return 0;

  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Rome',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date());

  const hour = Number(parts.find(p => p.type === 'hour')?.value || 0);
  const minute = Number(parts.find(p => p.type === 'minute')?.value || 0);
  const nowMin = hour * 60 + minute;
  let targetMin = Number(m[1]) * 60 + Number(m[2]);

  // Se l'orario è appena dopo mezzanotte rispetto a "ora", trattalo come giorno successivo.
  if (targetMin < nowMin - 12 * 60) targetMin += 24 * 60;

  return Math.max(0, targetMin - nowMin);
}

function buildDispatchDecision(r, ctx) {
  const active = Number(ctx.activeCount) || 0;
  const pickupMin = Math.max(0, Math.ceil(Number(ctx.pickupMin) || 0));
  const transferKm = Number.isFinite(Number(ctx.transferKm)) ? Math.max(0, Number(ctx.transferKm)) : null;
  const location = ctx.liveLocation || null;
  const carryingFood = !!ctx.carryingFood;
  const requestedSlots = Math.max(1, Number(ctx.requestedSlots) || 1);
  const readyInMin = minutesUntilReadyLocal(r.ready_time);
  const lateByMin = Math.max(0, pickupMin - readyInMin);

  let level = 'green';
  let label = 'ACCETTABILE';
  let reason = active
    ? 'Inseribile in coda senza interferire con le consegne già attive.'
    : 'Primo ordine: ETA compatibile con l’orario di preparazione.';
  let recommendation = active
    ? 'Completa prima la missione in corso, poi vai al nuovo ritiro.'
    : 'Puoi dirigerti verso il ritiro.';

  if (active + requestedSlots > MAX_ACTIVE_ORDERS) {
    level = 'red';
    label = 'NON ACCETTARE';
    reason = requestedSlots > 1 ? 'Il giro richiede 2 slot liberi e supererebbe il limite operativo.' : 'Hai già raggiunto il limite iniziale di 2 ordini attivi.';
    recommendation = 'Completa almeno una consegna prima di accettarne un’altra.';
  } else if (active === 0 && (!location || !location.fresh)) {
    level = 'yellow';
    label = 'VALUTA';
    reason = 'La posizione live non è aggiornata: l’ETA usa ancora il tempo manuale per il primo ritiro.';
    recommendation = 'Aggiorna il GPS prima di confermare il tempo al locale.';
  } else if (active === 0) {
    if (lateByMin > 12) {
      level = 'red';
      label = 'NON CONSIGLIATO';
      reason = 'Da dove sei ora arriveresti troppo tardi rispetto all’orario in cui l’ordine sarà pronto.';
      recommendation = 'Accetta solo se il locale conferma che può attendere.';
    } else if (lateByMin > 5) {
      level = 'yellow';
      label = 'VALUTA';
      reason = 'Il ritiro è raggiungibile, ma rischi qualche minuto di ritardo rispetto all’orario pronto.';
      recommendation = 'Conferma al locale l’ETA prima di accettare.';
    } else {
      level = 'green';
      label = 'ACCETTABILE';
      reason = readyInMin > pickupMin
        ? 'Arrivi in linea con l’orario di preparazione, senza altre consegne attive.'
        : 'Nessuna coda attiva e arrivo previsto compatibile con il ritiro.';
      recommendation = 'Puoi accettare e dirigerti verso il ritiro.';
    }
  } else if (pickupMin > 25 || (transferKm != null && transferKm > 6)) {
    level = 'red';
    label = 'NON CONSIGLIATO';
    reason = 'Il nuovo ritiro è troppo lontano rispetto alle consegne già attive.';
    recommendation = 'Accetta solo se il locale conferma che può attendere.';
  } else if (pickupMin > 15 || (transferKm != null && transferKm > 3)) {
    level = 'yellow';
    label = 'VALUTA';
    reason = 'Compatibile, ma con attesa o trasferimento non trascurabile rispetto alla coda attiva.';
    recommendation = carryingFood
      ? 'Consegna prima il cibo già ritirato; poi valuta il nuovo ritiro.'
      : 'Controlla l’orario “pronto” prima di accettare.';
  }

  if (carryingFood && active < MAX_ACTIVE_ORDERS && level === 'green') {
    reason = 'Compatibile solo in coda: il cibo già ritirato mantiene priorità assoluta.';
    recommendation = 'Consegna prima l’ordine che hai nello zaino, poi vai al nuovo ritiro.';
  }

  return {
    level,
    label,
    reason,
    recommendation,
    pickupEtaMin: pickupMin,
    readyInMin,
    lateByMin,
    incrementalKm: transferKm == null ? null : Math.round(transferKm * 10) / 10,
    activeOrders: active,
    requestedSlots,
    maxActiveOrders: MAX_ACTIVE_ORDERS,
    carryingFood,
    locationFresh: !!location?.fresh,
    locationAgeSec: location?.ageSec ?? null,
    calculatedAt: new Date().toISOString()
  };
}

// ---------- Web Push ----------

function b64url(bytes) {
  const a = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const b of a) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function b64urlText(text) {
  return b64url(new TextEncoder().encode(text));
}

function jwkPublicKeyB64(jwk) {
  const dec = s => {
    s = String(s || '').replace(/-/g, '+').replace(/_/g, '/');
    s += '='.repeat((4 - s.length % 4) % 4);
    const raw = atob(s);
    return Uint8Array.from(raw, c => c.charCodeAt(0));
  };

  const x = dec(jwk.x);
  const y = dec(jwk.y);

  const pub = new Uint8Array(65);
  pub[0] = 4;
  pub.set(x, 1);
  pub.set(y, 33);

  return b64url(pub);
}

async function vapidHeaders(endpoint, env) {
  if (!env.VAPID_PRIVATE_JWK) fail('Web Push non configurata', 503);

  let jwk;
  try {
    jwk = JSON.parse(env.VAPID_PRIVATE_JWK);
  } catch {
    fail('VAPID_PRIVATE_JWK non valida', 503);
  }

  const aud = new URL(endpoint).origin;
  const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 12;

  const header = b64urlText(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const payload = b64urlText(JSON.stringify({
    aud,
    exp,
    sub: 'mailto:marcello.marcellopo@gmail.com'
  }));

  const unsigned = header + '.' + payload;

  const key = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );

  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(unsigned)
  );

  const jwt = unsigned + '.' + b64url(sig);
  const publicKey = jwkPublicKeyB64(jwk);

  return {
    Authorization: 'vapid t=' + jwt + ', k=' + publicKey,
    TTL: '60',
    Urgency: 'high'
  };
}

async function subscribePush(request, env, a, cors) {
  const body = await request.json().catch(() => fail('JSON non valido'));
  const sub = body?.subscription || {};
  const endpoint = cleanText(sub.endpoint, 1500);
  const p256dh = cleanText(sub.keys?.p256dh, 500);
  const auth = cleanText(sub.keys?.auth, 500);
  const device = cleanText(body.device, 220);

  if (!/^https:\/\//i.test(endpoint)) {
    fail('Subscription push non valida');
  }

  const now = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO push_subscriptions(user_id,endpoint,p256dh,auth,device,created_at,updated_at)
     VALUES(?,?,?,?,?,?,?)
     ON CONFLICT(endpoint) DO UPDATE SET
       user_id=excluded.user_id,
       p256dh=excluded.p256dh,
       auth=excluded.auth,
       device=excluded.device,
       updated_at=excluded.updated_at`
  ).bind(
    a.user.id,
    endpoint,
    p256dh,
    auth,
    device,
    now,
    now
  ).run();

  return json({ ok: true, push: true }, 200, cors);
}

async function sendPushToAll(env) {
  if (!env.DB || !env.VAPID_PRIVATE_JWK) return { sent: 0, failed: 0 };

  const rows = await env.DB
    .prepare('SELECT id,endpoint FROM push_subscriptions ORDER BY updated_at DESC LIMIT 50')
    .all();

  const list = rows.results || [];

  let sent = 0;
  let failed = 0;

  for (const row of list) {
    try {
      const headers = await vapidHeaders(row.endpoint, env);

      const res = await fetch(row.endpoint, {
        method: 'POST',
        headers
      });

      if (res.status === 404 || res.status === 410) {
        await env.DB.prepare('DELETE FROM push_subscriptions WHERE id=?').bind(row.id).run();
        failed++;
        continue;
      }

      if (res.ok || res.status === 201 || res.status === 202) {
        sent++;
      } else {
        failed++;
        console.warn('Push HTTP', res.status);
      }
    } catch (e) {
      failed++;
      console.warn('Push failed', e);
    }
  }

  return { sent, failed };
}

// ---------- Richieste ----------

function makeCode() {
  const d = new Date();
  const day = String(d.getUTCDate()).padStart(2, '0');
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');

  const rnd = Math.random()
    .toString(36)
    .slice(2, 6)
    .toUpperCase();

  return 'SR-' + mo + day + '-' + rnd;
}

function token() {
  const a = new Uint8Array(18);
  crypto.getRandomValues(a);

  return Array.from(
    a,
    b => b.toString(16).padStart(2, '0')
  ).join('');
}

function validatePayload(p) {
  const d = {
    requesterName: cleanText(p.requesterName, 80),
    requesterPhone: cleanPhone(p.requesterPhone),
    pickupAddress: cleanText(p.pickupAddress, 180),
    pickupLat: Number(p.pickupLat),
    pickupLon: Number(p.pickupLon),
    readyTime: cleanText(p.readyTime, 5),
    recipientName: cleanText(p.recipientName, 80),
    recipientPhone: cleanPhone(p.recipientPhone),
    deliveryAddress: cleanText(p.deliveryAddress, 180),
    deliveryLat: Number(p.deliveryLat),
    deliveryLon: Number(p.deliveryLon),
    service: cleanText(p.service, 10),
    payment: cleanText(p.payment, 10),
    orderTotal: Number(p.orderTotal) || 0,
    notes: cleanText(p.notes, 400)
  };

  if (!d.requesterName || d.requesterPhone.length < 9) {
    fail('Dati richiedente incompleti');
  }

  if (!d.pickupAddress || !validCoord(d.pickupLat, d.pickupLon)) {
    fail('Indirizzo ritiro non verificato');
  }

  if (!/^\d{2}:\d{2}$/.test(d.readyTime)) {
    fail('Orario pronto non valido');
  }

  if (!d.recipientName || d.recipientPhone.length < 9) {
    fail('Dati destinatario incompleti');
  }

  if (!d.deliveryAddress || !validCoord(d.deliveryLat, d.deliveryLon)) {
    fail('Indirizzo consegna non verificato');
  }

  if (!['ebike', 'moto', 'auto'].includes(d.service)) {
    fail('Servizio non valido');
  }

  if (!['paid', 'cash', 'pos'].includes(d.payment)) {
    fail('Pagamento non valido');
  }

  if (d.payment === 'cash' && d.orderTotal <= 0) {
    fail('Importo ordine da incassare non valido');
  }

  return d;
}

async function createRequest(request, env, ctx, cors) {
  const p = await request.json().catch(() => fail('JSON non valido'));

  if (p.hp || p.websiteUrl) {
    fail('Richiesta non valida');
  }

  const d = validatePayload(p);

  const submissionId = cleanText(
    p.submissionId,
    80
  );

  if (!/^[A-Za-z0-9_-]{10,80}$/.test(submissionId)) {
    fail('Identificativo invio non valido');
  }

  const auth = await requireAuth(
    request,
    env,
    true
  );

  if (auth?.profile?.role === 'rider') {
    fail('L’account Rider non può creare richieste cliente', 403);
  }

  const userId =
    auth?.profile?.role === 'client'
      ? auth.user.id
      : '';

  const existing = await env.DB.prepare(
    'SELECT * FROM requests WHERE submission_id=?'
  ).bind(submissionId).first();

  if (existing) {
    const sameOwner =
      userId
        ? existing.user_id === userId
        : (
          !existing.user_id &&
          existing.requester_phone === d.requesterPhone
        );

    if (!sameOwner) {
      fail('Identificativo invio già utilizzato', 409);
    }

    return json({
      ok: true,
      idempotent: true,
      request: rowPublic(existing),
      clientToken: existing.client_token,
      availability: await computeAvailability(env)
    }, 200, cors);
  }

  const availability = await computeAvailability(env);

  if (availability.mode === 'offline') {
    fail(
      'Rider non disponibile in questo momento. Usa WhatsApp per richieste particolari.',
      409
    );
  }

  const route = await routeData(
    d.pickupLon + ',' + d.pickupLat,
    d.deliveryLon + ',' + d.deliveryLat,
    d.service
  );

  const weather = await getWeatherState(env);
  const fee = tariffFor(
    route.distanceKm,
    d.service,
    d.readyTime,
    weather.adverse
  );

  const clientToken = token();

  let code = '';
  let ok = false;

  for (let i = 0; i < 5 && !ok; i++) {
    code = makeCode();

    try {
      await env.DB.prepare(
        `INSERT INTO requests(
          code,
          client_token,
          submission_id,
          user_id,
          created_at,
          updated_at,
          status,
          requester_name,
          requester_phone,
          pickup_address,
          pickup_lat,
          pickup_lon,
          ready_time,
          recipient_name,
          recipient_phone,
          delivery_address,
          delivery_lat,
          delivery_lon,
          service,
          payment,
          order_total,
          notes,
          distance_km,
          duration_min,
          route_source,
          base_fee,
          late_fee,
          weather_fee,
          total_fee,
          micro_delivery,
          rejection_reason
        ) VALUES(
          ?,?,?,?,?,?,?,?,?,?,
          ?,?,?,?,?,?,?,?,?,?,
          ?,?,?,?,?,?,?,?,?,?,?
        )`
      ).bind(
        code,
        clientToken,
        submissionId,
        userId,
        new Date().toISOString(),
        new Date().toISOString(),
        'new',
        d.requesterName,
        d.requesterPhone,
        d.pickupAddress,
        d.pickupLat,
        d.pickupLon,
        d.readyTime,
        d.recipientName,
        d.recipientPhone,
        d.deliveryAddress,
        d.deliveryLat,
        d.deliveryLon,
        d.service,
        d.payment,
        d.orderTotal,
        d.notes,
        route.distanceKm,
        route.durationMin,
        route.source,
        fee.baseFee,
        fee.lateFee,
        fee.weatherFee,
        fee.totalFee,
        fee.microDelivery ? 1 : 0,
        ''
      ).run();

      ok = true;

    } catch (e) {
      if (
        !String(e)
          .toLowerCase()
          .includes('unique')
      ) {
        throw e;
      }
    }
  }

  if (!ok) {
    fail('Impossibile creare codice richiesta', 500);
  }

  if (auth?.profile?.role === 'client') {
    await env.DB.prepare(
      'UPDATE profiles SET display_name=?,phone=?,pickup_address=?,pickup_lat=?,pickup_lon=?,updated_at=? WHERE user_id=?'
    ).bind(
      d.requesterName,
      d.requesterPhone,
      d.pickupAddress,
      d.pickupLat,
      d.pickupLon,
      new Date().toISOString(),
      auth.user.id
    ).run();
  }

  const row = await getByCode(
    env,
    code
  );

  await safeLogEvent(env, code, 'request_created', '', 'new', 'app', {
    requesterName: d.requesterName,
    service: d.service,
    distanceKm: route.distanceKm,
    totalFee: fee.totalFee
  });
  try {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO request_sources(code,channel,external_id,created_at) VALUES(?,?,?,?)"
    ).bind(code, 'app', submissionId, new Date().toISOString()).run();
  } catch (e) {
    console.warn('request_sources unavailable', e);
  }

  const notify = async () => {
    await Promise.allSettled([
      sendTelegramNewOrder(env, row),
      sendPushToAll(env)
    ]);
  };

  if (ctx?.waitUntil) {
    ctx.waitUntil(notify());
  } else {
    notify().catch(() => {});
  }

  const etaState = await buildEtaState(env);
  return json({
    ok: true,
    request: attachEta(row, etaState.etaByCode),
    clientToken,
    availability: etaState.availability
  }, 201, cors);
}

async function getByCode(env, code) {
  return env.DB.prepare(
    'SELECT * FROM requests WHERE code=?'
  ).bind(code).first();
}

async function getGuestRequest(code, url, env, cors) {
  const t = String(
    url.searchParams.get('token') || ''
  );

  const row = await getByCode(
    env,
    code
  );

  if (!row) {
    fail('Richiesta non trovata', 404);
  }

  if (!t || t !== row.client_token) {
    fail('Token richiesta non valido', 403);
  }

  const etaState = await buildEtaState(env);
  return json({
    ok: true,
    request: attachEta(row, etaState.etaByCode, true)
  }, 200, cors);
}

async function getClientRequest(code, env, a, cors) {
  const row = await getByCode(
    env,
    code
  );

  if (!row) {
    fail('Richiesta non trovata', 404);
  }

  if (row.user_id !== a.user.id) {
    fail(
      'Questa richiesta non appartiene al tuo account',
      403
    );
  }

  const etaState = await buildEtaState(env);
  return json({
    ok: true,
    request: { ...rowOwner(row), eta: etaState.etaByCode[row.code] || null }
  }, 200, cors);
}

async function listClientRequests(url, env, a, cors) {
  const limit = Math.min(
    50,
    Math.max(
      1,
      Number(url.searchParams.get('limit')) || 10
    )
  );

  const r = await env.DB.prepare(
    'SELECT * FROM requests WHERE user_id=? ORDER BY created_at DESC LIMIT ?'
  ).bind(
    a.user.id,
    limit
  ).all();

  const etaState = await buildEtaState(env);
  return json({
    ok: true,
    requests: (r.results || []).map(row => ({
      ...rowOwner(row),
      eta: etaState.etaByCode[row.code] || null
    }))
  }, 200, cors);
}

async function listRiderRequests(url, env, cors) {
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
}

const TRANSITIONS = {
  new: new Set([
    'accepted',
    'rejected',
    'cancelled'
  ]),
  accepted: new Set([
    'picked',
    'cancelled'
  ]),
  picked: new Set([
    'arrived',
    'delivered',
    'cancelled'
  ]),
  arrived: new Set([
    'delivered',
    'cancelled'
  ]),
  delivered: new Set(),
  rejected: new Set(),
  cancelled: new Set()
};

async function updateRiderRequest(code, request, env, cors) {
  const p = await request.json().catch(() => fail('JSON non valido'));

  const status = cleanText(
    p.status,
    20
  );

  if (![
    'new',
    'accepted',
    'picked',
    'arrived',
    'delivered',
    'rejected',
    'cancelled'
  ].includes(status)) {
    fail('Stato non valido');
  }

  const reason = cleanText(
    p.rejectionReason,
    220
  );

  const row = await getByCode(
    env,
    code
  );

  if (!row) {
    fail('Richiesta non trovata', 404);
  }

  if (
    status !== row.status &&
    !TRANSITIONS[row.status]?.has(status)
  ) {
    fail(
      'Transizione non valida: ' + row.status + ' → ' + status,
      409
    );
  }

  if (status === row.status) {
    const etaState = await buildEtaState(env);
    return json({
      ok: true,
      request: attachEta(row, etaState.etaByCode),
      availability: etaState.availability
    }, 200, cors);
  }

  if (row.status === 'new' && status === 'accepted') {
    const countRow = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM requests WHERE status IN ('accepted','picked','arrived') AND code<>?"
    ).bind(code).first();
    const activeNow = Number(countRow?.n) || 0;
    if (activeNow >= MAX_ACTIVE_ORDERS) {
      fail('Limite sicurezza: massimo 2 ordini attivi contemporaneamente.', 409);
    }
  }

  await env.DB.prepare(
    'UPDATE requests SET status=?,rejection_reason=?,updated_at=? WHERE code=?'
  ).bind(
    status,
    reason || row.rejection_reason || '',
    new Date().toISOString(),
    code
  ).run();

  await safeLogEvent(env, code, 'status_changed', row.status, status, 'rider', { rejectionReason: reason || '' });
  await syncBatchStatusForCode(env, code);
  const updatedRow = await getByCode(env, code);
  const etaState = await buildEtaState(env);
  return json({
    ok: true,
    request: attachEta(updatedRow, etaState.etaByCode),
    availability: etaState.availability
  }, 200, cors);
}

function rowBase(r) {
  return {
    code: r.code,
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    requesterName: r.requester_name,
    requesterPhone: r.requester_phone,
    pickupAddress: r.pickup_address,
    pickupLat: r.pickup_lat,
    pickupLon: r.pickup_lon,
    readyTime: r.ready_time,
    recipientName: r.recipient_name,
    recipientPhone: r.recipient_phone,
    deliveryAddress: r.delivery_address,
    deliveryLat: r.delivery_lat,
    deliveryLon: r.delivery_lon,
    service: r.service,
    payment: r.payment,
    orderTotal: r.order_total,
    notes: r.notes,
    distanceKm: r.distance_km,
    durationMin: r.duration_min,
    routeSource: r.route_source,
    baseFee: r.base_fee,
    lateFee: r.late_fee,
    weatherFee: Number(r.weather_fee) || 0,
    weatherAdverse: Number(r.weather_fee) > 0,
    totalFee: r.total_fee,
    microDelivery: Number(r.micro_delivery) === 1,
    rejectionReason: r.rejection_reason || ''
  };
}

function rowPublic(r) {
  return rowBase(r);
}

function rowOwner(r) {
  return rowBase(r);
}

function rowClientSafe(r) {
  const x = rowBase(r);

  delete x.requesterPhone;
  delete x.recipientPhone;
  delete x.pickupLat;
  delete x.pickupLon;
  delete x.deliveryLat;
  delete x.deliveryLon;

  return x;
}

// ---------- Telegram ----------

function htmlEscape(s) {
  return String(s ?? '').replace(
    /[&<>]/g,
    c =>
      c === '&'
        ? '&amp;'
        : c === '<'
          ? '&lt;'
          : '&gt;'
  );
}

async function sendTelegramNewOrder(env, row) {
  if (
    !env.TELEGRAM_BOT_TOKEN ||
    !env.TELEGRAM_CHAT_ID
  ) {
    return false;
  }

  const service =
    row.micro_delivery
      ? 'MICRO E-BIKE'
      : row.service === 'moto'
        ? 'MOTO EXPRESS'
        : row.service === 'auto'
          ? 'AUTO CARGO'
          : 'ECONOMY E-BIKE';

  const text =
`⚡ <b>NUOVA SOS RIDER</b>
<b>${htmlEscape(row.code)}</b>

🏪 ${htmlEscape(row.requester_name)}
📍 ${htmlEscape(row.pickup_address)}
🏁 ${htmlEscape(row.delivery_address)}
🕐 Pronto: <b>${htmlEscape(row.ready_time)}</b>
🚚 ${service}
💶 Tariffa: <b>€ ${Number(row.total_fee).toFixed(2).replace('.', ',')}</b>
📏 ${Number(row.distance_km).toFixed(1).replace('.', ',')} km`;

  const res = await fetch(
    'https://api.telegram.org/bot' + env.TELEGRAM_BOT_TOKEN + '/sendMessage',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        chat_id: env.TELEGRAM_CHAT_ID,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      })
    }
  );

  if (!res.ok) {
    throw new Error('Telegram HTTP ' + res.status);
  }

  return true;
}
