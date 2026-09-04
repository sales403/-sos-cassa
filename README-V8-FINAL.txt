SOS RIDER — V8 FINAL

Base: V7.3.1. Mantiene tutte le funzioni esistenti.

NOVITÀ PRINCIPALI
- Importa ordine WhatsApp: incolla il messaggio del locale e premi ANALIZZA E COMPILA.
- Parser locale gratuito: nessuna API AI, nessun account, nessun costo.
- Riconosce locale, cliente, telefono, indirizzo, servizio Economy/Express/Cargo, totale, pagamento e note.
- Il locale già compilato non viene sovrascritto; se il locale è già salvato recupera anche l'indirizzo di ritiro verificato.
- Dopo l'import, l'indirizzo cliente apre automaticamente l'autocomplete: seleziona il risultato corretto prima del preventivo.
- Pulsante FORMATO LOCALE: copia il modello da inviare/pinnare su WhatsApp.
- Nuovo logo con sfondo realmente trasparente.
- Splash iniziale più scenografica e leggibile (~2,35 s prima del fade).
- Cache PWA aggiornata per forzare l'installazione della versione nuova.

CLOUDFLARE
Il Worker V7.3 già funzionante continua ad andare bene. Il file cloudflare-worker.js incluso è equivalente e mostra solo versione V8 nel test. Non serve Google Cloud, nessuna API key.

UPLOAD GITHUB
Carica nella root del repository tutti i file presenti in questa cartella e conferma Commit changes.
Poi apri https://sales403.github.io/-sos-cassa/
Se l'app installata mostra ancora la vecchia versione, chiudila completamente e riaprila; in caso estremo rimuovi e aggiungi nuovamente alla schermata Home.
