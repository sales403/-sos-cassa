SOS Rider Gestionale V8.2 SMART

FIX / UPGRADE PRINCIPALE
- Parser WhatsApp molto più tollerante ai messaggi naturali e disordinati.
- Riconosce frasi come: "il cliente è Luca, consegna in via Remesina 27 a Carpi".
- Riconosce "consegna per Marco", "ordine da Pizzeria Roma per Matteo", numeri di telefono, importi, pagamento, standard/express/cargo e note/citofono.
- Estrae solo la parte dell'indirizzo invece di copiare tutta la frase.
- Mantiene il fix V8.1: la selezione del suggerimento autocomplete NON invia/resetta il form.
- Nessuna API AI, nessun costo, nessuna modifica Cloudflare necessaria.

TEST CONSIGLIATO
Incollare:
ciao marcello allora per stasera avrei questo
il cliente è Luca, consegna in via remesina 27 a carpi
numero 333 721 9044
sono 28 euro da incassare
direi express perché vorrebbe mangiare caldo
citofono dovrebbe essere rossi, se non risponde chiamalo

Atteso:
Cliente Luca / 3337219044 / via remesina 27 a carpi / Moto Express / 28 euro / Contanti / nota citofono.
