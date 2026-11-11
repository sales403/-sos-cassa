from pathlib import Path


def rep(text, old, new, label):
    if new in text:
        return text
    if old not in text:
        raise SystemExit(f'anchor missing: {label}')
    return text.replace(old, new, 1)

# Worker: every batch item returned after accept/pick keeps group totals and true pickup metadata.
wp=Path('worker-v11.0.0-dispatch.js')
w=wp.read_text()
w=rep(w,
"""    batchId,
    batchStopIndex: Number(r.stop_index),
    batchSize: x.rows.length,
    eta: etaState.etaByCode[r.code] || null
""",
"""    batchId,
    batchStopIndex: Number(r.stop_index),
    batchSize: x.rows.length,
    batchTotalFee: Number(x.batch.total_fee) || 0,
    batchExtraStopFee: Number(x.batch.extra_stop_fee) || 0,
    batchTotalDistanceKm: Number(x.batch.total_distance_km) || 0,
    batchPickupAddress: x.batch.pickup_address || r.pickup_address,
    batchPickupLat: Number(x.batch.pickup_lat),
    batchPickupLon: Number(x.batch.pickup_lon),
    eta: etaState.etaByCode[r.code] || null
""",'batch payload metadata')
wp.write_text(w)

# App: persist total batch distance on local child records and restore the optional second stop draft.
for p in [Path('app.js'),Path('preview-v11/app.js')]:
    if not p.exists(): continue
    a=p.read_text()
    a=rep(a,
"batchTotalFee:r.batchTotalFee||0,batchExtraStopFee:r.batchExtraStopFee||0};state.orders.push(o);",
"batchTotalFee:r.batchTotalFee||0,batchExtraStopFee:r.batchExtraStopFee||0,batchTotalDistanceKm:r.batchTotalDistanceKm||0};state.orders.push(o);",
'local batch distance')
    a=rep(a,
"""      if(d.service){clientVehicle=d.service;setClientVehicle(d.service,false)}
      if(clientPickup)$('cPickupStatus').textContent='✓ Indirizzo verificato';if(clientDelivery)$('cDeliveryStatus').textContent='✓ Indirizzo verificato';
      $('clientDraftPill').classList.remove('hidden');
""",
"""      if(d.service){clientVehicle=d.service;setClientVehicle(d.service,false)}
      if(d.second){
        clientBatchMode=true;$('clientSecondDelivery')?.classList.remove('hidden');if($('clientAddSecond'))$('clientAddSecond').textContent='− RIMUOVI SECONDA CONSEGNA';
        if($('cRecipient2'))$('cRecipient2').value=d.second.recipientName||'';if($('cRecipientPhone2'))$('cRecipientPhone2').value=d.second.recipientPhone||'';
        if($('cDelivery2'))$('cDelivery2').value=d.second.deliveryAddress||'';
        if(Number.isFinite(Number(d.second.deliveryLat))&&Number.isFinite(Number(d.second.deliveryLon))){clientDelivery2={label:d.second.deliveryAddress||'',lat:Number(d.second.deliveryLat),lon:Number(d.second.deliveryLon)};if($('cDelivery2Status'))$('cDelivery2Status').textContent='✓ Indirizzo verificato';}
        if($('cPayment2'))$('cPayment2').value=d.second.payment||'paid';if($('cOrderTotal2'))$('cOrderTotal2').value=d.second.orderTotal||'';if($('cNotes2'))$('cNotes2').value=d.second.notes||'';toggleOrderTotal2();
      }
      if(clientPickup)$('cPickupStatus').textContent='✓ Indirizzo verificato';if(clientDelivery)$('cDeliveryStatus').textContent='✓ Indirizzo verificato';
      $('clientDraftPill').classList.remove('hidden');
""",'restore second-stop draft')
    p.write_text(a)

print('V11 batch polish applied')
