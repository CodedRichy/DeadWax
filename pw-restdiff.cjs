const { chromium } = require('playwright');
const D = process.argv[2];
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport:{width:1600,height:960}, deviceScaleFactor:2 });
  // pin the record so both frames show the same album
  await p.route('**/api/(stream|now|shelf)*', r => r.abort());
  await p.goto('http://127.0.0.1:8484/', { waitUntil:'domcontentloaded' });
  await p.waitForTimeout(2500);
  await p.evaluate(() => { window.__forceSpin = 0.6; });
  await p.waitForTimeout(500);
  await p.screenshot({ path: D+'/r-awake.png' });
  await p.evaluate(() => window.goRest && window.goRest());
  await p.waitForTimeout(2500);
  await p.evaluate(() => { window.__forceSpin = 0.6; });
  await p.waitForTimeout(500);
  await p.screenshot({ path: D+'/r-rest.png' });
  console.log(JSON.stringify(await p.evaluate(()=>{const c=document.querySelector('canvas');
    return {resting:document.body.classList.contains('resting'),cw:c.width,ch:c.height};})));
  await b.close();
})();
