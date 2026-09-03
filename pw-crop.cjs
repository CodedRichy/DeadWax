const { chromium } = require('playwright');
const D = process.argv[2];
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport:{width:1600,height:960}, deviceScaleFactor:2 });
  // block the now-playing feed so consecutive shots land on the same record
  await p.route(u => /\/api\/(stream|now|shelf)/.test(u.href), r => r.abort());
  await p.goto('http://127.0.0.1:8484/', { waitUntil:'networkidle' });
  await p.waitForTimeout(2500);
  await p.evaluate(()=>{ window.__forceSpin = 0.6; });
  await p.waitForTimeout(400);
  // tonearm: pivot + counterweight + headshell
  await p.screenshot({ path: D+'/c-arm.png',   clip:{x:1000,y:20,width:600,height:700} });
  // the cartridge end alone
  await p.screenshot({ path: D+'/c-head.png',  clip:{x:1000,y:520,width:280,height:220} });
  // label + inner grooves
  await p.screenshot({ path: D+'/c-label.png', clip:{x:560,y:280,width:520,height:400} });
  // the outer rim + that diffraction band
  await p.screenshot({ path: D+'/c-rim.png',   clip:{x:600,y:120,width:700,height:340} });
  await b.close();
})();
