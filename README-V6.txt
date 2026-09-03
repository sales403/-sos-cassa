SOS RIDER GESTIONALE V6

NOVITA' PRINCIPALI
- 4 sezioni: LAVORO / STORICO / ANALYTICS / ALTRO
- Gli ordini non vengono più cancellati quando chiudi un turno.
- CHIUDI TURNO archivia il turno e mantiene tutto nello storico.
- Non puoi chiudere il turno se ci sono consegne attive o cassa ancora aperta.
- Storico filtrabile: consegnate / problemi / annullate.
- Durata ordine = da RITIRATO a CONSEGNATO.
- Guadagno SOS separato dal valore dell'ordine del ristorante.
- CSV generato al momento: contiene sempre gli ultimi ordini salvati.
- Analytics: oggi, ieri, 7 giorni, 30 giorni, tutto.
- Metriche: guadagno SOS, ordini, tempo operativo, €/h, media per ordine,
  tempo medio, valore ordini, contanti movimentati, andamento giornaliero,
  fasce orarie e locali migliori.
- Popup SISTEMA INCASSO rifatto con schermata chiara.
- Backup JSON completo.
- Migrazione automatica dei dati V5 presenti sullo stesso browser.

AUTOCOMPLETE INDIRIZZI
Il file cloudflare-worker.js risolve il problema CORS di Photon.
Dopo aver creato il Worker Cloudflare:
1. copia l'URL https://....workers.dev
2. nell'app vai ALTRO > Autocomplete indirizzi
3. incolla l'URL e premi SALVA URL

AGGIORNAMENTO GITHUB PAGES
Nel repository GitHub sostituisci/carica:
- index.html
- manifest.webmanifest
- sw.js
- icon-192.png
- icon-512.png
Puoi lasciare anche:
- logo-sos-rider.png
- cloudflare-worker.js
- README-V6.txt

Dopo il commit attendi il nuovo deploy GitHub Pages.
Su iPhone chiudi e riapri SOS Rider dalla Home; se mostra ancora la vecchia versione,
apri il sito in Safari e aggiorna una volta.

NOTA DATI
Storico e analytics sono salvati localmente sul dispositivo tramite localStorage.
Per avere gli stessi dati sincronizzati tra iPhone e PC servirà in futuro un database cloud.
