import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const worker = readFileSync(new URL('../worker-v11.0.0-dispatch.js', import.meta.url), 'utf8');
const client = readFileSync(new URL('../app.js', import.meta.url), 'utf8');

function section(source, from, to) {
  const start = source.indexOf(from), end = source.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `Sezione mancante: ${from}`);
  return source.slice(start, end);
}

const validatePayload = runInNewContext(
  section(worker, 'function validatePayload(', '/* WhatsApp manual import') + '\nvalidatePayload',
  {
    cleanText: (value, len) => String(value ?? '').trim().slice(0, len),
    cleanPhone: value => String(value ?? '').replace(/\D/g, ''),
    validCoord: (lat, lon) => Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180,
    fail: message => { throw Error(message); }
  }
);

const base = {
  requesterName: '', requesterPhone: '', pickupAddress: 'Via Ritiro 1', pickupLat: 44.77, pickupLon: 10.88,
  readyTime: '19:30', recipientName: '', recipientPhone: '', deliveryAddress: 'Via Consegna 5',
  deliveryLat: 44.78, deliveryLon: 10.89, service: 'ebike', payment: 'cash', orderTotal: 0
};

test('WhatsApp: preventivo con nomi, telefoni e importo ordine mancanti', () => {
  const result = validatePayload(base, { requireContacts: false, requireCashAmount: false });
  assert.equal(result.readyTime, '19:30');
  assert.equal(result.orderTotal, 0);
});

test('La conferma di una consegna in contanti richiede ancora l’importo', () => {
  assert.throws(() => validatePayload(base, { requireContacts: false, requireCashAmount: true }), /Importo ordine/);
});

test('Il flusso cliente ordinario conserva la verifica contatti', () => {
  assert.throws(() => validatePayload(base), /Dati richiedente/);
});

test('Indirizzi, orario e veicolo restano obbligatori per il preventivo', () => {
  const opts = { requireContacts: false, requireCashAmount: false };
  assert.throws(() => validatePayload({ ...base, pickupAddress: '' }, opts), /Indirizzo ritiro/);
  assert.throws(() => validatePayload({ ...base, readyTime: '' }, opts), /Orario pronto/);
  assert.throws(() => validatePayload({ ...base, service: 'aereo' }, opts), /Servizio non valido/);
});

test('Preventivo multiplo: contatti e importi non obbligatori, conferma ancora protetta', () => {
  const script = section(worker, 'function validateBatchBase(', 'async function calculateBatchData(');
  const funcs = runInNewContext(script + '\n({validateBatchBase,validateBatchStop})', {
    cleanText: (value, len) => String(value ?? '').trim().slice(0, len),
    cleanPhone: value => String(value ?? '').replace(/\D/g, ''),
    validCoord: (lat, lon) => Number.isFinite(lat) && Number.isFinite(lon),
    fail: message => { throw Error(message); }
  });
  const batchBase = { requesterName: '', requesterPhone: '', pickupAddress: 'Via Ritiro 1', pickupLat: 44.77, pickupLon: 10.88, readyTime: '19:30', service: 'ebike' };
  const batchStop = { recipientName: '', recipientPhone: '', deliveryAddress: 'Via Consegna 5', deliveryLat: 44.78, deliveryLon: 10.89, payment: 'cash', orderTotal: 0 };
  assert.equal(funcs.validateBatchBase(batchBase, { requireContacts: false }).service, 'ebike');
  assert.equal(funcs.validateBatchStop(batchStop, 0, { requireContacts: false, requireCashAmount: false }).orderTotal, 0);
  assert.throws(() => funcs.validateBatchBase(batchBase), /Dati richiedente/);
  assert.throws(() => funcs.validateBatchStop(batchStop, 0), /Dati destinatario/);
});

test('Il tracking espone solo status e timestamp, mai dati interni', async () => {
  const script = section(worker, 'async function publicRequestTimeline(', 'function minutesUntilReadyLocal');
  const resultRows = [
    { event_type: 'request_created', status_to: 'new', created_at: '2026-11-02T18:00:00Z', payload_json: '{"secret":"hidden"}' },
    { event_type: 'status_changed', status_to: 'accepted', created_at: '2026-11-02T18:01:00Z', payload_json: '{"secret":"hidden"}' },
    { event_type: 'gps_update', status_to: 'accepted', created_at: '2026-11-02T18:02:00Z' }
  ];
  let boundCode = null;
  const env = { DB: { prepare: () => ({ bind(code) { boundCode = code; return this; }, async all() { return { results: resultRows }; } }) } };
  const api = runInNewContext(script + '\npublicRequestTimeline', { ensureRequestEventsSchema: async () => {}, console });
  const events = JSON.parse(JSON.stringify(await api(env, 'SOS-TEST')));
  assert.equal(boundCode, 'SOS-TEST');
  assert.deepEqual(events, [
    { eventType: 'request_created', status: 'new', createdAt: '2026-11-02T18:00:00Z' },
    { eventType: 'status_changed', status: 'accepted', createdAt: '2026-11-02T18:01:00Z' }
  ]);
});

test('La timeline del locale rende gli eventi storici con orari reali', () => {
  const box = { innerHTML: '' };
  const script = section(client, 'const CLIENT_TIMELINE_LABELS=', 'function renderClientEta(');
  const context = { $: id => id === 'clientTimeline' ? box : null, esc: value => String(value).replaceAll('<', '&lt;') };
  const draw = runInNewContext(script + '\nrenderClientTimeline', context);
  draw([
    { status: 'new', createdAt: '2026-11-02T18:00:00Z' },
    { status: 'accepted', createdAt: '2026-11-02T18:04:00Z' },
    { status: 'picked', createdAt: '2026-11-02T18:15:00Z' }
  ]);
  assert.match(box.innerHTML, /Richiesta inviata/);
  assert.match(box.innerHTML, /Rider ha accettato/);
  assert.match(box.innerHTML, /Ordine ritirato/);
  assert.equal((box.innerHTML.match(/client-timeline-item/g) || []).length, 3);
});
