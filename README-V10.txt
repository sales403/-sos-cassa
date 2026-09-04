SOS RIDER CARPI-SOLIERA — V10 UNIFIED
=====================================

OBIETTIVO DELLA V10
Una sola PWA con:
- accesso ospite per una prima richiesta senza registrazione;
- account CLIENTE separato;
- account RIDER separato e autorizzato solo lato backend;
- richiesta guidata -> tariffa -> preventivo -> invio -> Area Rider;
- stato rider pubblico e aggiornamenti ordine lato cliente;
- Telegram al Rider per ogni nuova richiesta;
- allarme interno PWA quando Area Rider è aperta;
- tema automatico DAY/NIGHT mantenendo lo stesso brand;
- cassa, turni, storico e analytics della V9.

NOVITÀ PRINCIPALI
-----------------
1) DAY / NIGHT
- AUTO: Day 07:00-18:29, Night 18:30-06:59.
- Il pulsante tema cicla AUTO -> DAY -> NIGHT -> AUTO.
- Day: sfondo bianco/grigio chiaro, testo antracite, stesso giallo SOS, stessi bordi e componenti.
- Il preventivo immagine si adatta al tema attivo.

2) ACCESSO E RUOLI
- Supabase Auth gestisce email/password.
- Il Worker verifica la sessione Supabase e il ruolo ad ogni endpoint protetto.
- RIDER_EMAILS sul Worker è la whitelist Rider: solo quelle email diventano role=rider.
- Tutti gli altri account sono role=client.
- Un account Client riceve 403 sugli endpoint Rider.
- Un account Rider non può creare una richiesta come Client quando usa la propria sessione.
- Anche il frontend impedisce di entrare nella sezione sbagliata.
- Guest: può fare preventivo e richiesta senza account; la richiesta è protetta con token casuale.

3) PASSKEY
- Implementata come opzione BETA tramite Supabase WebAuthn/passkey.
- NON è necessaria al funzionamento: email/password resta il canale principale e di recupero.
- Per usarla devi abilitare Passkeys in Supabase e configurare correttamente RP ID + Origins.
- Per GitHub Pages attuale:
  RP ID: sales403.github.io
  Origin: https://sales403.github.io
- Se in futuro passi a un dominio personalizzato, decidi il dominio definitivo PRIMA di distribuire molte passkey.

4) DISPONIBILITÀ RIDER
- Primo avvio database: NON DISPONIBILE per sicurezza.
- Il Rider sceglie DISPONIBILE / NON DISPONIBILE.
- Se disponibile ma esistono richieste nuove o consegne attive, lo stato pubblico diventa automaticamente OCCUPATO.
- Attesa stimata = ETA per richiesta (default 25 min) x richieste/consegne in coda, max 120 min.
- Il cliente vede:
  verde = disponibile (10-15 min indicativi)
  giallo = occupato (attesa stimata)
  rosso = non disponibile
- Se rosso: può calcolare il preventivo ma il Worker blocca l'invio automatico con HTTP 409.
- Se giallo: prima dell'invio il cliente riceve un avviso con attesa stimata e sceglie se procedere.

5) TARIFFE V10
E-BIKE:
- MICRO E-BIKE: 2,50 € se distanza percorso <= 1,00 km.
- Se > 1 km: tariffa Economy normale, quindi 6,50 € fino a 3 km + 1 €/km oltre.

MOTO:
- 9 € fino a 5 km + 1,20 €/km oltre.

AUTO:
- 12 € fino a 5 km + 1,50 €/km oltre.

SERALE:
- +2 € automatici dalle 22:30 in base a “Ordine pronto”.

NESSUN altro extra in questa V10.

IMPORTANTE SULLA TARIFFA
- Il preventivo viene calcolato dal Worker /api/quote, non deciso dal browser.
- Al momento dell'invio il Worker ricalcola ancora percorso e tariffa.
- NON viene più usata una stima Haversine per inventare un prezzo quando il router è offline.
- Se il servizio di routing non risponde, il preventivo automatico fallisce chiaramente e resta WhatsApp come fallback.
- Questo è voluto: meglio nessun prezzo automatico che un prezzo sbagliato.

6) NOTIFICHE RIDER
TELEGRAM:
- nuova richiesta -> Worker -> Telegram Bot API -> chat_id Rider.
- Telegram contiene codice, locale, ritiro, consegna, orario, servizio, km e tariffa.
- BOT TOKEN e CHAT ID sono secret Worker, mai nel frontend.
- Un guasto Telegram NON annulla la richiesta: l'ordine resta registrato nel database.

ALLARME AREA RIDER:
- va attivato una volta su ogni dispositivo con il pulsante ATTIVA;
- con Area Rider aperta, nuova richiesta -> suono ripetuto + vibrazione se supportata;
- si ferma quando Accetti o Rifiuti la richiesta che sta suonando;
- prova anche una Notification API locale se il browser ha il permesso;
- non viene promesso come notifica background a browser chiuso: per il background c'è Telegram.

