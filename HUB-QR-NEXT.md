# HUB QR SOS Rider – implementazione staging

**Stato (05/11/2026):** Marcello ha autorizzato ad anticipare la costruzione dell'HUB durante il collaudo V11. Pagina HTML statica realizzata e testata automaticamente; pubblicazione e test su telefono ancora da completare. Nessun QR stampato.

## Scopo

Un unico QR **definitivo e stampabile** su biglietti, adesivi e stand apre la mini pagina mobile pubblica, senza login e con tre scelte:

1. **ORDINE RAPIDO** — verde, WhatsApp Business `+39 349 515 3092`, messaggio precompilato con ritiro, destinazione, orario, mezzo, incasso e note.
2. **APRI L'APP** — giallo, PWA per preventivo e richiesta, e successivo tracking attraverso il link privato dell'ordine.
3. **INFO E TARIFFE** — antracite, sito commerciale con listino unico approvato, zone e condizioni.

## Grafica approvata in chat il 5/11/2026

Card nero assoluto arrotondato, intestazione giallo oro `SOS ⚡ RIDER`, `CARPI • SOLIERA`, payoff `Il tuo rider di emergenza`, riga bordata `COME VUOI RICHIEDERE UNA CONSEGNA?`, tre grandi pulsanti verticali con icone chiare, footer `Nessun abbonamento • Paghi solo quando ti servo` e numero business. Screenshot di riferimento allegato alla conversazione. **Conservare questa struttura e i colori**; non introdurre effetti AI, rumore grafico o piccoli testi illeggibili. Rendere l'impaginazione realmente mobile-first.

## Scelte tecniche

- Pagina statica leggera e autonoma `go/index.html`, copiata in `preview-v11/go/index.html` (assets PWA staging), `site/go/index.html` (sito vetrina futuro) e `site/preview-v11/go/index.html` (asset layout alternativo). Test automatico `tests/v11-qr-hub.test.mjs` verifica che le copie siano identiche.
- URL da provare **solo dopo il deploy del frontend staging**: `https://v11-dispatch-engine-sos-cassa.sales-3c8.workers.dev/go/`. Non confonderlo con il backend `sos-rider-v11-staging` che risponde solo alle API.
- Destinazioni correnti: WhatsApp `+39 349 515 3092` con testo precompilato; PWA V11 staging `/?hub=client` (richiesta cliente, accesso ospite previsto); sito `https://sales403.github.io/-sos-cassa/site/`.
- Dominio definitivo ipotetico `https://sosrider.it/go` **solo se acquistato e verificato**. Nessun QR stampato con URL temporanei di staging.
- I tre link di destinazione sono modificabili dietro la pagina, quindi il QR fisico resta valido quando app o sito cambiano.
- Link personali dei partner e link tracking degli ordini restano separati dal QR pubblico; niente credenziali o coordinate rider nel QR.
- Il testo `Preventivo automatico e tracking` deve descrivere funzioni effettivamente collaudate. Verificare listino e collegamenti prima della stampa.
- Fare test QR su vecchio iPhone Business e iPhone 16e e controllo dimensioni/margini/tracciato fustella col padre stampatore.

## Checklist residua

- [x] Creare l'HUB responsive rispettando il design approvato e i tre link.
- [x] Test automatici link, numero WhatsApp e moduli precompilati.
- [ ] Distribuire il frontend **di staging** con i nuovi assets `/go/` (non modificare `main` né il Worker backend).
- [ ] Controllare a schermo la pagina mobile sui due iPhone, e toccare tutti e tre i pulsanti. La verifica visuale automatizzata locale era limitata dall'ambiente browser; non considerarla eseguita.
- [ ] Riconciliare il listino della vetrina con quello dell'app prima della pubblicazione ai clienti.
- [ ] Completare il test V11: partner reale, ordine WhatsApp, tracking condiviso, GPS OwnTracks aggiornato.
- [ ] Approvare/acquistare il dominio definitivo, configurare il percorso `/go`, testarlo e **solo allora** generare e stampare il QR.
