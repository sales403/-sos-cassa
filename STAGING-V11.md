# SOS Rider V11 — Staging operativo

Stato: backend V11 staging online e separato dalla produzione.

## Endpoint
- Worker staging: https://sos-rider-v11-staging.sales-3c8.workers.dev
- Health check: https://sos-rider-v11-staging.sales-3c8.workers.dev/api/status

## Frontend branch
Branch: `v11-dispatch-engine`

Il `config.js` di questa branch punta SOLO al Worker staging:
`https://sos-rider-v11-staging.sales-3c8.workers.dev`

La branch mostra una barra rossa:
`V11 STAGING · TEST · NON PRODUZIONE`

La PWA staging ha identità separata:
- nome: `SOS Rider V11 STAGING`
- short name: `SOS V11 Test`

Le Web Push sono disattivate nello staging frontend finché non viene configurato il VAPID staging.

## Backend staging verificato
`/api/status` deve restituire:
- version: `SOS Rider API 11.0.0-dispatch`
- requests: true
- auth: true
- availability: true
- eta: true
- riderLocation: true
- dispatchDecision: true
- maxConcurrentOrders: 2
- telegram: false
- push: false

## Database staging
D1 dedicato: `sos-rider-v11-staging`

Tabelle:
- profiles
- rider_presence
- requests
- push_subscriptions
- rider_location
- request_events
- request_sources

## Produzione
NON modificare:
- Worker live: `https://sosrider.sales-3c8.workers.dev`
- D1 live: `sos-rider`
- branch: `main`

## Prossimo test
1. Aprire frontend preview della branch.
2. Accedere come Rider.
3. Mettersi DISPONIBILE.
4. Consentire GPS.
5. Verificare che il GPS diventi fresco.
6. Inviare prima richiesta test.
7. Inviare seconda richiesta mentre la prima è attiva.
8. Verificare decisione verde/gialla/rossa.
9. Tentare terzo ordine attivo e verificare blocco server.
10. Controllare `request_events`.
