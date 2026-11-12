# SOS Rider V11.5 — Revisione account locale e richiesta rapida

Ambiente: **solo staging**. Branch `v11-dispatch-engine`. Asset frontend modificati in `site/preview-v11/`. Non modifica il Worker API `sos-rider-v11-staging`, D1, segreti o il branch `main`.

## Modifiche
- `CONTINUA SENZA ACCOUNT` chiude la sessione locale Supabase esistente prima di entrare come ospite. Dati salvati (bozza, storico e token ordine) sono separati per account ID o ospite.
- Profilo locale compatto: nome più visibile, Esci sulla stessa riga, pulsante Passkey beta nascosto.
- Distanza maggiore tra riquadro disponibilità Rider e riquadro account. Stato disponibilità sempre alimentato dall'API pubblica esistente.
- Rimosse le spiegazioni iniziali e la nota commerciale blu. WhatsApp solo in fondo come assistenza o fallback invio se il server fallisce.
- Modulo principale in tre step: Dati, Tariffa, Invio. Dati ritiro precompilati e richiudibili solo quando completi; destinazione in evidenza.
- Pulsante principale ancorato sopra la barra di navigazione per calcolare la tariffa e, dopo il preventivo, inviare con conferma esplicita.
- Navigazione cliente come Rider: Nuova, Richieste, Storico, Analisi. «Ultime richieste» non compare più nella schermata ordine. Storico e importi: massimo le 8 richieste recenti disponibili, non un rendiconto completo.
- Registrazione distingue Locale/Attività e Privato nei metadati utente; il ruolo server resta `client`, non modifica permessi backend.

## Deploy preview Cloudflare
I file modificati sono **solo**:
- `site/preview-v11/index.html`
- `site/preview-v11/app.js`
- `site/preview-v11/styles.css`
- `site/preview-v11/sw.js` (cache PWA aggiornata)

Se Cloudflare Builds è collegato al branch `v11-dispatch-engine`, il push GitHub avvia il processo di preview configurato. Il comando preview configurato dal proprietario era:

```sh
npx wrangler versions upload --assets=./site/preview-v11 --name=sos-cassa --preview-alias v11-dispatch-engine
```

Controllare l'esito in Cloudflare, Workers & Pages → `sos-cassa` → Builds/Deployments, branch `v11-dispatch-engine`. **Non usare Deploy per il sito live, non incollare il codice frontend dentro il Worker API e non usare la branch main.**

URL preview previsto: https://v11-dispatch-engine-sos-cassa.sales-3c8.workers.dev/?hub=client

## Checklist test manuale dopo build
1. Accedi con account Pizzeria Vesuvio, torna alla Home, premi `Continua senza account`. Deve uscire MODALITÀ OSPITE, senza nome/storico del locale.
2. Accedi di nuovo come cliente. Deve comparire il locale corretto, senza dati di altri utenti.
3. Verifica che Rider disponibile/offline/sconosciuto rispecchi l'API, con spazio dal profilo sottostante.
4. Conferma che il ritiro salvato sia riconoscibile, e che l'utente possa espanderlo e modificarlo.
5. Compila destinatario, telefono, indirizzo suggerito, orario e servizio. Prezzo calcolato; nessun ordine inviato prima della conferma.
6. Invia una richiesta test; verifica il codice, lo stato e l'arrivo nell'Area Rider senza modificare dati di produzione.
7. Verifica menu Nuova/Richieste/Storico/Analisi e il pulsante RIPETI. Confronta i dati con gli ultimi 8 record.
8. Su smartphone controlla che pulsante fisso e menu non coprano input, tastiera o modali.
9. Verifica fallback WhatsApp dopo errore di invio, non come proposta iniziale.
10. Se l'app è installata come PWA, ricarica senza cache; i link asset includono il suffisso `v=11.5.0-client-ux`.

## Verifiche statiche eseguite
- Compilazione sintattica JavaScript (V8): OK.
- Bilanciamento tag HTML: OK.
- ID HTML duplicati: nessuno.
- Quattro voci menu presenti.
- Non è stato eseguito alcun test browser end-to-end né verificato un deploy Cloudflare.
