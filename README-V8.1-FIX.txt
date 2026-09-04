SOS Rider Gestionale V8.1 FIX

Correzione critica autocomplete dopo Autocompila WhatsApp:
- i risultati autocomplete sono ora button type=button e NON inviano il form
- il tap/click sulla destinazione non registra accidentalmente la consegna
- tutti i campi compilati dal parser WhatsApp restano valorizzati
- selezionando il suggerimento vengono salvate soltanto le coordinate verificate
- correzione applicata sia a indirizzo ritiro sia a indirizzo consegna
- cache PWA aggiornata per forzare il caricamento della versione corretta

Cloudflare Worker: nessuna modifica necessaria rispetto a V7.3/V8 se autocomplete e test connessione funzionano.
