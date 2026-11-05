import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

const html=readFileSync(new URL('../go/index.html',import.meta.url),'utf8');
const destinations=Array.from(html.matchAll(/<a class="choice [^"]+"\s+href="([^"]+)"/g),m=>m[1]);

test('Il QR HUB presenta esattamente tre destinazioni dirette e senza login',()=>{
  assert.equal(destinations.length,3);
  assert.match(html,/COME VUOI RICHIEDERE UNA CONSEGNA\?/);
  assert.match(html,/ORDINE RAPIDO/);
  assert.match(html,/APRI L'APP/);
  assert.match(html,/INFO E TARIFFE/);
  assert.match(html,/349 515 3092/);
  assert.ok(!html.includes('client_token'));
  assert.ok(!html.includes('service_role'));
});

test('WhatsApp apre il numero Business col modulo pronto per il locale',()=>{
  const url=new URL(destinations[0]);
  assert.equal(url.hostname,'wa.me');
  assert.equal(url.pathname,'/393495153092');
  const message=url.searchParams.get('text');
  for(const field of ['Locale/ritiro:','Destinazione:','Orario:','Mezzo:','Somma da riscuotere:','Note:']){
    assert.ok(message.includes(field),`Campo mancante: ${field}`);
  }
});

test('App apre direttamente la richiesta cliente V11, sito apre la vetrina esistente',()=>{
  assert.equal(destinations[1],'https://v11-dispatch-engine-sos-cassa.sales-3c8.workers.dev/?hub=client');
  assert.equal(destinations[2],'https://sales403.github.io/-sos-cassa/site/');
});

test('La pagina funziona senza script e mantiene copie identiche nei deploy statici',()=>{
  assert.match(html,/<html lang="it">/);
  assert.match(html,/<meta name="viewport"/);
  assert.doesNotMatch(html,/<script/i);
  for(const file of ['../preview-v11/go/index.html','../site/go/index.html','../site/preview-v11/go/index.html']){
    assert.equal(readFileSync(new URL(file,import.meta.url),'utf8'),html,`Replica non sincronizzata: ${file}`);
  }
});
