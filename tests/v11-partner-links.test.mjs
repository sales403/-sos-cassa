import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {runInNewContext} from 'node:vm';

const worker=readFileSync(new URL('../worker-v11.0.0-dispatch.js',import.meta.url),'utf8');
const client=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const portion=(source,begin,end)=>{
  const a=source.indexOf(begin),b=source.indexOf(end,a);
  assert.ok(a>=0&&b>a,'Sezione non trovata: '+begin);
  return source.slice(a,b);
};
const key='0123456789abcdef0123456789abcdefabcd';

test('La versione staging autorizza il frontend V11 e si distingue dalla release precedente',()=>{
  assert.match(worker,/SOS Rider API 11\.4\.0-pricing-3band-staging/);
  assert.match(worker,/https:\/\/v11-dispatch-engine-sos-cassa\.sales-3c8\.workers\.dev/);
});

test('Gli errori asincroni dei link privati rientrano nel gestore HTTP del Worker',()=>{
  assert.match(worker,/return await getPartnerPage\(/);
  assert.match(worker,/return await getGuestRequest\(/);
  assert.match(worker,/return await getClientLivePosition\(/);
  assert.match(worker,/return await getRiderRequestShare\(/);
});

test('Un token partner inesistente restituisce 404 JSON, non un errore Cloudflare',async()=>{
  const fragment=portion(worker,'export default {','function corsHeaders(')
    .replace('export default','const exported = ');
  const rejected=Object.assign(new Error('Link partner non trovato'),{status:404});
  const handler=runInNewContext(fragment+'\nexported',{
    URL,
    corsHeaders:()=>({}),
    requireDb:()=>{},
    getPartnerPage:async()=>{throw rejected;},
    json:(body,status)=>({body,status}),
    console:{error:()=>{}}
  });
  const response=await handler.fetch({
    url:'https://staging.example.com/api/partner/'+key,
    method:'GET',headers:{get:()=>null}
  },{DB:{}},{});
  assert.equal(response.status,404);
  assert.equal(response.body.error,'Link partner non trovato');
});

test('Il link tracking conserva il token soltanto nel frammento URL',()=>{
  const functions=runInNewContext(
    portion(client,'function publicPortalLink(', '// iOS PWA:')+'\n({orderTrackingLink,permanentPartnerLink})',
    {URL,URLSearchParams,window:{location:{href:'https://staging.example.com/'}}}
  );
  const tracking=new URL(functions.orderTrackingLink('SR-TEST',key));
  assert.equal(tracking.pathname,'/track.html');
  assert.equal(tracking.search,'');
  assert.equal(new URLSearchParams(tracking.hash.slice(1)).get('key'),key);
  const partner=new URL(functions.permanentPartnerLink(key));
  assert.equal(partner.pathname,'/partner.html');
  assert.equal(partner.search,'');
  assert.equal(new URLSearchParams(partner.hash.slice(1)).get('key'),key);
  assert.throws(()=>functions.orderTrackingLink('SR-TEST','invalid'),/Token tracking/);
});

test('La pagina partner mostra ETA ma non coordinate o distanza rider',async()=>{
  const script=portion(worker,'let partnerPagesSchemaReady = false;', 'async function buildPickupAvailabilityPreview(');
  const env={DB:{prepare(sql){
    return {bind(k){assert.equal(k,key);return this;},async first(){return {
      name:'Pizzeria Da Mario',pickup_address:'Via Roma 1, Soliera',pickup_lat:44.75,pickup_lon:10.92
    };},async run(){return {meta:{changes:1}};}};
  }}};
  const api=runInNewContext(script+'\ngetPartnerPage',{
    buildPickupAvailabilityPreview:async(_env,requested)=>{
      assert.equal(requested.service,'ebike');
      return {mode:'busy',pickupEtaMin:19,transferKm:5.7,locationFresh:true,active:1,pickupEta:{windowStart:'2026-11-05T19:10:00Z'}};
    },
    json:(body)=>body,
    fail:(msg)=>{throw Error(msg);},
    token:()=>key,
    cleanText:(v,n)=>String(v).trim().slice(0,n),
    validCoord:(lat,lon)=>Number.isFinite(lat)&&Number.isFinite(lon),
    Date
  });
  const data=await api(key,new URL('https://api.example/api/partner/'+key+'?service=ebike'),env,{});
  assert.equal(data.availability.pickupEtaMin,19);
  assert.equal(data.partner.name,'Pizzeria Da Mario');
  assert.equal(data.availability.transferKm,undefined);
  assert.equal(data.partner.pickupLat,undefined);
  assert.equal(JSON.stringify(data).includes('riderLat'),false);
});

test('Creazione partner richiede nome e coordinate verificate',async()=>{
  const script=portion(worker,'let partnerPagesSchemaReady = false;', 'async function buildPickupAvailabilityPreview(');
  const calls=[];
  const api=runInNewContext(script+'\ncreatePartnerPage',{
    json:body=>body,fail:msg=>{throw Error(msg);},
    token:()=>key,cleanText:(v,n)=>String(v??'').trim().slice(0,n),
    validCoord:(lat,lon)=>lat>=35&&lat<=48&&lon>=6&&lon<=19,
    Date
  });
  const env={DB:{prepare(sql){calls.push(sql);return {bind(){return this;},async run(){return {meta:{changes:1}};}};}}};
  const request=p=>({json:async()=>p});
  await assert.rejects(api(request({name:'',pickupAddress:'Via Roma',pickupLat:44.7,pickupLon:10.9}),env,{}),/Indica nome/);
  await assert.rejects(api(request({name:'Mario',pickupAddress:'Via Roma',pickupLat:0,pickupLon:10.9}),env,{}),/Indica nome/);
  const ok=await api(request({name:'Mario',pickupAddress:'Via Roma 1',pickupLat:44.7,pickupLon:10.9}),env,{});
  assert.equal(ok.partner.token,key);
  assert.ok(calls.some(sql=>sql.includes('CREATE TABLE IF NOT EXISTS partner_pages')));
  assert.ok(calls.some(sql=>sql.includes('INSERT INTO partner_pages')));
});

test('Recupero link tracking: legge il token esistente soltanto in area Rider',async()=>{
  assert.match(worker,/riderShareMatch[^]*?requireRole\(request, env, 'rider'\)[^]*?getRiderRequestShare/);
  const script=portion(worker,'async function getRiderRequestShare(', 'async function getGuestRequest(');
  const recover=runInNewContext(script+'\ngetRiderRequestShare',{
    getByCode:async(_env,code)=>code==='SR-TEST'?{code:'SR-TEST',client_token:key}:null,
    json:body=>body,
    cleanText:(v,n)=>String(v).trim().slice(0,n),
    fail:(message)=>{throw Error(message);}
  });
  const reply=await recover('SR-TEST',{},{});
  assert.equal(reply.code,'SR-TEST');
  assert.equal(reply.clientToken,key);
  await assert.rejects(recover('SR-UNKNOWN',{},{}),/Ordine non trovato/);
  assert.match(client,/function openTrackingLinkRecovery\(/);
});

test('La stima partner con coda piena usa la fine del percorso senza accettare nuove richieste',async()=>{
  const script=portion(worker,'async function buildPickupAvailabilityPreview(', 'function attachEta(');
  const preview=runInNewContext(script+'\nbuildPickupAvailabilityPreview',{
    buildEtaState:async()=>({
      availability:{enabled:true,mode:'full',firstPickupEtaMin:6},
      queueContext:{active:3,pending:0,cursorMin:23,lastPoint:{lat:44.75,lon:10.92}},
      liveLocation:{fresh:true,lat:44.74,lon:10.91}
    }),
    validCoord:(lat,lon)=>Number.isFinite(lat)&&Number.isFinite(lon),
    estimatedRoadKm:()=>2.1,
    travelMinutes:()=>7,
    etaWindow:min=>({afterMinutes:min}),
    Date
  });
  const result=await preview({}, {pickupLat:44.76,pickupLon:10.93,service:'ebike'});
  assert.equal(result.mode,'full');
  assert.equal(result.canSubmit,false);
  assert.equal(result.tentativePickupEta.afterMinutes,30);
  assert.equal(result.pickupEta,null);
});
