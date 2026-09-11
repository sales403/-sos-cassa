# SOS Rider V11 Dispatch — Test prima del lancio

Questa branch NON va pubblicata finché tutti i test critici non sono verdi.

## A. Sicurezza regressioni
- [ ] La V10 live continua a funzionare su main senza alcuna modifica.
- [ ] Login Rider valido.
- [ ] Login Cliente valido.
- [ ] Richiesta ospite valida.
- [ ] Preventivo e tariffa invariati.
- [ ] Cassa, fondo resto, storico e analytics invariati.
- [ ] Push/Telegram già esistenti ancora funzionanti.

## B. GPS Rider
- [ ] Rider OFF: nessun tracking richiesto/attivo.
- [ ] Rider DISPONIBILE: viene richiesto il permesso GPS.
- [ ] GPS consentito: stato verde con età posizione e accuratezza.
- [ ] GPS negato: l'app non si blocca; mostra avviso e mantiene ETA manuale.
- [ ] GPS vecchio >90 s: il backend lo considera non-live.
- [ ] AGGIORNA GPS forza una nuova posizione.
- [ ] Un cambio stato ordine invia uno snapshot GPS senza bloccare il pulsante.
- [ ] Il pubblico non riceve latitudine/longitudine del Rider.

## C. Coda e decisioni
- [ ] 0 ordini attivi + GPS live: nuova richiesta mostra 🟢/🟡/🔴 e ETA ritiro.
- [ ] 0 ordini attivi + GPS non live: decisione almeno 🟡 VALUTA.
- [ ] 1 ordine ACCEPTED: nuova richiesta viene valutata dopo l'ordine già in coda.
- [ ] 1 ordine PICKED: il food già ritirato mantiene priorità; il nuovo ordine è solo dopo la consegna.
- [ ] 2 ordini attivi: terzo ordine mostra 🔴 NON ACCETTARE.
- [ ] Il backend rifiuta comunque l'accettazione del terzo ordine con HTTP 409.
- [ ] Un ordine rosso richiede conferma esplicita prima del tentativo di accettazione.
- [ ] Stato ACCEPTED aggiorna ETA cliente.
- [ ] Stato PICKED aggiorna ETA cliente.
- [ ] Stato ARRIVED/DELIVERED continua a funzionare.

## D. Errori reali da simulare
- [ ] Internet assente mentre arriva una richiesta.
- [ ] Internet cade durante ACCETTA.
- [ ] Doppio tap su ACCETTA.
- [ ] Locale invia due volte la stessa richiesta.
- [ ] GPS sparisce durante la consegna.
- [ ] App mandata in background/bloccata su iPhone.
- [ ] Due richieste arrivano quasi contemporaneamente.
- [ ] Un ordine viene annullato mentre un altro è in coda.
- [ ] Ritardo al ritiro.
- [ ] Pagamento contanti con resto.
- [ ] Ordine già pagato.
- [ ] POS.
- [ ] Cliente/locale inserisce note lunghe o caratteri strani.

## E. Audit
- [ ] request_events registra request_created.
- [ ] request_events registra ogni cambio stato.
- [ ] request_sources registra channel=app.
- [ ] Ogni richiesta mantiene un solo stato server-side.
- [ ] Nessun errore console JavaScript critico.

## Regola di go-live
Pubblicare solo dopo:
1. test su almeno 2 dispositivi reali;
2. almeno 20 richieste simulate;
3. zero errori critici;
4. rollback verificato verso V10.
