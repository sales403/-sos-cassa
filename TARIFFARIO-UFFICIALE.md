# SOS Rider · tariffario ufficiale approvato

**Decisione di Marcello: 18 novembre 2026.** Il listino riportato nella vetrina `site/index.html` è la fonte ufficiale per le tariffe standard SOS Rider, anche quando diverge dalle ipotesi di pianificazione del business plan del 3 novembre 2026.

| Distanza stradale tra ritiro e consegna | Economy E-bike | Express Moto | Cargo Auto |
| --- | ---: | ---: | ---: |
| Fino a 1 km incluso | € 4,50 | € 7,50 | € 10,50 |
| Oltre 1 km fino a 3 km inclusi | € 6,50 | € 9,50 | € 12,50 |
| Oltre 3 km fino a 5 km inclusi | € 8,50 | € 12,50 | € 15,50 |
| Oltre 5 km fino a 8 km inclusi | € 12,50 | € 16,50 | € 20,50 |

- **Oltre 8 km:** preventivo personalizzato, non tariffa automatica.
- **Dalle 22:30:** supplemento serale automatico di € 2 secondo l'orario dell'ordine pronto.
- **Meteo avverso:** € 3 quando realmente attivato dall'app/Worker; non applicare retroattivamente a un prezzo già confermato.
- **Partner B2B:** eventuali offerte negoziate con il locale restano distinte dalle tariffe standard; non si applicano automaticamente nella PWA pubblica.
- Le tariffe della tabella sono *prezzi di partenza per distanza*, prima degli eventuali supplementi effettivamente applicabili. Non confondere il valore dell'ordine trasportato con il costo della consegna.

## Coerenza software

La V11 staging usa `worker-v11.0.0-dispatch.js` come sorgente del backend e `site/preview-v11/` come frontend di test Cloudflare. Le copie `app.js`, `preview-v11/app.js` e il Worker storico `worker.js` nella branch di sviluppo devono essere coerenti con queste quattro fasce.

La UI cliente confronta il preventivo restituito dal server con le quattro fasce e controlla che il backend segnali la versione di pricing corretta. Se lo staging backend non è aggiornato, **bloccare il preventivo** e offrire il contatto WhatsApp anziché accettare un prezzo incoerente. Non modificare i totali degli ordini già confermati.

**Deploy:** la modifica del codice sul branch `v11-dispatch-engine` non garantisce che Cloudflare abbia distribuito il frontend o il backend. Non aggiornare produzione, D1 o secrets senza approvazione esplicita.
