# SOS Rider V11 – Tracking WhatsApp e disponibilità per locale

**Stato: modifiche locali non pubblicate.** Nessuna migrazione/deploy, nessun messaggio inviato.

Dopo il caricamento corretto del Worker, `/api/status` deve indicare `SOS Rider API 11.3.9-partner-tracking-staging` e `capabilities.partnerPages: true`.

## 1. Tracking di un ordine WhatsApp

1. Area Rider > Richieste > `INCOLLA MESSAGGIO`.
2. Completa/controlla gli indirizzi e prepara il preventivo; conferma l'ordine solo dopo l'accordo col locale.
3. La risposta del backend include il token privato `client_token` già salvato in `requests`: l'app forma automaticamente il link `track.html#code=CODICE&key=TOKEN`.
4. Usa `COPIA LINK TRACKING` o `CONDIVIDI`. Dopo aver chiuso il preventivo, `RECUPERA LINK TRACKING` permette di reinserire il codice ordine e riottenere lo stesso link (nuova API **protetta Rider** `GET /api/rider/requests/:code/share`).
5. Il destinatario del link non deve installare la PWA né accedere. La pagina consulta le API già esistenti `GET /api/requests/:code?token=...` e `GET /api/track/:code?token=...`, aggiornando ETA/stati e, se autorizzato e fresco, GPS. Il token non entra nella query URL della pagina statica: rimane nel frammento `#`.

**Limite attuale:** il messaggio ricevuto in WhatsApp Business va ancora importato/registrato da Marcello e il link va condiviso con un tocco. Non è stata collegata la WhatsApp Business Platform/API: quindi **non** c'è lettura o invio automatico di chat WhatsApp.

## 2. Pagina di disponibilità permanente del locale

1. Area Rider > Richieste > `GESTISCI LINK PARTNER`.
2. Inserisci il nome attività, scegli l'indirizzo dai suggerimenti geocodificati, controlla il civico, premi `CREA LINK PARTNER`.
3. Il backend crea il record D1 `partner_pages` con token casuale e restituisce il link `partner.html#key=TOKEN`.
4. Il locale salva il suo link. La pagina aggiorna ogni 15 secondi la disponibilità e l'ETA **specifico per quel punto di ritiro**, selezionando E-bike/Moto/Auto, e offre un pulsante che apre WhatsApp con richiesta precompilata.
5. L'API pubblica `GET /api/partner/:token?service=ebike` usa `buildPickupAvailabilityPreview()` del motore V11, che considera posizione rider (se GPS fresco), coda *accettata*, destinazioni degli ordini già in corso e trasferimento verso il locale. Se gli slot sono pieni mostra una stima prudente **di fine coda, non un'accettazione**.
6. `REVOCA` elimina il token D1 e disattiva quel link.

**Limiti attuali:** ETA stimati, non garantiti; se GPS non è fresco si applica fallback. Richieste non ancora accettate non prenotano uno slot. I due link sono associati all'host statico dove sarà pubblicata la versione: **il dominio personalizzato/QR permanente non è ancora pronto**.

## Collaudo prima di qualsiasi deploy

- [ ] Verificare su ambiente di staging con D1 reale la creazione, il recupero e la revoca dei link.
- [ ] Confermare che endpoint non autenticati non restituiscano token di altri ordini o coordinate rider fuori da ordine autorizzato.
- [ ] Testare 0, 1, 2 e 3 consegne attive, ordine multiplo, arrivo, consegna, cancellazione e ritorno alla disponibilità.
- [ ] Provare OwnTracks con iPhone bloccato, GPS recente/stale e rete interrotta.
- [ ] Aprire su entrambi gli iPhone i link da WhatsApp e controllare aggiornamenti, scelta mezzo e condivisione.
- [ ] Approvarne il deploy in staging; **nessuna pubblicazione in produzione senza OK**.

Test locali: `node --test tests/*.test.mjs`, `node --check app.js`, `node --check worker-v11.0.0-dispatch.js`.
