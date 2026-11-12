# SOS Rider — Deploy HUB V11 nello staging frontend

## Verifica prima di distribuire
- Target: `v11-dispatch-engine-sos-cassa.sales-3c8.workers.dev` (frontend/app di test)
- NON usare `sos-rider-v11-staging`: è il Worker backend API/D1.
- Branch: `v11-dispatch-engine`.
- Asset statici: `site/preview-v11/`.
- HUB: `site/preview-v11/go/index.html` + `hub-sos-rider-visual.jpg`.
- Immagine originale 864x1536 e tre hotspot cliccabili, come approvato.

## Dal PC Windows con Node.js e Git
Apri PowerShell:

```powershell
git clone --branch v11-dispatch-engine --single-branch https://github.com/sales403/-sos-cassa.git sos-rider-v11
cd sos-rider-v11
npx wrangler login
npx wrangler deploy --config site/wrangler.frontend-staging.jsonc
```

Se il repository è già presente localmente, usa `git fetch` e aggiorna il branch anziché riclonarlo. Non usare `--config wrangler.jsonc` senza verificare il nome Worker, perché il vecchio config ha un altro nome.

## Controlli
1. Apri https://v11-dispatch-engine-sos-cassa.sales-3c8.workers.dev/go/?hub-rev=20261112 e ricarica senza cache se necessario.
2. Verifica che appaia il poster approvato, non il vecchio hub.
3. Prova WhatsApp, app cliente, sito informazioni, link telefono.
4. Verifica che `/go/hub-sos-rider-visual.jpg` sia servito correttamente.
5. Non cambiare il backend D1, i segreti o il sito pubblico.

## Ripristino
In Cloudflare > Workers & Pages > `v11-dispatch-engine-sos-cassa` > Deployments / Version History, ripristina la versione precedente se il frontend dà problemi.

Nota: la presenza dei file su GitHub NON equivale al deploy. Il workflow GitHub Actions presente in repository non pubblica il frontend. In futuro si può collegare Cloudflare Builds al branch corretto, con worker name e root directory coerenti.
