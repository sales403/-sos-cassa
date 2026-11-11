import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {runInNewContext} from 'node:vm';

const root = new URL('../', import.meta.url);
const source = name => readFileSync(new URL(name, root), 'utf8');
const worker = source('worker-v11.0.0-dispatch.js');

const first = worker.indexOf('function isLate(');
const last = worker.indexOf('async function ensureWeatherSchema(', first);
assert.ok(first !== -1 && last > first);
const tariff = runInNewContext(
  worker.slice(first, last) + '\ntariffFor',
  {
    WEATHER_FEE_EUR: 3,
    fail: (message, status) => {const error = new Error(message); error.status = status; throw error;}
  }
);

const prices = {
  ebike: [6.5, 8.5, 12.5],
  moto: [9.5, 12.5, 16.5],
  auto: [12.5, 15.5, 20.5]
};

test('Le 3 fasce ufficiali coincidono per ogni veicolo sulle soglie esatte', () => {
  for (const [vehicle, [first, second, third]] of Object.entries(prices)) {
    for (const [km, expected] of [[0, first], [0.2, first], [3, first], [3.001, second], [5, second], [5.001, third], [8, third]]) {
      const fee = tariff(km, vehicle, '19:00');
      assert.equal(fee.totalFee, expected, `${vehicle} @ ${km} km`);
      assert.equal(fee.baseFee, expected);
      assert.equal(fee.microDelivery, false);
      assert.equal(fee.lateFee, 0);
      assert.equal(fee.weatherFee, 0);
    }
  }
});

test('Soltanto meteo (+3 €) e fascia serale (+2 €) possono aumentare la tariffa', () => {
  const base = tariff(4, 'moto', '22:29');
  assert.equal(base.totalFee, 12.5);
  const late = tariff(4, 'moto', '22:30');
  assert.equal(late.totalFee, 14.5);
  const weather = tariff(4, 'moto', '22:29', true);
  assert.equal(weather.totalFee, 15.5);
  const both = tariff(4, 'moto', '22:30', true);
  assert.equal(both.totalFee, 17.5);
});

test('Oltre 8 km occorre preventivo dedicato e non un prezzo automatico', () => {
  assert.throws(() => tariff(8.01, 'ebike', '20:00'), /oltre 8 km/i);
  assert.throws(() => tariff(8.01, 'moto', '20:00'), /oltre 8 km/i);
  assert.throws(() => tariff(8.01, 'auto', '20:00'), /oltre 8 km/i);
});

test('Tutti i frontend correnti mostrano i minimi aggiornati e nessuna micro tariffa', () => {
  for (const name of ['index.html', 'preview-v11/index.html', 'site/preview-v11/index.html']) {
    const html = source(name);
    for (const value of ['da €6,50', 'da €9,50', 'da €12,50']) assert.ok(html.includes(value), `${name}: ${value}`);
    assert.doesNotMatch(html, /Microconsegna E-bike entro 1 km/);
    assert.doesNotMatch(html, /Seconda fermata \/ gestione giro/);
  }
});

test('Il sito offre le 3 fasce, i soli 2 supplementi e la nota partner', () => {
  const html = source('site/index.html');
  for (const value of ['€ 6,50', '€ 8,50', '€ 12,50', '€ 9,50', '€ 16,50', '€ 15,50', '€ 20,50']) {
    assert.ok(html.includes(value), `Manca ${value}`);
  }
  assert.equal((html.match(/<div class="premium-band-list">/g) || []).length, 3);
  assert.equal((html.match(/<span>Fino a 3 km<\/span>/g) || []).length, 3);
  assert.equal((html.match(/<span>Oltre 3 fino a 5 km<\/span>/g) || []).length, 3);
  assert.equal((html.match(/<span>Oltre 5 fino a 8 km<\/span>/g) || []).length, 3);
  assert.equal((html.match(/class="premium-night-fee reveal"/g) || []).length, 2);
  assert.match(html, /tariffe dedicate più vantaggiose/i);
  assert.match(html, /Per tratte oltre 8 km o richieste particolari/);
});

test('La variante client non applica tariffe locali incompatibili', () => {
  for (const name of ['app.js', 'preview-v11/app.js', 'site/preview-v11/app.js']) {
    const js = source(name);
    const start = js.indexOf('function tariffFor(');
    const end = js.indexOf('async function ', start);
    const snippet = js.slice(start, end);
    assert.ok(snippet.includes('6.50,8.50,12.50'), name);
    assert.ok(snippet.includes('12.50,15.50,20.50'), name);
    assert.doesNotMatch(snippet, /micro\?2\.50|\[1,2\.50\]/);
  }
});

test('Il client blocca preventivi di un Worker non ancora aggiornato', () => {
  for(const path of ['app.js','preview-v11/app.js']){
    const js=source(path);
    assert.match(js,/Math\.abs\(Number\(q\.baseFee\)-expected\.base\)/);
    assert.match(js,/Number\(q\.extraStopFee\)!==0/);
    assert.match(js,/Tariffario in aggiornamento sul server/);
  }
});

test('Preventivi batch senza extra fermata: si sommano due tariffe base e gli extra una volta', async () => {
  const start = worker.indexOf('async function calculateBatchData(');
  const end = worker.indexOf('function batchQuotePublic(', start);
  const ctx = {
    validateBatchBase: p => p,
    validateBatchStop: (x, i) => ({...x, originalIndex: i}),
    routeData: async (from, to) => {
      const a = Number(from.split(',')[0]), b = Number(to.split(',')[0]);
      const km = Math.abs(a - b);
      return {distanceKm: km, durationMin: km * 2};
    },
    getWeatherState: async () => ({adverse: true}),
    tariffFor: tariff,
    WEATHER_FEE_EUR: 3,
    MAX_ACTIVE_ORDERS: 3,
    ETA_MODEL: {pickupBufferMin: 2, dropoffBufferMin: 2},
    roundHalf: n => Math.round(n * 2) / 2,
    buildPickupAvailabilityPreview: async () => ({enabled: true, active: 0, pickupEtaMin: 4}),
    travelMinutes: km => km * 3,
    etaWindow: n => ({min: n - 1, max: n + 1}),
    fail: msg => { throw Error(msg); }
  };
  const calc = runInNewContext(worker.slice(start, end) + '\ncalculateBatchData', ctx);
  const result = await calc({}, {
    pickupLon: 10, pickupLat: 44.78, readyTime: '22:30', service: 'ebike',
    deliveries: [{deliveryLon: 12, deliveryLat: 44.78}, {deliveryLon: 14, deliveryLat: 44.78}]
  });
  // 2 km e 2 km: 6,50 € + 6,50 €; serale 2 €; meteo 3 €.
  assert.equal(result.totalDistanceKm, 4);
  assert.equal(result.baseFee, 13);
  assert.equal(result.extraStopFee, 0);
  assert.equal(result.lateFee, 2);
  assert.equal(result.weatherFee, 3);
  assert.equal(result.totalFee, 18);
  assert.equal(result.sharesByOriginal[0] + result.sharesByOriginal[1], 18);
});
