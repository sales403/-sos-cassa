import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

const site=readFileSync(new URL('../site/index.html',import.meta.url),'utf8');
const css=readFileSync(new URL('../site/styles.css',import.meta.url),'utf8');

test('Il sito mostra i tre mezzi nel tariffario senza ripetere la sezione servizi',()=>{
  assert.doesNotMatch(site,/id="servizi"/);
  assert.doesNotMatch(site,/Tre mezzi\. Una sola missione\./);
  assert.doesNotMatch(site,/class="service-card/);
  assert.doesNotMatch(site,/href="#servizi"/);
  assert.match(site,/href="#tariffe">Tariffe<\/a>/);
  assert.equal((site.match(/class="premium-price-card/g)||[]).length,3);
  for(const heading of ['ECONOMY E-BIKE','EXPRESS MOTO','CARGO AUTO']){
    assert.match(site,new RegExp(`<h3>${heading}<\\/h3>`));
  }
});

test('Le fotografie restano una volta nelle tre schede tariffarie',()=>{
  for(const vehicle of ['ebike','moto','auto']){
    assert.equal((site.match(new RegExp(`src="\\./assets/${vehicle}\\.webp"`,'g'))||[]).length,1);
  }
  assert.doesNotMatch(css,/\.service-scroller|\.service-card|\.service-media/);
});
