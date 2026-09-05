const VERSION = 'SOS Rider API 10.0.8';

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

function tariffFor(km, service, readyTime) {
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

  return {
    distanceKm: r.distance / 1000,
    durationMin: Math.max(1, Math.round(r.duration / 60)),
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

  const fee = tariffFor(
    route.distanceKm,
    service,
    readyTime
  );

  const availability =
    env.DB
      ? await computeAvailability(env)
      : null;

  return json({
    ok: true,
    quote: {
      ...route,
      ...fee
    },
    availability
  }, 200, cors);
}

// ---------- Disponibilità ----------

async function ensurePresence(env) {
  const row = await env.DB
    .prepare('SELECT * FROM rider_presence WHERE id=1')
    .first();

  if (row) return row;

  const now = new Date().toISOString();

  await env.DB.prepare(
    'INSERT INTO rider_presence(id,enabled,eta_per_job,updated_at) VALUES(1,0,25,?)'
  ).bind(now).run();

  return env.DB
    .prepare('SELECT * FROM rider_presence WHERE id=1')
    .first();
}

async function computeAvailability(env) {
  const p = await ensurePresence(env);

  const counts = await env.DB.prepare(
    "SELECT " +
    "SUM(CASE WHEN status='new' THEN 1 ELSE 0 END) AS pending, " +
    "SUM(CASE WHEN status IN ('accepted','picked','arrived') THEN 1 ELSE 0 END) AS active " +
    "FROM requests " +
    "WHERE status IN ('new','accepted','picked','arrived')"
  ).first();

  const pending = Number(counts?.pending) || 0;
  const active = Number(counts?.active) || 0;
  const load = pending + active;

  const etaPerJob = Math.max(
    10,
    Math.min(
      60,
      Number(p.eta_per_job) || 25
    )
  );

  const enabled = Number(p.enabled) === 1;

  if (!enabled) {
    return {
      mode: 'offline',
      enabled: false,
      pending,
      active,
      etaPerJob,
      etaMin: null,
      availableEtaMin: 10,
      availableEtaMax: 15,
      updatedAt: p.updated_at
    };
  }

  if (load > 0) {
    return {
      mode: 'busy',
      enabled: true,
      pending,
      active,
      etaPerJob,
      etaMin: Math.min(
        120,
        Math.max(
          etaPerJob,
          load * etaPerJob
        )
      ),
      availableEtaMin: 10,
      availableEtaMax: 15,
      updatedAt: p.updated_at
    };
  }

  return {
    mode: 'available',
    enabled: true,
    pending,
    active,
    etaPerJob,
    etaMin: 0,
    availableEtaMin: 10,
    availableEtaMax: 15,
    updatedAt: p.updated_at
  };
}

async function updateAvailability(request, env, cors) {
  const p = await request.json().catch(() => fail('JSON non valido'));

  const enabled = !!p.enabled;

  const eta = Math.max(
    10,
    Math.min(
      60,
      Number(p.etaPerJob) || 25
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

  const fee = tariffFor(
    route.distanceKm,
    d.service,
    d.readyTime
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
          total_fee,
          micro_delivery,
          rejection_reason
        ) VALUES(
          ?,?,?,?,?,?,?,?,?,?,
          ?,?,?,?,?,?,?,?,?,?,
          ?,?,?,?,?,?,?,?,?,?
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

  return json({
    ok: true,
    request: rowPublic(row),
    clientToken,
    availability: await computeAvailability(env)
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

  return json({
    ok: true,
    request: rowClientSafe(row)
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

  return json({
    ok: true,
    request: rowOwner(row)
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

  return json({
    ok: true,
    requests: (r.results || []).map(rowOwner)
  }, 200, cors);
}

async function listRiderRequests(url, env, cors) {
  const limit = Math.min(
    200,
    Math.max(
      1,
      Number(url.searchParams.get('limit')) || 100
    )
  );

  const status = url.searchParams.get('status');

  let r;

  if (status) {
    r = await env.DB.prepare(
      'SELECT * FROM requests WHERE status=? ORDER BY created_at DESC LIMIT ?'
    ).bind(
      status,
      limit
    ).all();

  } else {
    r = await env.DB.prepare(
      "SELECT * FROM requests WHERE created_at >= datetime('now','-30 day') ORDER BY created_at DESC LIMIT ?"
    ).bind(limit).all();
  }

  return json({
    ok: true,
    requests: (r.results || []).map(rowPublic)
  }, 200, cors);
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
    return json({
      ok: true,
      request: rowPublic(row),
      availability: await computeAvailability(env)
    }, 200, cors);
  }

  await env.DB.prepare(
    'UPDATE requests SET status=?,rejection_reason=?,updated_at=? WHERE code=?'
  ).bind(
    status,
    reason || row.rejection_reason || '',
    new Date().toISOString(),
    code
  ).run();

  return json({
    ok: true,
    request: rowPublic(
      await getByCode(env, code)
    ),
    availability: await computeAvailability(env)
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
