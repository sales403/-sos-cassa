# SOS Rider V11 - ambiente test indipendente

Frontend aggiornato: https://sos-rider-v11-full-staging.sales-3c8.workers.dev/

- GitHub: branch `v11-dispatch-engine`, cartella `preview-v11/`.
- Backend: `sos-rider-v11-staging` (Cloudflare), endpoint pubblico già nel `config.js` della PWA.
- Per futuri deploy frontend usare **esclusivamente** `wrangler.staging.jsonc`, non `wrangler.jsonc` (quest'ultimo punta a `sos-cassa`).
- Comando: `npx wrangler deploy --config wrangler.staging.jsonc`.
- Non trasferire segreti in GitHub; non fare deploy del dominio pubblico senza autorizzazione.
- Verificare con due dispositivi: richiesta, push Rider, push locale, arrivo, cassa, consegnato.
- Le notifiche su iPhone richiedono PWA aggiunta alla Home e consenso dell'utente.

Nota: la prima pubblicazione indipendente è stata eseguita tramite modulo Worker con le risorse statiche incluse; il config di Wrangler consente successivamente un deploy static assets ripetibile. Verificare sempre le immagini delle banconote incluse in `preview-v11/cash-notes`.