7) NOTIFICHE CLIENTE / LOCALE
- polling rapido ogni 4 secondi, senza reload pagina.
- cambio stato -> badge + piccolo ding se l'audio è disponibile.
- stati principali:
  IN ATTESA
  ACCETTATA / RIDER IN ARRIVO AL LOCALE
  IN CONSEGNA
  RIDER ARRIVATO
  COMPLETATO
  RIFIUTATO / ANNULLATO

8) PROFILO CLIENTE
- nome, telefono e indirizzo di ritiro principale salvati server-side.
- richieste effettuate da account vengono legate al suo user_id.
- “Ultime richieste” viene letto online dal database e può essere ripetuto.
- ospite mantiene il vecchio storico locale sul dispositivo.
- ogni invio usa un submission_id univoco: se la rete cade durante l'invio, un retry della stessa richiesta non crea un doppione.

9) CASSA RIDER
Rimangono:
- turni;
- fondo resto;
- incassi contanti;
- resto;
- importi da rendere ai locali;
- storico;
- analytics;
- CSV;
- backup JSON;
- parser WhatsApp solo come fallback.

============================================================
SETUP 1 — SUPABASE AUTH
============================================================
1. Crea un progetto Supabase.
2. Authentication -> Providers -> Email: abilita email/password.
3. LASCIA ATTIVA la conferma email: il Worker rifiuta sessioni con email non confermata.
4. Copia:
   - Project URL
   - anon/publishable key
5. Inseriscili in config.js:
   supabaseUrl
   supabaseAnonKey
6. Inserisci gli stessi valori nel Worker:
   SUPABASE_URL
   SUPABASE_ANON_KEY
7. Imposta RIDER_EMAILS come secret Cloudflare con l'email di Marcello:
   npx wrangler secret put RIDER_EMAILS
8. Crea l'account Marcello in Supabase con quella email.
9. Al primo /api/me il Worker lo classificherà Rider automaticamente.

PASSKEY (opzionale / beta)
- Authentication -> Passkeys -> Enable.
- RP ID per GitHub Pages: sales403.github.io
- Origin: https://sales403.github.io
- In Supabase aggiungi anche il redirect password: https://sales403.github.io/-sos-cassa/?hub=login
- Nel frontend config.js: enablePasskeys: true
- Prima accedi con email/password, poi “Registra passkey”.

============================================================
SETUP 2 — CLOUDFLARE WORKER + D1
============================================================
NUOVO DATABASE:
1. cd worker
2. npx wrangler d1 create sos-rider
3. copia wrangler.toml.example -> wrangler.toml
4. inserisci database_id
5. inserisci ALLOWED_ORIGINS, SUPABASE_URL e SUPABASE_ANON_KEY
6. salva la whitelist Rider come secret:
   npx wrangler secret put RIDER_EMAILS
7. npx wrangler d1 execute sos-rider --remote --file=schema.sql
8. npx wrangler deploy

DATABASE V9 ESISTENTE:
1. FAI PRIMA UN BACKUP D1.
2. Aggiorna il Worker.
3. Esegui UNA SOLA VOLTA:
   npx wrangler d1 execute sos-rider --remote --file=migration-v9-to-v10.sql
4. Poi:
   npx wrangler deploy

Nota: migration-v9-to-v10.sql usa ALTER TABLE e non va rilanciata due volte.

============================================================
SETUP 3 — TELEGRAM
============================================================
1. Crea un bot con BotFather.
2. Scrivi almeno un messaggio al bot dal tuo account Telegram.
3. Recupera il tuo chat_id.
4. Salva come secret Cloudflare:
   npx wrangler secret put TELEGRAM_BOT_TOKEN
   npx wrangler secret put TELEGRAM_CHAT_ID
5. npx wrangler deploy

Non mettere MAI il token bot in config.js o nel repository GitHub.

============================================================
SETUP 4 — GITHUB PAGES
============================================================
Carica nella root del repository:
- index.html
- styles.css
- app.js
- config.js
- sw.js
- manifest.webmanifest
- logo-sos-rider.png
- icon-192.png
- icon-512.png
- legacy-v8.3.html (backup opzionale)

URL PRINCIPALE:
https://sales403.github.io/-sos-cassa/

RICHIESTA DIRETTA OSPITE:
https://sales403.github.io/-sos-cassa/?hub=client

LOGIN:
https://sales403.github.io/-sos-cassa/?hub=login

AREA RIDER DIRETTA:
https://sales403.github.io/-sos-cassa/?hub=rider

============================================================
ORDINE CONSIGLIATO DI ATTIVAZIONE
============================================================
1. Worker + migration/schema.
2. Test /api/status.
3. Supabase email/password.
4. Crea account Rider + verifica ruolo.
5. Metti Rider = DISPONIBILE.
6. Test richiesta ospite da un secondo telefono.
7. Verifica comparsa Area Rider.
8. Test ACCETTA -> IN CONSEGNA -> COMPLETATO lato cliente.
9. Configura Telegram e ripeti test.
10. Solo dopo, abilita Passkey.

Per il lancio reale, non attivare il QR ai locali finché i punti 1-9 non sono stati verificati su due dispositivi reali.
