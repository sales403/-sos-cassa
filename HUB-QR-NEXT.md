# Prossima attività dopo il collaudo V11: HUB QR SOS Rider

**Da riprendere con Marcello appena sono verificate sullo staging le funzioni tracking WhatsApp e pagina permanente per locale.** Non saltare questo passaggio: Marcello ha chiesto espressamente di ricordarglielo anche dopo altre modifiche.

## Scopo

Un unico QR **definitivo e stampabile** su biglietti, adesivi e stand apre la mini pagina mobile pubblica, senza login e con tre scelte:

1. **ORDINE RAPIDO** — verde, WhatsApp Business `+39 349 515 3092`, messaggio precompilato con ritiro, destinazione, orario, mezzo, incasso e note.
2. **APRI L'APP** — giallo, PWA per preventivo e richiesta, e successivo tracking attraverso il link privato dell'ordine.
3. **INFO E TARIFFE** — antracite, sito commerciale con listino unico approvato, zone e condizioni.

## Grafica approvata in chat il 5/11/2026

Card nero assoluto arrotondato, intestazione giallo oro `SOS ⚡ RIDER`, `CARPI • SOLIERA`, payoff `Il tuo rider di emergenza`, riga bordata `COME VUOI RICHIEDERE UNA CONSEGNA?`, tre grandi pulsanti verticali con icone chiare, footer `Nessun abbonamento • Paghi solo quando ti servo` e numero business. Screenshot di riferimento allegato alla conversazione. **Conservare questa struttura e i colori**; non introdurre effetti AI, rumore grafico o piccoli testi illeggibili. Rendere l'impaginazione realmente mobile-first.

## Scelte tecniche

- Una pagina statica leggera `go/index.html` sul dominio definitivo, es. `https://sosrider.it/go` **solo se acquistato e verificato**. Nessun QR stampato con URL temporanei di staging.
- I tre link di destinazione sono modificabili dietro la pagina, quindi il QR fisico resta valido quando app o sito cambiano.
- Link personali dei partner e link tracking degli ordini restano separati dal QR pubblico; niente credenziali o coordinate rider nel QR.
- Il testo `Preventivo automatico e tracking` deve descrivere funzioni effettivamente collaudate. Verificare listino e collegamenti prima della stampa.
- Fare test QR su vecchio iPhone Business e iPhone 16e e controllo dimensioni/margini/tracciato fustella col padre stampatore.

**Sequenza:** chiudere staging V11 → collaudo iPhone/GPS → realizzare HUB statico → collegare destinazioni → approvare URL permanente → QR definitivo → stampa.
