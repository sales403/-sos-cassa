SOS RIDER GESTIONALE V7.1

NOVITÀ V7.1: splash animata integrata + badge versione visibile.

SOS RIDER GESTIONALE V7 — CARPI-SOLIERA

NOVITA PRINCIPALI
- Calcolo tariffa automatico in base a km + mezzo.
- Google Routes: BICYCLE / TWO_WHEELER / DRIVE.
- Supplemento +2 € automatico dopo le 22:30.
- Tariffa arrotondata ai 0,50 €.
- E-Bike: 0-2 km 4,50 €; 2-4 km +0,75/km; oltre 4 km +1/km.
- Moto: 0-2 km 7 €; 2-4 km +0,50/km; oltre 4 km +1/km.
- Auto: 0-2 km 6,50 €; 2-4 km +0,75/km; oltre 4 km +1,25/km.
- Selettori mezzo visuali.
- Immagine preventivo PNG, copia testo e apertura WhatsApp.
- Autosalvataggio bozza nuovo ordine.
- Tasto refresh sicuro.
- Cassa rapida cumulativa: +5, +10, +20, +50, +100, PRECISO, ULTIMA, AZZERA.
- Memorizza l'indirizzo di ritiro per ciascun locale già usato.

CLOUDFLARE WORKER
1. Sostituire il codice del Worker con cloudflare-worker.js.
2. In Cloudflare Worker > Settings/Variables and Secrets creare un SECRET chiamato:
   GOOGLE_MAPS_API_KEY
3. Come valore usare una Google Maps Platform API key con Routes API abilitata.
4. Deploy del Worker.
5. In SOS Rider > ALTRO lasciare/salvare l'URL base del Worker, es.:
   https://sosrider.sales-3c8.workers.dev

TEST
- Autocomplete:
  https://sosrider.sales-3c8.workers.dev/api/address?q=Via%20Roosevelt%20Carpi
- Route: viene chiamata via POST direttamente dal gestionale.

PUBBLICAZIONE GITHUB PAGES
Caricare nella root del repository TUTTI i file di questa cartella, sostituendo quelli esistenti.
Il link pubblico resta lo stesso.

NOTA GOOGLE
Le modalità BICYCLE e TWO_WHEELER di Google Routes sono beta e vanno verificate prima della partenza; la V7 mostra un avviso nel gestionale.
