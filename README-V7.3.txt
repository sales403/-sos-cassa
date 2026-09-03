SOS RIDER GESTIONALE V7.3

VERSIONE SEMPLIFICATA: NIENTE GOOGLE CLOUD, NIENTE API KEY, NIENTE BILLING.

Cosa cambia:
- Autocomplete sia INDIRIZZO RITIRO/LOCALE sia DESTINAZIONE CLIENTE.
- Il Worker Cloudflare serve solo per autocomplete gratuito via Photon/OpenStreetMap.
- Il calcolo tariffa usa una STIMA indicativa tra le coordinate dei due indirizzi verificati.
- Google Maps viene usato solo per MAPS/NAVIGA durante il lavoro reale.
- Preventivo: locale -> cliente.
- Operatività prima del ritiro: posizione attuale -> locale.
- Operatività dopo il ritiro: posizione attuale -> cliente.
- Nessun secret GOOGLE_MAPS_API_KEY necessario.

AGGIORNAMENTO WORKER CLOUDFLARE
1. Apri il Worker sosrider.
2. Edit code.
3. Sostituisci tutto con cloudflare-worker.js di questa cartella.
4. Deploy.
5. In SOS Rider > ALTRO lascia URL Worker:
   https://sosrider.sales-3c8.workers.dev
6. SALVA URL e TEST CONNESSIONE.

Per calcolare una tariffa seleziona SEMPRE un suggerimento autocomplete sia per il ritiro sia per la destinazione.
