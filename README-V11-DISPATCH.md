# SOS Rider V11 — Dispatch Core

Branch di lavoro: `v11-dispatch-engine`

## Obiettivo
Potenziare la V10 senza rifare l'app:
- GPS Rider quando online;
- ETA primo ritiro dalla posizione live quando disponibile;
- fallback automatico all'ETA manuale se il GPS non è fresco;
- decisione 🟢 ACCETTABILE / 🟡 VALUTA / 🔴 NON CONSIGLIATO;
- limite iniziale hard di 2 ordini attivi;
- audit eventi;
- base dati pronta per far entrare in futuro WhatsApp nello stesso flusso ordini.

## File nuovi
- `worker-v11.0.0-dispatch.js`
- `migration-v10-to-v11-dispatch.sql`
- `TEST-CHECKLIST-V11-DISPATCH.md`

## File frontend aggiornati nella branch
- `app.js`
- `index.html`
- `styles.css`
- `sw.js`

## Database V11
La migration crea soltanto nuove tabelle ed è idempotente:
- `rider_location`
- `request_events`
- `request_sources`

Non modifica né cancella le tabelle V10 esistenti.

## Deploy sicuro
1. Backup D1.
2. Eseguire `migration-v10-to-v11-dispatch.sql` sul database remoto.
3. Pubblicare `worker-v11.0.0-dispatch.js` sul Worker di test o su una copia del Worker.
4. Puntare temporaneamente la branch frontend al Worker di test.
5. Eseguire tutta la checklist.
6. Solo dopo promuovere Worker + frontend in produzione.

## Rollback
Il frontend live su `main` resta V10 finché la branch non viene unita.
Se il Worker V11 dà problemi, ripubblicare il Worker V10.3.0 precedente: le nuove tabelle V11 possono restare nel D1 perché non alterano quelle V10.

## WhatsApp
La tabella `request_sources` prepara il modello unico:
- app -> stesso record `requests`
- WhatsApp -> stesso record `requests`

L'integrazione webhook/Cloud API va aggiunta dopo che Dispatch + GPS sono stabili, così non testiamo contemporaneamente due fonti di errore.
