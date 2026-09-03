SOS RIDER GESTIONALE V7.2

CORREZIONI
- Autocomplete su indirizzo ritiro E consegna.
- Campi scuri anche con autofill Chrome/Safari.
- PREVENTIVO: percorso fisso LOCALE -> CLIENTE.
- OPERATIVITÀ: prima del ritiro MAPS usa POSIZIONE ATTUALE -> LOCALE; dopo RITIRATO usa POSIZIONE ATTUALE -> CLIENTE.
- E-Bike usa BICYCLE. Moto Express usa percorso stradale DRIVE in Italia, perché Google TWO_WHEELER non è supportato in Italia.
- Pulsante PERCORSO nel preventivo.
- TEST CONNESSIONE in ALTRO con controllo secret Google.

GOOGLE_MAPS_API_KEY
Non è un codice universale: è la TUA API key Google Cloud.
Abilita Routes API, crea una API key e in Cloudflare Worker aggiungi un Secret:
Nome: GOOGLE_MAPS_API_KEY
Valore: la tua chiave Google (di solito inizia con AIza...)

Poi sostituisci il Worker con cloudflare-worker.js e fai Deploy.
In SOS Rider -> ALTRO -> TEST CONNESSIONE deve apparire Google Routes: CONFIGURATO.

Worker: https://sosrider.sales-3c8.workers.dev
